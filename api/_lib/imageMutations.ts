import type { createSupabaseAdmin } from "./supabaseAdmin.js";

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;
type InsertSide = "before" | "after";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function regenerateImage(supabase: SupabaseAdmin, imageId: string) {
  if (!isUuid(imageId)) throw new Error("Invalid imageId");
  const image = await loadImageAnchor(supabase, imageId);
  const rebuild = await queueRebuildFromIndex(supabase, {
    scrollId: image.scroll_id,
    startIndex: Number(image.image_index),
    type: "regenerate",
    logMessage: `第 ${image.image_index} 张已请求重新生成`,
    logDetail: "已从该段开始重建后续画面，避免中间帧变化后破坏连续画卷衔接。",
  });
  return { imageId, regenerated: true, rebuild };
}

export async function requestInsertImage(supabase: SupabaseAdmin, imageId: string, side: InsertSide) {
  if (!isUuid(imageId)) throw new Error("Invalid imageId");
  const image = await loadImageAnchor(supabase, imageId);
  const anchorIndex = Number(image.image_index);
  const startIndex = side === "before" ? anchorIndex : anchorIndex + 1;
  const rebuild = await queueRebuildFromIndex(supabase, {
    scrollId: image.scroll_id,
    startIndex,
    type: side === "before" ? "insert_before" : "insert_after",
    logMessage: `已请求在第 ${anchorIndex} 张${side === "before" ? "前" : "后"}插入`,
    logDetail: "已从插入位置开始重建后续画面，新的画面会按队列继续生成。",
  });
  return { imageId, side, targetIndex: startIndex, queued: true, rebuild };
}

async function loadImageAnchor(supabase: SupabaseAdmin, imageId: string) {
  const { data, error } = await supabase.from("scroll_images").select("id,scroll_id,image_index").eq("id", imageId).single();
  if (error) throw error;
  if (!data) throw new Error("Image not found");
  return data as { id: string; scroll_id: string; image_index: number };
}

async function queueRebuildFromIndex(
  supabase: SupabaseAdmin,
  input: { scrollId: string; startIndex: number; type: "regenerate" | "insert_before" | "insert_after"; logMessage: string; logDetail: string },
) {
  if (!Number.isInteger(input.startIndex) || input.startIndex < 1) throw new Error("Invalid rebuild startIndex");
  const { data: scroll, error: scrollError } = await supabase.from("scrolls").select("id,image_count").eq("id", input.scrollId).single();
  if (scrollError) throw scrollError;

  const currentCount = Number((scroll as { image_count?: number | string | null } | null)?.image_count ?? input.startIndex);
  const targetCount = Math.max(currentCount, input.startIndex);
  const baseCount = input.startIndex - 1;
  const now = new Date().toISOString();

  const { error: imageDeleteError } = await supabase.from("scroll_images").delete().eq("scroll_id", input.scrollId).gte("image_index", input.startIndex);
  if (imageDeleteError) throw imageDeleteError;

  const { error: queuedCancelError } = await supabase
    .from("generation_jobs")
    .update({ status: "cancelled", error_message: "Superseded by image rebuild request", updated_at: now })
    .eq("scroll_id", input.scrollId)
    .eq("status", "queued")
    .gte("target_index", input.startIndex);
  if (queuedCancelError) throw queuedCancelError;

  const { error: scrollUpdateError } = await supabase
    .from("scrolls")
    .update({
      image_count: baseCount,
      status: "generating",
      auto_generation_enabled: true,
      next_run_at: now,
      updated_at: now,
    })
    .eq("id", input.scrollId);
  if (scrollUpdateError) throw scrollUpdateError;

  const { error: jobInsertError } = await supabase.from("generation_jobs").insert({
    scroll_id: input.scrollId,
    target_index: input.startIndex,
    type: input.type,
    status: "queued",
    scheduled_for: now,
  });
  if (jobInsertError) throw jobInsertError;

  await supabase.from("generation_logs").insert({
    scroll_id: input.scrollId,
    level: "warning",
    message: input.logMessage,
    detail: input.logDetail,
  });

  return { startIndex: input.startIndex, targetCount, queued: true };
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateImage, generateOutpaintedImage } from "../_lib/ai";
import { getCandidateScrollFilters, isStaleRunningJob } from "../_lib/generationPlan";
import { getScrollImageDimensions } from "../_lib/imageDimensions";
import { copyPreviousOverlapIntoNewImage, extractRightOverlapByWidth, normalizeImageBuffer } from "../_lib/stitchImages";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin";

const DEFAULT_MAX_CONCURRENT_JOBS = 2;
const DEFAULT_GENERATION_TIMEOUT_MS = 12 * 60 * 1000;
const IMAGE_BUCKET = "scroll-images";
const FIXED_OVERLAP_RATIO = 0.25;

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;
type ScrollRow = Record<string, any>;

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const supabase = createSupabaseAdmin();
    const maxConcurrentJobs = Number(process.env.MAX_CONCURRENT_JOBS ?? DEFAULT_MAX_CONCURRENT_JOBS);
    const scrollId = typeof request.query.scrollId === "string" ? request.query.scrollId : undefined;
    const manual = request.query.manual === "1" || request.query.background === "1";
    const filters = getCandidateScrollFilters({ scrollId, manual });

    let dueScrollsQuery = supabase.from("scrolls").select("*").limit(maxConcurrentJobs);
    if (filters.requireAutoEnabled) dueScrollsQuery = dueScrollsQuery.eq("auto_generation_enabled", true);
    if (filters.scrollId) dueScrollsQuery = dueScrollsQuery.eq("id", filters.scrollId);
    if (filters.dueBeforeIso) dueScrollsQuery = dueScrollsQuery.lte("next_run_at", filters.dueBeforeIso);

    const { data: dueScrolls, error: dueError } = await dueScrollsQuery;
    if (dueError) throw dueError;

    const settled = await Promise.allSettled((dueScrolls ?? []).map((scroll) => generateOneScrollImage(supabase, scroll)));
    const results = settled.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      return {
        scrollId: dueScrolls?.[index]?.id,
        failed: true,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    });

    response.status(200).json({ ok: true, results });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Cron generation failed",
    });
  }
}

async function generateOneScrollImage(supabase: SupabaseAdmin, scroll: ScrollRow) {
  const targetIndex = Number(scroll.image_count ?? 0) + 1;
  const { data: runningJob, error: runningError } = await supabase
    .from("generation_jobs")
    .select("id,locked_at")
    .eq("scroll_id", scroll.id)
    .eq("status", "running")
    .maybeSingle();
  if (runningError) throw runningError;

  if (runningJob) {
    if (isStaleRunningJob({ lockedAt: runningJob.locked_at as string | null })) {
      await finishJob(supabase, runningJob.id, "failed", "Running job timed out and was released for a retry");
    } else {
      return { scrollId: scroll.id, targetIndex, skipped: "running_job_exists" };
    }
  }

  const now = new Date().toISOString();
  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({
      scroll_id: scroll.id,
      target_index: targetIndex,
      type: "auto_next",
      status: "running",
      scheduled_for: now,
      locked_at: now,
      locked_by: "vercel-cron",
    })
    .select()
    .single();

  if (jobError) return { scrollId: scroll.id, targetIndex, failed: true, error: jobError.message };

  try {
    const isFirst = targetIndex === 1;
    const overlapRatio = FIXED_OVERLAP_RATIO;
    const { width, height, overlapWidth, visibleWidth } = getScrollImageDimensions(isFirst, overlapRatio);
    const previousImage = isFirst ? null : await loadPreviousImage(supabase, scroll.id, targetIndex - 1);
    const previousImageBuffer = previousImage ? await readImageBuffer(previousImage.full_image_url) : null;
    const referenceImageBase64 =
      previousImageBuffer && overlapWidth > 0 ? (await extractRightOverlapByWidth(previousImageBuffer, overlapWidth, height)).toString("base64") : undefined;
    const prompt = buildImagePrompt(scroll, targetIndex, Boolean(previousImageBuffer));
    const generated = await withGenerationTimeout(
      previousImageBuffer
        ? generateOutpaintedImage(prompt, previousImageBuffer, overlapRatio, referenceImageBase64, overlapWidth, height, width)
        : generateImage(prompt, referenceImageBase64),
    );

    if (!generated.imageBytes) {
      const message = "Image model did not return valid image bytes";
      await finishGenerationFailure(supabase, job.id, scroll.id, targetIndex, message);
      return { scrollId: scroll.id, targetIndex, failed: true, error: message };
    }

    if (previousImageBuffer && overlapWidth > 0) {
      generated.imageBytes = await copyPreviousOverlapIntoNewImage(generated.imageBytes, previousImageBuffer, {
        width,
        overlapWidth,
        height,
        overlapRatio,
      });
    } else {
      generated.imageBytes = await normalizeImageBuffer(generated.imageBytes, width, height);
    }

    const imageUrl = await persistGeneratedImage(supabase, scroll.id, targetIndex, generated.imageBytes, generated.mimeType);
    const { data: image, error: imageError } = await supabase
      .from("scroll_images")
      .insert({
        scroll_id: scroll.id,
        image_index: targetIndex,
        status: "succeeded",
        full_image_url: imageUrl,
        prompt: generated.prompt,
        model: generated.model,
        file_size_bytes: generated.imageBytes.byteLength,
        width,
        height,
        ratio_label: getRatioLabel(isFirst, overlapRatio),
        visible_crop: { x: overlapWidth, y: 0, width: visibleWidth, height },
        overlap_crop: { x: 0, y: 0, width: overlapWidth, height },
        new_content_crop: { x: overlapWidth, y: 0, width: visibleWidth, height },
        generated_at: now,
      })
      .select("id")
      .single();
    if (imageError) throw imageError;

    const nextRunAt = new Date(Date.now() + Number(scroll.interval_minutes ?? 5) * 60000).toISOString();
    await supabase
      .from("scrolls")
      .update({
        image_count: targetIndex,
        last_generated_at: now,
        next_run_at: nextRunAt,
        thumbnail_url: imageUrl,
        updated_at: now,
      })
      .eq("id", scroll.id);
    await finishJob(supabase, job.id, "succeeded");
    await supabase.from("generation_logs").insert({
      scroll_id: scroll.id,
      level: "success",
      message: `第 ${targetIndex} 张生成成功`,
      detail: `已生成并应用 ${overlapWidth}px 像素级重叠锁定。`,
    });

    return { scrollId: scroll.id, targetIndex, ok: true, imageUrl, imageId: image.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishGenerationFailure(supabase, job.id, scroll.id, targetIndex, message);
    return { scrollId: scroll.id, targetIndex, failed: true, error: message };
  }
}

async function loadPreviousImage(supabase: SupabaseAdmin, scrollId: string, imageIndex: number) {
  const { data, error } = await supabase
    .from("scroll_images")
    .select("full_image_url")
    .eq("scroll_id", scrollId)
    .eq("image_index", imageIndex)
    .single();
  if (error) throw error;
  return data;
}

async function readImageBuffer(imageUrl: string) {
  if (!imageUrl || imageUrl.startsWith("/")) return null;
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`Failed to download previous image: ${imageResponse.status}`);
  return Buffer.from(await imageResponse.arrayBuffer());
}

async function persistGeneratedImage(supabase: SupabaseAdmin, scrollId: string, targetIndex: number, imageBytes: Uint8Array, mimeType = "image/png") {
  await supabase.storage.createBucket(IMAGE_BUCKET, { public: true }).catch(() => undefined);
  const path = `scrolls/${scrollId}/${targetIndex}-${Date.now()}.png`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, imageBytes, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw error;
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function finishJob(supabase: SupabaseAdmin, jobId: string, status: "succeeded" | "failed", errorMessage?: string) {
  const { error } = await supabase
    .from("generation_jobs")
    .update({
      status,
      error_message: errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) throw error;
}

async function finishGenerationFailure(supabase: SupabaseAdmin, jobId: string, scrollId: string, targetIndex: number, errorMessage: string) {
  await finishJob(supabase, jobId, "failed", errorMessage);
  await supabase.from("generation_logs").insert({
    scroll_id: scrollId,
    level: "error",
    message: `第 ${targetIndex} 张生成失败`,
    detail: errorMessage.slice(0, 1000),
  });
}

function withGenerationTimeout<T>(promise: Promise<T>) {
  const timeoutMs = Number(process.env.GENERATION_TIMEOUT_MS ?? DEFAULT_GENERATION_TIMEOUT_MS);
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Image generation timed out after ${Math.round(timeoutMs / 60000)} minutes`)), timeoutMs);
    }),
  ]);
}

function buildImagePrompt(scroll: Record<string, unknown>, targetIndex: number, hasReferenceImage: boolean) {
  const isFirst = targetIndex === 1;
  return [
    "Create one segment of a continuous horizontal Chinese handscroll painting.",
    String(scroll.optimized_prompt ?? ""),
    `This is segment ${targetIndex}. ${
      isFirst
        ? "Start the scroll naturally with a 4:3 establishing composition."
        : "The left overlap will be locked from the previous segment's real pixels. Continue the scene naturally to the right with matching horizon, perspective, lighting, brush density, roads, rivers, buildings, figures, and terrain."
    }`,
    hasReferenceImage ? "Use the supplied left-edge context as a hard continuity anchor." : "",
    "No modern objects, no text labels, no UI, no frame, no watermark.",
  ]
    .filter(Boolean)
    .join("\n");
}

function getRatioLabel(isFirst: boolean, overlapRatio: number) {
  void isFirst;
  void overlapRatio;
  return "4:3";
}

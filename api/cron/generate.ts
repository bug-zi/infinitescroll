import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateImage, generateOutpaintedImage, type GeneratedImage } from "../_lib/ai.js";
import { getCandidateScrollFilters, isStaleRunningJob } from "../_lib/generationPlan.js";
import { getScrollImageDimensions } from "../_lib/imageDimensions.js";
import { calculateVisibleSeamQualityScore, copyPreviousOverlapIntoNewImage, extractRightOverlapByWidth, normalizeImageBuffer } from "../_lib/stitchImages.js";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { purgeImage, purgeScroll } from "../_lib/scrollPurge.js";
import { isCronRequestAuthorized } from "../_lib/cronAuth.js";
import { buildCreativePlanPromptSection, createCreativePlan, normalizeCreativePlan } from "../../src/lib/creativePlan";
import { formatUnknownError } from "../../src/lib/errorFormatting.js";
import { AI_SCRIPT_TEMPLATE, buildAiScriptCreativePlan, mapScriptFrameRow } from "../../src/lib/scriptDraft";

const DEFAULT_MAX_CONCURRENT_JOBS = 2;
const DEFAULT_GENERATION_TIMEOUT_MS = 12 * 60 * 1000;
const IMAGE_BUCKET = "scroll-images";
const FIXED_OVERLAP_RATIO = 0.25;

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;
type ScrollRow = Record<string, any>;

function isMissingArchiveColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const code = String(record.code ?? "");
  const message = String(record.message ?? "").toLowerCase();
  return code === "42703" && (message.includes("archived_at") || message.includes("purge_after"));
}

async function runOptionalArchiveMaintenance(taskName: string, task: () => Promise<void>) {
  try {
    await task();
  } catch (error) {
    if (!isMissingArchiveColumnError(error)) throw error;
    console.warn(`${taskName} skipped because archive columns are not installed yet`);
  }
}

async function queryMaybeActiveRows(activeQuery: PromiseLike<any>, fallbackQuery: PromiseLike<any>) {
  const result = await activeQuery;
  if (!result.error || !isMissingArchiveColumnError(result.error)) return result;
  console.warn("archive column filter skipped because archive columns are not installed yet");
  return await fallbackQuery;
}

async function purgeExpiredArchivedScrolls(supabase: SupabaseAdmin) {
  const { data, error } = await supabase.from("scrolls").select("id").not("archived_at", "is", null).lte("purge_after", new Date().toISOString());
  if (error) throw error;
  for (const scroll of data ?? []) {
    await purgeScroll(supabase, scroll.id);
  }
}

async function purgeExpiredArchivedImages(supabase: SupabaseAdmin) {
  const { data, error } = await supabase.from("scroll_images").select("id").not("archived_at", "is", null).lte("purge_after", new Date().toISOString());
  if (error) throw error;
  for (const image of data ?? []) {
    await purgeImage(supabase, image.id);
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (!isCronRequestAuthorized(request.headers.authorization)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const supabase = createSupabaseAdmin();
    await runOptionalArchiveMaintenance("purge expired archived scrolls", () => purgeExpiredArchivedScrolls(supabase));
    await runOptionalArchiveMaintenance("purge expired archived images", () => purgeExpiredArchivedImages(supabase));
    const maxConcurrentJobs = Number(process.env.MAX_CONCURRENT_JOBS ?? DEFAULT_MAX_CONCURRENT_JOBS);
    const scrollId = typeof request.query.scrollId === "string" ? request.query.scrollId : undefined;
    const manual = request.query.manual === "1" || request.query.background === "1";
    const filters = getCandidateScrollFilters({ scrollId, manual });

    const buildDueScrollsQuery = (includeArchiveFilter: boolean) => {
      let query = supabase.from("scrolls").select("*").limit(maxConcurrentJobs);
      if (includeArchiveFilter) query = query.is("archived_at", null);
      if (filters.requireAutoEnabled) query = query.eq("auto_generation_enabled", true);
      if (filters.scrollId) query = query.eq("id", filters.scrollId);
      if (filters.dueBeforeIso) query = query.lte("next_run_at", filters.dueBeforeIso);
      return query;
    };

    const { data: dueScrolls, error: dueError } = await queryMaybeActiveRows(buildDueScrollsQuery(true), buildDueScrollsQuery(false));
    if (dueError) throw dueError;

    const settled = await Promise.allSettled((dueScrolls ?? []).map((scroll: ScrollRow) => generateOneScrollImage(supabase, scroll)));
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
      error: formatUnknownError(error),
    });
  }
}

async function generateOneScrollImage(supabase: SupabaseAdmin, scroll: ScrollRow) {
  const targetIndex = Number(scroll.image_count ?? 0) + 1;
  const aiScriptFrame = await loadAiScriptFrameIfNeeded(supabase, scroll, targetIndex);
  if (aiScriptFrame?.complete) {
    await markScrollComplete(supabase, scroll.id);
    return { scrollId: scroll.id, targetIndex, skipped: "story_complete" };
  }
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
  let queuedJobResult = await supabase
    .from("generation_jobs")
    .select("id,creative_plan")
    .eq("scroll_id", scroll.id)
    .eq("target_index", targetIndex)
    .eq("status", "queued")
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (queuedJobResult.error && isMissingCreativePlanColumn(queuedJobResult.error)) {
    queuedJobResult = await supabase
      .from("generation_jobs")
      .select("id")
      .eq("scroll_id", scroll.id)
      .eq("target_index", targetIndex)
      .eq("status", "queued")
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .maybeSingle();
  }
  if (queuedJobResult.error) throw queuedJobResult.error;
  const queuedJob = queuedJobResult.data;
  const hasPersistedCreativePlan = Boolean(queuedJob?.creative_plan);

  const initialPlan = aiScriptFrame?.frame
    ? buildAiScriptCreativePlan({ frame: aiScriptFrame.frame, totalFrames: Number(scroll.story_total_frames ?? aiScriptFrame.totalFrames) })
    : normalizeCreativePlan(queuedJob?.creative_plan, {
        theme: scroll.original_theme,
        optimizedPrompt: scroll.optimized_prompt,
        generationMode: scroll.generation_mode,
        storyTemplate: scroll.story_template,
        storyTemplateVersion: scroll.story_template_version,
        storyTotalFrames: scroll.story_total_frames,
        targetIndex,
        hasReferenceImage: targetIndex > 1,
      });
  let jobResult = queuedJob
    ? await supabase
        .from("generation_jobs")
        .update({
          status: "running",
          scheduled_for: now,
          locked_at: now,
          locked_by: "vercel-cron",
          creative_plan: initialPlan,
          updated_at: now,
        })
        .eq("id", queuedJob.id)
        .select()
        .single()
    : await supabase
        .from("generation_jobs")
        .insert({
          scroll_id: scroll.id,
          target_index: targetIndex,
          type: "auto_next",
          status: "running",
          scheduled_for: now,
          locked_at: now,
          locked_by: "vercel-cron",
          creative_plan: initialPlan,
        })
        .select()
        .single();
  if (jobResult.error && isMissingCreativePlanColumn(jobResult.error)) {
    jobResult = queuedJob
      ? await supabase
          .from("generation_jobs")
          .update({
            status: "running",
            scheduled_for: now,
            locked_at: now,
            locked_by: "vercel-cron",
            updated_at: now,
          })
          .eq("id", queuedJob.id)
          .select()
          .single()
      : await supabase
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
  }
  const { data: job, error: jobError } = jobResult;

  if (jobError) return { scrollId: scroll.id, targetIndex, failed: true, error: jobError.message };

  try {
    const isFirst = targetIndex === 1;
    const overlapRatio = FIXED_OVERLAP_RATIO;
    const { width, height, overlapWidth, visibleWidth } = getScrollImageDimensions(isFirst, overlapRatio);
    const previousImage = isFirst ? null : await loadPreviousImage(supabase, scroll.id, targetIndex - 1);
    const previousImageBuffer = previousImage ? await readImageBuffer(previousImage.full_image_url) : null;
    const referenceImageBase64 =
      previousImageBuffer && overlapWidth > 0 ? (await extractRightOverlapByWidth(previousImageBuffer, overlapWidth, height)).toString("base64") : undefined;
    const creativePlan = aiScriptFrame?.frame
      ? buildAiScriptCreativePlan({
          frame: aiScriptFrame.frame,
          totalFrames: Number(scroll.story_total_frames ?? aiScriptFrame.totalFrames),
          previousSummary: targetIndex > 1 ? summarizePreviousPrompt(previousImage?.prompt, 240) : "",
        })
      : normalizeCreativePlan(hasPersistedCreativePlan ? job.creative_plan : undefined, {
          theme: scroll.original_theme,
          optimizedPrompt: scroll.optimized_prompt,
          generationMode: scroll.generation_mode,
          storyTemplate: scroll.story_template,
          storyTemplateVersion: scroll.story_template_version,
          storyTotalFrames: scroll.story_total_frames,
          previousPrompt: scroll.generation_mode === "story" ? undefined : summarizePreviousPrompt(previousImage?.prompt),
          targetIndex,
          hasReferenceImage: Boolean(previousImageBuffer),
        });
    if (JSON.stringify(creativePlan) !== JSON.stringify(job.creative_plan)) {
      await updateJobCreativePlan(supabase, job.id, creativePlan, now);
    }
    const prompt = buildImagePrompt(scroll, targetIndex, Boolean(previousImageBuffer), creativePlan);
    const generated: GeneratedImage = await withGenerationTimeout(
      previousImageBuffer
        ? generateOutpaintedImage(prompt, previousImageBuffer, overlapRatio, referenceImageBase64, overlapWidth, height, width)
        : generateImage(prompt, referenceImageBase64),
    );

    if (!generated.imageBytes) {
      const message = "Image model did not return valid image bytes";
      await finishGenerationFailure(supabase, job.id, scroll.id, targetIndex, message);
      return { scrollId: scroll.id, targetIndex, failed: true, error: message };
    }

    let stitchQualityScore: number | undefined;
    if (previousImageBuffer && overlapWidth > 0) {
      generated.imageBytes = await copyPreviousOverlapIntoNewImage(generated.imageBytes, previousImageBuffer, {
        width,
        overlapWidth,
        height,
        overlapRatio,
        featherWidth: Math.round(overlapWidth * 0.25),
      });
      stitchQualityScore = await calculateVisibleSeamQualityScore(generated.imageBytes, {
        seamX: overlapWidth,
        height,
        bandWidth: Math.round(overlapWidth * 0.125),
      });
    } else {
      generated.imageBytes = await normalizeImageBuffer(generated.imageBytes, width, height);
    }
    const hasStitchWarning = typeof stitchQualityScore === "number" && stitchQualityScore < 82;

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
        overlap_crop: { x: 0, y: 0, width: overlapWidth, height, stitchQualityScore },
        new_content_crop: { x: overlapWidth, y: 0, width: visibleWidth, height },
        has_stitch_warning: hasStitchWarning,
        generated_at: now,
      })
      .select("id")
      .single();
    if (imageError) throw imageError;

    const nextRunAt = new Date(Date.now() + Number(scroll.interval_minutes ?? 5) * 60000).toISOString();
    const nextFrame = await loadAiScriptFrameIfNeeded(supabase, scroll, targetIndex + 1);
    const nextPlan = nextFrame?.frame
      ? buildAiScriptCreativePlan({
          frame: nextFrame.frame,
          totalFrames: Number(scroll.story_total_frames ?? nextFrame.totalFrames),
          previousSummary: summarizePreviousPlanForNextPrompt(creativePlan, generated.prompt),
        })
      : createCreativePlan({
          theme: scroll.original_theme,
          optimizedPrompt: scroll.optimized_prompt,
          generationMode: scroll.generation_mode,
          storyTemplate: scroll.story_template,
          storyTemplateVersion: scroll.story_template_version,
          storyTotalFrames: scroll.story_total_frames,
          previousPrompt: summarizePreviousPlanForNextPrompt(creativePlan, generated.prompt),
          targetIndex: targetIndex + 1,
          hasReferenceImage: true,
        });
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
    await insertQueuedJob(supabase, {
      scrollId: scroll.id,
      targetIndex: targetIndex + 1,
      scheduledFor: nextRunAt,
      creativePlan: nextPlan,
    }, { skip: Boolean(nextFrame?.complete) });
    if (nextFrame?.complete) await markScrollComplete(supabase, scroll.id);
    await finishJob(supabase, job.id, "succeeded");
    await supabase.from("generation_logs").insert({
      scroll_id: scroll.id,
      level: hasStitchWarning ? "warning" : "success",
      message: `第 ${targetIndex} 张生成成功`,
      detail:
        typeof stitchQualityScore === "number"
          ? `已生成并应用 ${overlapWidth}px 像素级重叠锁定；真实接缝评分 ${stitchQualityScore} 分。`
          : `已生成并应用 ${overlapWidth}px 像素级重叠锁定。`,
    });

    return { scrollId: scroll.id, targetIndex, ok: true, imageUrl, imageId: image.id };
  } catch (error) {
    const message = formatUnknownError(error);
    await finishGenerationFailure(supabase, job.id, scroll.id, targetIndex, message);
    return { scrollId: scroll.id, targetIndex, failed: true, error: message };
  }
}

async function loadPreviousImage(supabase: SupabaseAdmin, scrollId: string, imageIndex: number) {
  const buildQuery = (includeArchiveFilter: boolean) => {
    let query = supabase.from("scroll_images").select("full_image_url,prompt").eq("scroll_id", scrollId).eq("image_index", imageIndex);
    if (includeArchiveFilter) query = query.is("archived_at", null);
    return query.single();
  };

  const { data, error } = await queryMaybeActiveRows(buildQuery(true), buildQuery(false));
  if (error) throw error;
  return data;
}

function isMissingCreativePlanColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const message = String(record.message ?? "").toLowerCase();
  const code = String(record.code ?? "");
  return code === "PGRST204" || code === "42703" || (message.includes("creative_plan") && (message.includes("column") || message.includes("does not exist")));
}

async function updateJobCreativePlan(supabase: SupabaseAdmin, jobId: string, creativePlan: unknown, now: string) {
  const { error } = await supabase.from("generation_jobs").update({ creative_plan: creativePlan, updated_at: now }).eq("id", jobId);
  if (error && !isMissingCreativePlanColumn(error)) throw error;
}

async function insertQueuedJob(
  supabase: SupabaseAdmin,
  input: { scrollId: string; targetIndex: number; scheduledFor: string; creativePlan: unknown },
  options: { skip?: boolean } = {},
) {
  if (options.skip) return;
  const payload = {
    scroll_id: input.scrollId,
    target_index: input.targetIndex,
    type: "auto_next",
    status: "queued",
    scheduled_for: input.scheduledFor,
    creative_plan: input.creativePlan,
  };
  const { error } = await supabase.from("generation_jobs").insert(payload);
  if (!error) return;
  if (!isMissingCreativePlanColumn(error)) throw error;
  const { error: fallbackError } = await supabase.from("generation_jobs").insert({
    scroll_id: input.scrollId,
    target_index: input.targetIndex,
    type: "auto_next",
    status: "queued",
    scheduled_for: input.scheduledFor,
  });
  if (fallbackError) throw fallbackError;
}

async function loadAiScriptFrameIfNeeded(supabase: SupabaseAdmin, scroll: ScrollRow, targetIndex: number) {
  if (scroll.generation_mode !== "story" || scroll.story_template !== AI_SCRIPT_TEMPLATE) return null;
  const totalFrames = Number(scroll.story_total_frames ?? 0);
  if (totalFrames > 0 && targetIndex > totalFrames) return { complete: true as const, totalFrames };
  const { data, error } = await supabase
    .from("scroll_story_frames")
    .select("*")
    .eq("scroll_id", scroll.id)
    .eq("frame_index", targetIndex)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { complete: true as const, totalFrames };
  return { complete: false as const, totalFrames, frame: mapScriptFrameRow(data) };
}

async function markScrollComplete(supabase: SupabaseAdmin, scrollId: string) {
  const { error } = await supabase
    .from("scrolls")
    .update({ status: "complete", auto_generation_enabled: false, updated_at: new Date().toISOString() })
    .eq("id", scrollId);
  if (error) throw error;
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
  const error = await uploadWithRetry(async () => {
    const result = await supabase.storage.from(IMAGE_BUCKET).upload(path, imageBytes, {
      contentType: mimeType,
      upsert: true,
    });
    return result.error;
  });
  if (error) throw error;
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function uploadWithRetry(upload: () => Promise<{ message?: string } | null>, maxAttempts = 2) {
  let lastError: { message?: string } | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastError = await upload();
    if (!lastError) return null;
    if (!isRetryableStorageError(lastError) || attempt === maxAttempts) return lastError;
    await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
  }
  return lastError;
}

function isRetryableStorageError(error: { message?: string }) {
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("aborted") || message.includes("timeout") || message.includes("fetch failed") || message.includes("network");
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

function summarizePreviousPrompt(value: unknown, maxLength = 360) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function summarizePreviousPlanForNextPrompt(plan: Record<string, any>, fallbackPrompt: unknown) {
  if (plan?.mode === "story") {
    const characters = Array.isArray(plan.characters) && plan.characters.length ? `人物：${plan.characters.join("、")}` : "";
    return summarizePreviousPrompt(
      [
        plan.title ? `上一帧：${plan.title}` : "",
        plan.chapter ? `章节：${plan.chapter}` : "",
        characters,
        plan.location ? `地点：${plan.location}` : "",
        plan.newScene ? `画面：${plan.newScene}` : "",
      ]
        .filter(Boolean)
        .join("；"),
      320,
    );
  }
  return summarizePreviousPrompt(fallbackPrompt);
}

function buildImagePrompt(scroll: Record<string, unknown>, targetIndex: number, hasReferenceImage: boolean, creativePlan = createCreativePlan({ targetIndex, hasReferenceImage })) {
  const isFirst = targetIndex === 1;
  const theme = String(scroll.original_theme ?? "连续横向画卷");
  const optimizedPrompt = String(scroll.optimized_prompt ?? "");
  const isStoryMode = creativePlan.mode === "story";
  return [
    isStoryMode ? "Create one frame of a Journey to the West sequential comic handscroll." : "Create one segment of a continuous horizontal Chinese handscroll painting.",
    "Visual style must follow the user theme and long-term scroll direction exactly. Do not default to Along the River During the Qingming Festival, Bianjing market scenes, riverbank tea shops, or Northern Song city life unless the user explicitly requested that subject.",
    `User theme: ${theme}`,
    optimizedPrompt ? `Long-term scroll direction: ${optimizedPrompt}` : "",
    isStoryMode
      ? `This is story frame ${creativePlan.storyFrameIndex} of ${creativePlan.storyTotalFrames}. Depict only this storyboard frame; do not foreshadow, skip, merge, or invent later Journey to the West events.`
      : `This is segment ${targetIndex}. ${
          isFirst
            ? "Start the scroll naturally with a 4:3 establishing composition."
            : "The left overlap will be locked from the previous segment's real pixels. Continue the scene naturally to the right with matching horizon, perspective, lighting, brush density, roads, rivers, buildings, figures, and terrain."
        }`,
    hasReferenceImage
      ? isStoryMode
        ? "Use the supplied left-edge context only for palette, paper texture, and scroll transition; story accuracy has priority over same-location seamlessness."
        : "Use the supplied left-edge context as a hard continuity anchor."
      : "",
    buildCreativePlanPromptSection(creativePlan),
    isStoryMode
      ? "Keep character designs consistent across frames: Sun Wukong has monkey features, pilgrim outfit, and golden cudgel; Tang Sanzang wears monk robes; Zhu Bajie carries a rake; Sha Seng carries the luggage pole; White Dragon Horse stays a white horse."
      : "",
    "No modern objects, no text labels, no UI, no frame, no watermark.",
  ]
    .filter(Boolean)
    .join("\n");
}

function getRatioLabel(isFirst: boolean, overlapRatio: number) {
  if (isFirst) return "4:3";
  const widthUnits = 4 * (1 + overlapRatio);
  return `${Number.isInteger(widthUnits) ? widthUnits : widthUnits.toFixed(1)}:3`;
}

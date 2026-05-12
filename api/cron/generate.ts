import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateImage, generateOutpaintedImage, type GeneratedImage } from "../_lib/ai.js";
import {
  canPersistGeneratedJobResult,
  getCandidateScrollFilters,
  isStaleRunningJob,
  isStoryTargetBeyondEnd,
  shouldCompleteStoryAfterFrame,
} from "../_lib/generationPlan.js";
import { getScrollImageDimensions } from "../_lib/imageDimensions.js";
import { calculateVisibleSeamQualityScore, copyPreviousOverlapIntoNewImage, extractRightOverlapByWidth, normalizeImageBuffer } from "../_lib/stitchImages.js";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { purgeImage, purgeScroll } from "../_lib/scrollPurge.js";
import { isCronRequestAuthorized } from "../_lib/cronAuth.js";
import { buildCreativePlanPromptSection, createCreativePlan, normalizeCreativePlan } from "../../src/lib/creativePlan";
import { formatUnknownError } from "../../src/lib/errorFormatting.js";
import { AI_SCRIPT_TEMPLATE, buildAiScriptCreativePlan, mapScriptFrameRow } from "../../src/lib/scriptDraft";
import {
  buildFallbackStyleWarning,
  buildStyleLockPromptSection,
  forbidsPaperScrollTexture,
  summarizePreviousFrameForNextPrompt,
  summarizePromptFallback,
} from "../../src/lib/styleLock";
import { detectPaperBorderDrift } from "../_lib/imageValidation.js";

const DEFAULT_MAX_CONCURRENT_JOBS = 2;
const DEFAULT_GENERATION_TIMEOUT_MS = 12 * 60 * 1000;
const DEFAULT_POST_GENERATION_STAGE_TIMEOUT_MS = 5 * 60 * 1000;
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
    const releasedStaleJobs = await releaseStaleRunningJobs(supabase, "Running job timed out and was released by scheduler");
    if (releasedStaleJobs) console.info(`Released ${releasedStaleJobs} stale running generation job(s)`);
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
  if (isStoryTargetBeyondEnd({ generationMode: scroll.generation_mode, storyTotalFrames: scroll.story_total_frames, targetIndex })) {
    await markScrollComplete(supabase, scroll.id);
    return { scrollId: scroll.id, targetIndex, skipped: "story_complete" };
  }
  const aiScriptFrame = await loadAiScriptFrameIfNeeded(supabase, scroll, targetIndex);
  if (aiScriptFrame?.complete) {
    await markScrollComplete(supabase, scroll.id);
    return { scrollId: scroll.id, targetIndex, skipped: "story_complete" };
  }
  const existingTargetImage = await loadExistingGeneratedImage(supabase, scroll.id, targetIndex);
  if (existingTargetImage) {
    return await recoverExistingGeneratedFrame(supabase, scroll, targetIndex, existingTargetImage);
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
    if (!isFirst && !previousImageBuffer) {
      const message = `Previous frame ${targetIndex - 1} image could not be downloaded; strict scroll continuation requires a reference image`;
      await finishGenerationFailure(supabase, job.id, scroll.id, targetIndex, message);
      return { scrollId: scroll.id, targetIndex, failed: true, error: message };
    }
    const styleReferenceImageBuffer = previousImageBuffer ? await loadStyleReferenceImageBuffer(supabase, scroll.id, targetIndex, previousImageBuffer) : null;
    const styleReferenceImageBase64 = styleReferenceImageBuffer ? Buffer.from(styleReferenceImageBuffer).toString("base64") : undefined;
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
    const prompt = buildImagePrompt(scroll, targetIndex, Boolean(previousImageBuffer), creativePlan, Boolean(styleReferenceImageBase64));
    const generated: GeneratedImage = await withGenerationTimeout(
      previousImageBuffer
        ? generateOutpaintedImage(prompt, previousImageBuffer, overlapRatio, referenceImageBase64, overlapWidth, height, width, styleReferenceImageBase64)
        : generateImage(prompt, referenceImageBase64),
    );

    if (!generated.imageBytes) {
      const message = "Image model did not return valid image bytes";
      await finishGenerationFailure(supabase, job.id, scroll.id, targetIndex, message);
      return { scrollId: scroll.id, targetIndex, failed: true, error: message };
    }
    let imageBytes = generated.imageBytes;
    console.info(`frame ${targetIndex} image generation returned`, { bytes: imageBytes.byteLength, model: generated.model });

    let stitchQualityScore: number | undefined;
    if (previousImageBuffer && overlapWidth > 0) {
      imageBytes = await withPostGenerationStage(`frame ${targetIndex} overlap postprocess`, () =>
        copyPreviousOverlapIntoNewImage(imageBytes, previousImageBuffer, {
          width,
          overlapWidth,
          height,
          overlapRatio,
          featherWidth: Math.round(overlapWidth * 0.25),
        }),
      );
      stitchQualityScore = await withPostGenerationStage(`frame ${targetIndex} seam score`, () =>
        calculateVisibleSeamQualityScore(imageBytes, {
          seamX: overlapWidth,
          height,
          bandWidth: Math.round(overlapWidth * 0.125),
        }),
      );
    } else {
      imageBytes = await withPostGenerationStage(`frame ${targetIndex} normalize image`, () => normalizeImageBuffer(imageBytes, width, height));
    }
    const hasStitchWarning = typeof stitchQualityScore === "number" && stitchQualityScore < 82;
    const styleFallbackWarning = buildFallbackStyleWarning(generated.model);
    if (shouldEnforceFullBleedCanvas(generated.prompt)) {
      const paperBorderCheck = await withPostGenerationStage(`frame ${targetIndex} full-bleed paper border check`, () => detectPaperBorderDrift(imageBytes));
      if (paperBorderCheck.hasPaperBorderDrift) {
        const message = paperBorderCheck.reason ?? "Generated image contains paper border drift";
        await finishGenerationFailure(supabase, job.id, scroll.id, targetIndex, message);
        return { scrollId: scroll.id, targetIndex, failed: true, error: message };
      }
    }
    const persistCheck = await withPostGenerationStage(`frame ${targetIndex} persist eligibility check`, () =>
      canPersistGeneratedImageResult(supabase, job.id, scroll.id, targetIndex),
    );
    if (!persistCheck.canPersist) {
      await finishJob(supabase, job.id, "failed", persistCheck.reason);
      await safeInsertGenerationLog(supabase, {
        scroll_id: scroll.id,
        level: "warning",
        message: `第 ${targetIndex} 张重复生成已丢弃`,
        detail: persistCheck.reason,
      });
      return { scrollId: scroll.id, targetIndex, skipped: "duplicate_or_released_job", error: persistCheck.reason };
    }

    const imageUrl = await withPostGenerationStage(`frame ${targetIndex} storage upload`, () =>
      persistGeneratedImage(supabase, scroll.id, targetIndex, imageBytes, generated.mimeType),
    );
    const image = await withPostGenerationStage(`frame ${targetIndex} image row insert`, () =>
      insertGeneratedImageRow(supabase, scroll, targetIndex, imageUrl, generated, imageBytes, {
        width,
        height,
        visibleWidth,
        overlapWidth,
        overlapRatio,
        isFirst,
        stitchQualityScore,
        hasStitchWarning,
        now,
      }),
    );
    if (!image?.id) throw new Error(`Frame ${targetIndex} image row insert returned no image id`);

    const completedAt = new Date().toISOString();
    const nextRunAt = new Date(Date.now() + Number(scroll.interval_minutes ?? 5) * 60000).toISOString();
    const completesStory = shouldCompleteStoryAfterFrame({ generationMode: scroll.generation_mode, storyTotalFrames: scroll.story_total_frames, targetIndex });
    const nextFrame = completesStory ? { complete: true as const } : await loadAiScriptFrameIfNeeded(supabase, scroll, targetIndex + 1);
    const nextPlan = nextFrame?.complete
      ? null
      : nextFrame?.frame
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
    await withPostGenerationStage(`frame ${targetIndex} scroll row update`, () =>
      runSupabaseResult(`frame ${targetIndex} scroll row update`, () =>
        supabase
          .from("scrolls")
          .update({
            image_count: targetIndex,
            last_generated_at: completedAt,
            next_run_at: nextRunAt,
            thumbnail_url: imageUrl,
            updated_at: completedAt,
          })
          .eq("id", scroll.id),
      ),
    );
    if (!nextFrame?.complete && nextPlan) {
      await withPostGenerationStage(`frame ${targetIndex} queue next frame`, () =>
        retryTransientOperation(`frame ${targetIndex} queue next frame`, () =>
          insertQueuedJob(supabase, {
            scrollId: scroll.id,
            targetIndex: targetIndex + 1,
            scheduledFor: nextRunAt,
            creativePlan: nextPlan,
          }),
        ),
      );
    }
    if (nextFrame?.complete) await markScrollComplete(supabase, scroll.id);
    await finishJob(supabase, job.id, "succeeded");
    const logDetail = [
      typeof stitchQualityScore === "number"
        ? `已生成并应用 ${overlapWidth}px 像素级重叠锁定；真实接缝评分 ${stitchQualityScore} 分。`
        : `已生成并应用 ${overlapWidth}px 像素级重叠锁定。`,
      styleFallbackWarning,
    ]
      .filter(Boolean)
      .join("\n");
    await safeInsertGenerationLog(supabase, {
      scroll_id: scroll.id,
      level: hasStitchWarning || styleFallbackWarning ? "warning" : "success",
      message: `第 ${targetIndex} 张生成成功`,
      detail: logDetail,
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

async function insertGeneratedImageRow(
  supabase: SupabaseAdmin,
  scroll: ScrollRow,
  targetIndex: number,
  imageUrl: string,
  generated: GeneratedImage,
  imageBytes: Uint8Array,
  dimensions: {
    width: number;
    height: number;
    visibleWidth: number;
    overlapWidth: number;
    overlapRatio: number;
    isFirst: boolean;
    stitchQualityScore?: number;
    hasStitchWarning: boolean;
    now: string;
  },
) {
  const { width, height, visibleWidth, overlapWidth, overlapRatio, isFirst, stitchQualityScore, hasStitchWarning, now } = dimensions;
  const payload = {
    scroll_id: scroll.id,
    image_index: targetIndex,
    status: "succeeded",
    full_image_url: imageUrl,
    prompt: generated.prompt,
    model: generated.model,
    file_size_bytes: imageBytes.byteLength,
    width,
    height,
    ratio_label: getRatioLabel(isFirst, overlapRatio),
    visible_crop: { x: overlapWidth, y: 0, width: visibleWidth, height },
    overlap_crop: { x: 0, y: 0, width: overlapWidth, height, stitchQualityScore },
    new_content_crop: { x: overlapWidth, y: 0, width: visibleWidth, height },
    has_stitch_warning: hasStitchWarning,
    generated_at: now,
  };

  return await retryTransientOperation(`frame ${targetIndex} image row insert`, async () => {
    const existingBeforeInsert = await loadExistingGeneratedImage(supabase, scroll.id, targetIndex);
    if (existingBeforeInsert) return existingBeforeInsert;

    const { data, error } = await supabase.from("scroll_images").insert(payload).select("id,full_image_url,prompt,generated_at,created_at").single();
    if (!error) return data;

    const existingAfterInsertError = await loadExistingGeneratedImage(supabase, scroll.id, targetIndex);
    if (existingAfterInsertError) return existingAfterInsertError;
    throw error;
  });
}

async function loadExistingGeneratedImage(supabase: SupabaseAdmin, scrollId: string, targetIndex: number) {
  const { data, error } = await supabase
    .from("scroll_images")
    .select("id,full_image_url,prompt,generated_at,created_at")
    .eq("scroll_id", scrollId)
    .eq("image_index", targetIndex)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function recoverExistingGeneratedFrame(supabase: SupabaseAdmin, scroll: ScrollRow, targetIndex: number, image: Record<string, any>) {
  const now = new Date().toISOString();
  const nextRunAt = new Date(Date.now() + Number(scroll.interval_minutes ?? 5) * 60000).toISOString();
  await withPostGenerationStage(`frame ${targetIndex} recover scroll row update`, () =>
    runSupabaseResult(`frame ${targetIndex} recover scroll row update`, () =>
      supabase
        .from("scrolls")
        .update({
          image_count: targetIndex,
          last_generated_at: image.generated_at ?? image.created_at ?? now,
          next_run_at: nextRunAt,
          thumbnail_url: image.full_image_url,
          updated_at: now,
        })
        .eq("id", scroll.id),
    ),
  );

  const completesStory = shouldCompleteStoryAfterFrame({ generationMode: scroll.generation_mode, storyTotalFrames: scroll.story_total_frames, targetIndex });
  const nextFrame = completesStory ? { complete: true as const } : await loadAiScriptFrameIfNeeded(supabase, scroll, targetIndex + 1);
  if (nextFrame?.complete) {
    await markScrollComplete(supabase, scroll.id);
  } else {
    const nextPlan = nextFrame?.frame
      ? buildAiScriptCreativePlan({
          frame: nextFrame.frame,
          totalFrames: Number(scroll.story_total_frames ?? nextFrame.totalFrames),
          previousSummary: summarizePromptFallback(image.prompt, 240),
        })
      : createCreativePlan({
          theme: scroll.original_theme,
          optimizedPrompt: scroll.optimized_prompt,
          generationMode: scroll.generation_mode,
          storyTemplate: scroll.story_template,
          storyTemplateVersion: scroll.story_template_version,
          storyTotalFrames: scroll.story_total_frames,
          previousPrompt: summarizePromptFallback(image.prompt, 240),
          targetIndex: targetIndex + 1,
          hasReferenceImage: true,
        });
    await withPostGenerationStage(`frame ${targetIndex} recover queue next frame`, () =>
      retryTransientOperation(`frame ${targetIndex} recover queue next frame`, () =>
        insertQueuedJob(supabase, {
          scrollId: scroll.id,
          targetIndex: targetIndex + 1,
          scheduledFor: nextRunAt,
          creativePlan: nextPlan,
        }),
      ),
    );
  }

  await runSupabaseResult(`frame ${targetIndex} recover running jobs`, () =>
    supabase
      .from("generation_jobs")
      .update({
        status: "succeeded",
        error_message: "Recovered from an existing generated image row",
        updated_at: now,
      })
      .eq("scroll_id", scroll.id)
      .eq("target_index", targetIndex)
      .eq("status", "running"),
  );
  await safeInsertGenerationLog(supabase, {
    scroll_id: scroll.id,
    level: "success",
    message: `第 ${targetIndex} 张已恢复`,
    detail: "检测到图片已保存但画卷计数未推进，已恢复生成进度并继续排队下一张。",
  });
  return { scrollId: scroll.id, targetIndex, recovered: true, imageUrl: image.full_image_url, imageId: image.id };
}

async function loadStyleReferenceImageBuffer(supabase: SupabaseAdmin, scrollId: string, targetIndex: number, fallbackBuffer: Buffer | Uint8Array) {
  if (targetIndex <= 1) return null;
  try {
    const referenceImage = await loadPreviousImage(supabase, scrollId, 1);
    if (!referenceImage?.full_image_url) return fallbackBuffer;
    return (await readImageBuffer(referenceImage.full_image_url)) ?? fallbackBuffer;
  } catch (error) {
    console.warn("style reference image load failed; using previous frame as style reference", error);
    return fallbackBuffer;
  }
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
  const { error: jobError } = await supabase
    .from("generation_jobs")
    .update({ status: "cancelled", error_message: "Story completed", updated_at: new Date().toISOString() })
    .eq("scroll_id", scrollId)
    .eq("status", "queued");
  if (jobError) throw jobError;
}

async function readImageBuffer(imageUrl: string) {
  if (!imageUrl || imageUrl.startsWith("/")) return null;
  const timeoutMs = Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS ?? 60000);
  const maxAttempts = normalizePositiveInteger(process.env.IMAGE_DOWNLOAD_MAX_ATTEMPTS, 3);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const imageResponse = await fetch(imageUrl, { signal: controller.signal });
      if (imageResponse.ok) return Buffer.from(await imageResponse.arrayBuffer());
      if (!isRetryableImageDownloadStatus(imageResponse.status) || attempt === maxAttempts) return null;
      console.warn(`image download returned ${imageResponse.status}; retrying ${attempt + 1}/${maxAttempts}`);
    } catch (error) {
      if (!isRetryableTransientFetchError(error) || attempt === maxAttempts) return null;
      console.warn(`image download failed; retrying ${attempt + 1}/${maxAttempts}`, error);
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
  }
  return null;
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isRetryableImageDownloadStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
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
  await runSupabaseResult(`finish job ${jobId}`, () =>
    supabase
      .from("generation_jobs")
      .update({
        status,
        error_message: errorMessage ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId),
  );
}

async function releaseStaleRunningJobs(supabase: SupabaseAdmin, errorMessage: string) {
  const { data: runningJobs, error } = await supabase.from("generation_jobs").select("id,locked_at").eq("status", "running");
  if (error) throw error;
  let released = 0;
  for (const job of runningJobs ?? []) {
    if (!isStaleRunningJob({ lockedAt: job.locked_at as string | null })) continue;
    await finishJob(supabase, job.id, "failed", errorMessage);
    released += 1;
  }
  return released;
}

async function finishGenerationFailure(supabase: SupabaseAdmin, jobId: string, scrollId: string, targetIndex: number, errorMessage: string) {
  await finishJob(supabase, jobId, "failed", errorMessage);
  await safeInsertGenerationLog(supabase, {
    scroll_id: scrollId,
    level: "error",
    message: `第 ${targetIndex} 张生成失败`,
    detail: errorMessage.slice(0, 1000),
  });
}

async function canPersistGeneratedImageResult(supabase: SupabaseAdmin, jobId: string, scrollId: string, targetIndex: number) {
  return await retryTransientOperation(`frame ${targetIndex} persist eligibility check`, async () => {
    const [{ data: currentJob, error: jobError }, { data: existingImage, error: imageError }] = await Promise.all([
      supabase.from("generation_jobs").select("status").eq("id", jobId).maybeSingle(),
      supabase.from("scroll_images").select("id").eq("scroll_id", scrollId).eq("image_index", targetIndex).maybeSingle(),
    ]);
    if (jobError) throw jobError;
    if (imageError) throw imageError;
    const canPersist = canPersistGeneratedJobResult({
      jobStatus: currentJob?.status,
      existingImageId: existingImage?.id,
    });
    return {
      canPersist,
      reason: existingImage?.id
        ? `Target image ${targetIndex} already exists; discarding duplicate generated result`
        : `Job ${jobId} is no longer running; discarding late generated result`,
    };
  });
}

async function safeInsertGenerationLog(supabase: SupabaseAdmin, payload: Record<string, unknown>) {
  await retryTransientOperation(`generation log: ${String(payload.message ?? "insert")}`, async () => {
    const { error } = await supabase.from("generation_logs").insert(payload);
    if (error) throw error;
  }).catch((error) => {
    console.warn("generation log insert skipped after retries", error);
  });
}

async function retryTransientOperation<T>(label: string, task: () => Promise<T>, maxAttempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) console.warn(`${label} retry ${attempt}/${maxAttempts}`);
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransientFetchError(error) || attempt === maxAttempts) throw error;
      const delayMs = 1000 * attempt;
      console.warn(`${label} transient failure, retrying in ${delayMs}ms`, error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

async function runSupabaseResult<T extends { error?: unknown }>(label: string, task: () => PromiseLike<T>, maxAttempts = 3) {
  return await retryTransientOperation(label, async () => {
    const result = await task();
    if (result?.error) throw result.error;
    return result;
  }, maxAttempts);
}

function isRetryableTransientFetchError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown };
  const name = String(record.name ?? "");
  const message = String(record.message ?? "").toLowerCase();
  return name === "AbortError" || name === "TypeError" || message.includes("fetch failed") || message.includes("timeout") || message.includes("aborted") || message.includes("network");
}

function withGenerationTimeout<T>(promise: Promise<T>) {
  const timeoutMs = parsePositiveInteger(process.env.GENERATION_TIMEOUT_MS) ?? DEFAULT_GENERATION_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Image generation timed out after ${Math.round(timeoutMs / 60000)} minutes`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function withPostGenerationStage<T>(stageName: string, task: () => PromiseLike<T>): Promise<T> {
  const timeoutMs = parsePositiveInteger(process.env.POST_GENERATION_STAGE_TIMEOUT_MS) ?? DEFAULT_POST_GENERATION_STAGE_TIMEOUT_MS;
  const startedAt = Date.now();
  console.info(`${stageName} started`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve(task()),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${stageName} timed out after ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
      }),
    ]);
    console.info(`${stageName} finished in ${Date.now() - startedAt}ms`);
    return result;
  } catch (error) {
    console.warn(`${stageName} failed after ${Date.now() - startedAt}ms`, error);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parsePositiveInteger(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function summarizePreviousPrompt(value: unknown, maxLength = 360) {
  return summarizePromptFallback(value, maxLength);
}

function summarizePreviousPlanForNextPrompt(plan: Record<string, any>, fallbackPrompt: unknown) {
  return summarizePreviousFrameForNextPrompt(plan, fallbackPrompt);
}

export function buildImagePrompt(
  scroll: Record<string, unknown>,
  targetIndex: number,
  hasReferenceImage: boolean,
  creativePlan = createCreativePlan({ targetIndex, hasReferenceImage }),
  hasStyleReferenceImage = false,
) {
  const isFirst = targetIndex === 1;
  const theme = String(scroll.original_theme ?? "连续横向画卷");
  const optimizedPrompt = String(scroll.optimized_prompt ?? "");
  const isStoryMode = creativePlan.mode === "story";
  const storyTemplate = String(scroll.story_template ?? creativePlan.storyTemplate ?? "");
  const isJourneyToWestStory = storyTemplate === "journey_to_west";
  const avoidPaperScrollTexture = forbidsPaperScrollTexture({
    theme,
    optimizedPrompt,
    characterBible: scroll.character_bible,
    scriptSummary: scroll.script_summary,
    generationMode: String(scroll.generation_mode ?? creativePlan.mode ?? ""),
  });
  const optimizedPromptForOutput = avoidPaperScrollTexture ? sanitizePaperScrollTriggers(optimizedPrompt) : optimizedPrompt;
  const styleLock = buildStyleLockPromptSection({
    theme,
    optimizedPrompt: optimizedPromptForOutput,
    characterBible: scroll.character_bible,
    scriptSummary: scroll.script_summary,
    generationMode: String(scroll.generation_mode ?? creativePlan.mode ?? ""),
  });
  return [
    isStoryMode
      ? isJourneyToWestStory
        ? "Create one frame of a Journey to the West sequential comic handscroll."
        : avoidPaperScrollTexture
          ? "Create one full-bleed horizontal Chinese comic storyboard frame."
          : "Create one frame of a sequential story handscroll."
      : "Create one segment of a continuous horizontal Chinese handscroll painting.",
    "Visual style must follow the user theme and long-term scroll direction exactly. Do not default to Along the River During the Qingming Festival, Bianjing market scenes, riverbank tea shops, or Northern Song city life unless the user explicitly requested that subject.",
    `User theme: ${theme}`,
    optimizedPromptForOutput ? `Long-term scroll direction: ${optimizedPromptForOutput}` : "",
    styleLock,
    isStoryMode
      ? `This is story frame ${creativePlan.storyFrameIndex} of ${creativePlan.storyTotalFrames}. Depict only this storyboard frame; do not foreshadow, skip, merge, or invent later story events.`
      : `This is segment ${targetIndex}. ${
          isFirst
            ? "Start the scroll naturally with a 4:3 establishing composition."
            : "The left overlap will be locked from the previous segment's real pixels. Continue the scene naturally to the right with matching horizon, perspective, lighting, brush density, roads, rivers, buildings, figures, and terrain."
        }`,
    hasReferenceImage
      ? isStoryMode
        ? avoidPaperScrollTexture
          ? "Use the supplied left-edge context as a hard visual anchor: match composition density, figure scale, linework, color temperature, lighting direction, garden architecture, and canvas boundary. The story may advance, but the medium and canvas edges must not change."
          : "Use the supplied left-edge context only for palette, paper texture, and scroll transition; story accuracy has priority over same-location seamlessness."
        : "Use the supplied left-edge context as a hard continuity anchor."
      : "",
    hasStyleReferenceImage
      ? avoidPaperScrollTexture
        ? "A first-frame style reference is attached. Match its clean linework, palette, character proportions, figure scale, brush density, and comic rendering while still continuing the previous right edge."
        : "A first-frame style reference is attached. Match its linework, palette, paper texture, character proportions, figure scale, brush density, and antique scroll finish while still continuing the previous right edge."
      : "",
    avoidPaperScrollTexture
      ? "Full-bleed canvas requirement: fill the entire 1536x1152 image with scene content. No paper borders, no mounted scroll frame, no blank pale bands, no beige margin, and no top, bottom, left, or right decorative border."
      : "",
    avoidPaperScrollTexture ? sanitizePaperScrollTriggers(buildCreativePlanPromptSection(creativePlan)) : buildCreativePlanPromptSection(creativePlan),
    isStoryMode && isJourneyToWestStory
      ? "Keep character designs consistent across frames: Sun Wukong has monkey features, pilgrim outfit, and golden cudgel; Tang Sanzang wears monk robes; Zhu Bajie carries a rake; Sha Seng carries the luggage pole; White Dragon Horse stays a white horse."
      : "",
    "No modern objects, no text labels, no UI, no frame, no watermark.",
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizePaperScrollTriggers(value: string) {
  return value
    .replace(/\bhandscroll\b/gi, "horizontal comic sequence")
    .replace(/\bpaper texture\b/gi, "surface consistency")
    .replace(/\bscroll transition\b/gi, "visual continuity")
    .replace(/\bantique scroll finish\b/gi, "comic finish")
    .replace(/\breal antique panoramic scroll\b/gi, "continuous panoramic comic scene")
    .replace(/卷轴纹理/g, "画面动线")
    .replace(/卷轴衔接/g, "画面衔接");
}

function shouldEnforceFullBleedCanvas(prompt: string) {
  return /full-bleed canvas requirement/i.test(prompt) || /no paper borders/i.test(prompt);
}

function getRatioLabel(isFirst: boolean, overlapRatio: number) {
  if (isFirst) return "4:3";
  const widthUnits = 4 * (1 + overlapRatio);
  return `${Number.isInteger(widthUnits) ? widthUnits : widthUnits.toFixed(1)}:3`;
}

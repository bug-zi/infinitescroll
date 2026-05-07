import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import sharp from "sharp";
import { persistGeneratedImageToSupabase } from "./dev-storage.mjs";

loadEnv(".env.local");

const port = Number(process.env.DEV_API_PORT ?? 5180);
const FIXED_OVERLAP_PRESET = "maximum";
const FIXED_OVERLAP_RATIO = 0.25;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: normalizeOpenAIBaseUrl(process.env.OPENAI_BASE_URL),
});
const schedulerState = {
  enabled: process.env.DISABLE_LOCAL_AUTO_GENERATION !== "true",
  intervalMs: Number(process.env.LOCAL_AUTO_GENERATION_POLL_MS ?? 30000),
  running: false,
  lastTickAt: null,
  lastResult: null,
  lastError: null,
};
const generationTimeoutMs = Number(process.env.GENERATION_TIMEOUT_MS ?? 12 * 60 * 1000);
const SCROLL_IMAGE_HEIGHT = 1152;
const SCROLL_VISIBLE_WIDTH = 1536;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

    if (req.method === "POST" && url.pathname === "/api/cron/generate") {
      const scrollId = url.searchParams.get("scrollId");
      const manual = url.searchParams.get("manual") === "1" || url.searchParams.get("background") === "1";
      if (scrollId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scrollId)) {
        json(res, 400, { error: `Invalid scrollId: ${scrollId}` });
        return;
      }
      if (url.searchParams.get("background") === "1") {
        generateDueImages(scrollId, { manual }).catch((error) => log(error instanceof Error ? error.stack ?? error.message : safeStringify(error)));
        json(res, 202, { ok: true, background: true });
        return;
      }
      const results = await generateDueImages(scrollId, { manual });
      json(res, 200, { ok: true, results });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bootstrap/data") {
      const data = await loadAppData();
      json(res, 200, data);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scrolls/create") {
      const body = await readJson(req);
      const scroll = await createScroll(String(body.theme ?? ""));
      json(res, 200, { ok: true, scroll });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scrolls/update") {
      const body = await readJson(req);
      const scroll = await updateScroll(body);
      json(res, 200, { ok: true, scroll });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scrolls/delete") {
      const body = await readJson(req);
      const result = await deleteScroll(String(body.scrollId ?? ""));
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/jobs/retry") {
      const body = await readJson(req);
      const result = await retryFailedJob(String(body.jobId ?? ""));
      json(res, 200, { ok: true, result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/images/delete") {
      const body = await readJson(req);
      const result = await deleteImage(String(body.imageId ?? ""));
      json(res, 200, { ok: true, result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/images/regenerate") {
      const body = await readJson(req);
      const result = await regenerateImage(String(body.imageId ?? ""));
      json(res, 200, { ok: true, result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/images/insert") {
      const body = await readJson(req);
      const result = await requestInsertImage(String(body.imageId ?? ""), body.side === "before" ? "before" : "after");
      json(res, 200, { ok: true, result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/system/status") {
      await releaseStaleRunningJobsForStatus();
      const data = await loadAppData();
      json(res, 200, buildSystemStatus(data));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/system/tick") {
      const result = await runSchedulerTick("manual");
      json(res, 200, { ok: true, result, scheduler: schedulerState });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    log(error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : safeStringify(error));
    json(res, 500, { error: error instanceof Error ? error.message : "API error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local API server listening on http://127.0.0.1:${port}`);
  if (schedulerState.enabled) {
    console.log(`Local auto-generation scheduler enabled. Polling every ${Math.round(schedulerState.intervalMs / 1000)}s.`);
    setInterval(() => {
      runSchedulerTick("interval").catch((error) => {
        schedulerState.lastError = error instanceof Error ? error.message : String(error);
        log(`scheduler tick failed: ${schedulerState.lastError}`);
      });
    }, schedulerState.intervalMs);
  }
});

async function runSchedulerTick(source) {
  if (!schedulerState.enabled) return { skipped: "scheduler_disabled" };
  if (schedulerState.running) return { skipped: "scheduler_already_running" };
  schedulerState.running = true;
  schedulerState.lastTickAt = new Date().toISOString();
  schedulerState.lastError = null;
  try {
    const result = await generateDueImages();
    schedulerState.lastResult = { source, generated: result.length, result };
    if (result.length) log(`scheduler ${source} generated ${result.length} result(s)`);
    return schedulerState.lastResult;
  } catch (error) {
    schedulerState.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    schedulerState.running = false;
  }
}

async function releaseStaleRunningJobsForStatus() {
  const { data: runningJobs, error } = await supabase.from("generation_jobs").select("id,locked_at").eq("status", "running");
  if (error) throw error;
  for (const job of runningJobs ?? []) {
    if (isStaleRunningJob({ lockedAt: job.locked_at })) {
      await finishJob(job.id, "failed", "运行任务超过超时时间，已由状态检查释放");
    }
  }
}

async function createScroll(theme) {
  const cleanTheme = theme.trim();
  if (!cleanTheme) throw new Error("theme is required");

  const optimizedPrompt = await optimizeTheme(cleanTheme);
  const nextRunAt = new Date(Date.now() + 300000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("scrolls")
    .insert({
      title: `${cleanTheme.slice(0, 12)}画卷`,
      original_theme: cleanTheme,
      optimized_prompt: optimizedPrompt,
      status: "generating",
      auto_generation_enabled: true,
      interval_minutes: 5,
      overlap_preset: FIXED_OVERLAP_PRESET,
      overlap_ratio: FIXED_OVERLAP_RATIO,
      image_count: 0,
      next_run_at: nextRunAt,
      last_generated_at: now,
      thumbnail_url: "/assets/scroll-segment.svg",
    })
    .select()
    .single();

  if (error) throw error;

  await supabase.from("generation_jobs").insert({
    scroll_id: data.id,
    target_index: 1,
    type: "auto_next",
    status: "queued",
    scheduled_for: nextRunAt,
  });
  await supabase.from("generation_logs").insert({
    scroll_id: data.id,
    level: "success",
    message: "画卷已创建",
    detail: "第一张图片任务已进入队列",
  });

  return data;
}

async function updateScroll(body) {
  const scrollId = String(body.scrollId ?? "");
  if (!isUuid(scrollId)) throw new Error("Invalid scrollId");

  const patch = buildScrollUpdatePatch(body);

  const { data, error } = await supabase.from("scrolls").update(patch).eq("id", scrollId).select().single();
  if (error) throw error;
  await supabase.from("generation_logs").insert({
    scroll_id: scrollId,
    level: "info",
    message: "画卷信息已更新",
    detail: "标题、主题或提示词的修改将影响后续生成。",
  });
  return data;
}

async function deleteScroll(scrollId) {
  if (!isUuid(scrollId)) throw new Error("Invalid scrollId");

  const { data: images, error: imageLoadError } = await supabase.from("scroll_images").select("full_image_url").eq("scroll_id", scrollId);
  if (imageLoadError) throw imageLoadError;

  const storagePaths = (images ?? [])
    .map((image) => getStoragePathFromPublicUrl(image.full_image_url, "scroll-images"))
    .filter(Boolean);
  if (storagePaths.length) {
    const { error: storageError } = await supabase.storage.from("scroll-images").remove(storagePaths);
    if (storageError) throw storageError;
  }

  for (const table of ["generation_jobs", "generation_logs", "scroll_images"]) {
    const { error } = await supabase.from(table).delete().eq("scroll_id", scrollId);
    if (error) throw error;
  }

  const { error: scrollError } = await supabase.from("scrolls").delete().eq("id", scrollId);
  if (scrollError) throw scrollError;

  return { scrollId, deletedImages: images?.length ?? 0 };
}

function buildScrollUpdatePatch(body) {
  const patch = { updated_at: new Date().toISOString() };
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.originalTheme === "string" && body.originalTheme.trim()) patch.original_theme = body.originalTheme.trim();
  if (typeof body.optimizedPrompt === "string") patch.optimized_prompt = body.optimizedPrompt.trim();
  if (typeof body.autoGenerationEnabled === "boolean") {
    patch.auto_generation_enabled = body.autoGenerationEnabled;
    patch.status = body.autoGenerationEnabled ? "generating" : "paused";
  }
  return patch;
}

function getStoragePathFromPublicUrl(publicUrl, bucket) {
  if (!publicUrl || publicUrl.startsWith("/")) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const markerIndex = publicUrl.indexOf(marker);
  if (markerIndex === -1) return null;
  const pathWithQuery = publicUrl.slice(markerIndex + marker.length);
  const objectPath = pathWithQuery.split(/[?#]/, 1)[0];
  return objectPath ? decodeURIComponent(objectPath) : null;
}

async function retryFailedJob(jobId) {
  if (!isUuid(jobId)) throw new Error("Invalid jobId");
  const { data: job, error: jobError } = await supabase.from("generation_jobs").select("*").eq("id", jobId).single();
  if (jobError) throw jobError;
  if (job.status !== "failed") throw new Error("Only failed jobs can be retried");

  await supabase
    .from("generation_jobs")
    .update({
      status: "cancelled",
      error_message: "Superseded by manual retry",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  await supabase
    .from("scrolls")
    .update({
      status: "generating",
      auto_generation_enabled: true,
      next_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.scroll_id);

  await supabase.from("generation_logs").insert({
    scroll_id: job.scroll_id,
    level: "info",
    message: `第 ${job.target_index} 张失败任务已重试`,
    detail: "旧失败任务已取消，并已提交新的手动生成任务。",
  });

  const result = await generateNextImageForScroll(job.scroll_id, { manual: true });
  return { jobId, retried: true, result };
}

async function loadAppData() {
  const [scrolls, images, jobs, logs] = await Promise.all([
    supabase.from("scrolls").select("*").order("created_at", { ascending: false }),
    supabase.from("scroll_images").select("*").order("image_index", { ascending: true }),
    supabase.from("generation_jobs").select("*").order("scheduled_for", { ascending: true }),
    supabase.from("generation_logs").select("*").order("created_at", { ascending: false }).limit(80),
  ]);

  const error = scrolls.error ?? images.error ?? jobs.error ?? logs.error;
  if (error) throw error;

  return {
    scrolls: scrolls.data ?? [],
    images: images.data ?? [],
    jobs: jobs.data ?? [],
    logs: logs.data ?? [],
  };
}

function buildSystemStatus(data) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const activeScrolls = data.scrolls.filter((scroll) => scroll.auto_generation_enabled);
  const nextScroll = activeScrolls
    .slice()
    .sort((a, b) => new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime())[0];
  const runningJobs = data.jobs.filter((job) => job.status === "running");
  const failedJobs = data.jobs.filter((job) => job.status === "failed");
  const generatedToday = data.images.filter((image) => String(image.generated_at ?? "").startsWith(today)).length;
  return {
    scheduler: schedulerState,
    cronRunning: schedulerState.enabled,
    nextGlobalRunAt: nextScroll?.next_run_at ?? null,
    nextGlobalRunLabel: nextScroll ? `${Math.max(0, Math.ceil((new Date(nextScroll.next_run_at).getTime() - now) / 1000))} 秒后` : "无",
    generatedToday,
    totalGenerated: data.images.length,
    apiHealthPercent: failedJobs.length ? Math.max(20, 100 - failedJobs.length * 15) : 100,
    activeConcurrentJobs: runningJobs.length,
    maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
    failedJobs: failedJobs.length,
    activeScrolls: activeScrolls.length,
  };
}

async function generateDueImages(scrollId, options = {}) {
  const filters = getCandidateScrollFilters({ scrollId, manual: Boolean(options.manual) });
  let query = supabase.from("scrolls").select("*").limit(Number(process.env.MAX_CONCURRENT_JOBS ?? 2));
  if (filters.requireAutoEnabled) query = query.eq("auto_generation_enabled", true);
  if (filters.scrollId) query = query.eq("id", filters.scrollId);
  if (filters.dueBeforeIso) query = query.lte("next_run_at", filters.dueBeforeIso);

  const { data: scrolls, error } = await query;
  if (error) throw error;

  const settled = await Promise.allSettled((scrolls ?? []).map((scroll) => generateOneScrollImage(scroll)));
  return settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return { scrollId: scrolls?.[index]?.id, failed: true, error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
  });
}

async function generateOneScrollImage(scroll) {
  const targetIndex = Number(scroll.image_count ?? 0) + 1;
  const runningJob = await loadRunningJob(scroll.id);
  if (runningJob) {
    if (isStaleRunningJob({ lockedAt: runningJob.locked_at })) {
      await finishJob(runningJob.id, "failed", "Running job timed out and was released for a retry");
    } else {
      return { scrollId: scroll.id, targetIndex, skipped: "running_job_exists" };
    }
  }
  const job = await createRunningJob(scroll.id, targetIndex, "auto_next");
  try {
    const isFirst = targetIndex === 1;
    const overlapRatio = FIXED_OVERLAP_RATIO;
    const { width, height, overlapWidth, visibleWidth } = getScrollImageDimensions(isFirst, overlapRatio);
    const now = new Date().toISOString();
    const previousImage = isFirst ? null : await loadPreviousImage(scroll.id, targetIndex - 1);
    const previousVisibleBuffer = previousImage ? await readLocalPublicImage(previousImage.full_image_url) : null;
    const referenceImageBase64 =
      previousVisibleBuffer && overlapWidth > 0 ? (await extractRightOverlapByWidth(previousVisibleBuffer, overlapWidth, height)).toString("base64") : undefined;
    const prompt = buildImagePrompt(scroll, targetIndex, Boolean(referenceImageBase64));
    const generated = await withGenerationTimeout(
      previousVisibleBuffer
        ? generateOutpaintedImage(prompt, previousVisibleBuffer, overlapRatio, overlapWidth, height, width, referenceImageBase64)
        : generateImage(prompt, referenceImageBase64),
    );

    if (!generated?.bytes) {
      await finishGenerationFailure(job.id, scroll.id, targetIndex, "Image model did not return valid image bytes");
      return { scrollId: scroll.id, targetIndex, failed: true, error: "Image model did not return valid image bytes" };
    }

    let stitchQualityScore;
    if (previousVisibleBuffer && overlapWidth > 0) {
      generated.bytes = await copyPreviousOverlapIntoNewImage(generated.bytes, previousVisibleBuffer, overlapWidth, height, overlapRatio, width);
      stitchQualityScore = await calculateStitchQualityScore(generated.bytes, previousVisibleBuffer, overlapWidth, height);
    } else {
      generated.bytes = await normalizeImageBuffer(generated.bytes, width, height);
    }
    const hasStitchWarning = typeof stitchQualityScore === "number" && stitchQualityScore < 82;

    const imageUrl = await persistImage(scroll.id, targetIndex, generated);
    const { data: image, error: imageError } = await supabase
      .from("scroll_images")
      .insert({
        scroll_id: scroll.id,
        image_index: targetIndex,
        status: "succeeded",
        full_image_url: imageUrl,
        prompt: generated.prompt,
        model: generated.model,
        file_size_bytes: generated.bytes?.byteLength,
        width,
        height,
        ratio_label: getRatioLabel(isFirst, overlapRatio),
        visible_crop: { x: overlapWidth, y: 0, width: visibleWidth, height },
        overlap_crop: { x: 0, y: 0, width: overlapWidth, height, stitchQualityScore },
        new_content_crop: { x: overlapWidth, y: 0, width: visibleWidth, height },
        has_stitch_warning: hasStitchWarning,
        generated_at: now,
      })
      .select()
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

    await supabase.from("generation_logs").insert({
      scroll_id: scroll.id,
      level: hasStitchWarning ? "warning" : "success",
      message: `第 ${targetIndex} 张生成成功`,
      detail: typeof stitchQualityScore === "number" ? `真实图片已生成，衔接评分 ${stitchQualityScore} 分。` : "真实图片已生成并保存到 Supabase Storage。",
    });
    await finishJob(job.id, "succeeded");

    return { scrollId: scroll.id, targetIndex, imageUrl, imageId: image.id, fallback: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishGenerationFailure(job.id, scroll.id, targetIndex, message);
    return { scrollId: scroll.id, targetIndex, failed: true, error: message };
  }
}

async function generateNextImageForScroll(scrollId, options = {}) {
  const [result] = await generateDueImages(scrollId, { manual: true, ...options });
  return result;
}

async function rebuildImagesFromIndex(scrollId, startIndex, targetCount, options = {}) {
  if (!Number.isInteger(startIndex) || startIndex < 1) throw new Error("Invalid rebuild startIndex");
  if (!Number.isInteger(targetCount) || targetCount < startIndex) throw new Error("Invalid rebuild targetCount");
  const { data: scroll, error: scrollError } = await supabase.from("scrolls").select("*").eq("id", scrollId).single();
  if (scrollError) throw scrollError;

  const { error: deleteError } = await supabase.from("scroll_images").delete().eq("scroll_id", scrollId).gte("image_index", startIndex);
  if (deleteError) throw deleteError;

  const baseCount = startIndex - 1;
  const { error: updateError } = await supabase
    .from("scrolls")
    .update({
      image_count: baseCount,
      auto_generation_enabled: true,
      status: "generating",
      updated_at: new Date().toISOString(),
    })
    .eq("id", scrollId);
  if (updateError) throw updateError;

  const results = [];
  for (let nextIndex = startIndex; nextIndex <= targetCount; nextIndex += 1) {
    const result = await generateNextImageForScroll(scrollId, { manual: true });
    results.push(result);
    if (!result || result.failed || result.skipped) break;
  }

  const completedCount = results.filter((result) => result && !result.failed && !result.skipped).length;
  const completedAll = completedCount === targetCount - startIndex + 1;
  const shouldPause = options.pauseAfter || !completedAll;
  const latestImage = await loadLatestImage(scrollId);
  await supabase
    .from("scrolls")
    .update({
      status: shouldPause ? "paused" : scroll.status,
      auto_generation_enabled: shouldPause ? false : scroll.auto_generation_enabled,
      thumbnail_url: latestImage?.full_image_url ?? scroll.thumbnail_url,
      next_run_at: new Date(Date.now() + Number(scroll.interval_minutes ?? 5) * 60000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", scrollId);

  await supabase.from("generation_logs").insert({
    scroll_id: scrollId,
    level: completedAll ? "success" : "warning",
    message: `已从第 ${startIndex} 张开始批量重绘`,
    detail: `目标重绘到第 ${targetCount} 张，实际完成 ${completedCount} 张。${completedAll ? "" : "批量重绘中断，已暂停自动生成以避免继续破坏衔接。"}`,
  });

  return { startIndex, targetCount, results };
}

async function finishGenerationFailure(jobId, scrollId, targetIndex, errorMessage) {
  await finishJob(jobId, "failed", errorMessage);
  await supabase.from("generation_logs").insert({
    scroll_id: scrollId,
    level: "error",
    message: `第 ${targetIndex} 张生成失败`,
    detail: String(errorMessage).slice(0, 1000),
  });
}

function withGenerationTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`图片生成超过 ${Math.round(generationTimeoutMs / 60000)} 分钟未返回`)), generationTimeoutMs);
    }),
  ]);
}

async function loadRunningJob(scrollId) {
  const { data, error } = await supabase
    .from("generation_jobs")
    .select("id,locked_at")
    .eq("scroll_id", scrollId)
    .eq("status", "running")
    .maybeSingle();
  if (error) throw error;
  return data;
}

function getCandidateScrollFilters({ scrollId, manual = false, nowIso = new Date().toISOString() }) {
  return {
    scrollId: scrollId ?? undefined,
    requireAutoEnabled: !manual,
    dueBeforeIso: manual || scrollId ? undefined : nowIso,
  };
}

function isStaleRunningJob({ lockedAt, nowIso = new Date().toISOString(), staleAfterMinutes = Number(process.env.STALE_RUNNING_JOB_MINUTES ?? 15) }) {
  if (!lockedAt) return false;
  const lockedTime = Date.parse(lockedAt);
  const nowTime = Date.parse(nowIso);
  if (Number.isNaN(lockedTime) || Number.isNaN(nowTime)) return false;
  return nowTime - lockedTime > staleAfterMinutes * 60000;
}

async function createRunningJob(scrollId, targetIndex, type) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      scroll_id: scrollId,
      target_index: targetIndex,
      type,
      status: "running",
      scheduled_for: now,
      locked_at: now,
      locked_by: "local-dev-api",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function finishJob(jobId, status, errorMessage) {
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

async function deleteImage(imageId) {
  if (!isUuid(imageId)) throw new Error("Invalid imageId");
  const { data: image, error: imageError } = await supabase.from("scroll_images").select("*").eq("id", imageId).single();
  if (imageError) throw imageError;
  const { data: scroll, error: scrollError } = await supabase.from("scrolls").select("*").eq("id", image.scroll_id).single();
  if (scrollError) throw scrollError;

  const isTail = Number(image.image_index) === Number(scroll.image_count);
  const nextCount = Math.max(0, Number(scroll.image_count ?? 0) - 1);

  const { error: deleteError } = await supabase.from("scroll_images").delete().eq("id", imageId);
  if (deleteError) throw deleteError;

  if (!isTail) {
    const { error: reviewError } = await supabase
      .from("scroll_images")
      .update({ status: "needs_review", has_stitch_warning: true })
      .eq("scroll_id", image.scroll_id)
      .gt("image_index", image.image_index);
    if (reviewError) throw reviewError;
  }

  const latestImage = await loadLatestImage(image.scroll_id);
  const { error: updateError } = await supabase
    .from("scrolls")
    .update({
      image_count: nextCount,
      status: isTail ? scroll.status : "paused",
      auto_generation_enabled: isTail ? scroll.auto_generation_enabled : false,
      thumbnail_url: latestImage?.full_image_url ?? "/assets/scroll-segment.svg",
      updated_at: new Date().toISOString(),
    })
    .eq("id", image.scroll_id);
  if (updateError) throw updateError;

  await supabase.from("generation_logs").insert({
    scroll_id: image.scroll_id,
    level: "warning",
    message: `第 ${image.image_index} 张已删除`,
    detail: isTail ? "末尾图片已删除" : "中间图片删除后已暂停自动生成并标记后续衔接风险",
  });

  return { imageId, scrollId: image.scroll_id, deletedIndex: image.image_index, paused: !isTail };
}

async function regenerateImage(imageId) {
  if (!isUuid(imageId)) throw new Error("Invalid imageId");
  const { data: image, error: imageError } = await supabase.from("scroll_images").select("*").eq("id", imageId).single();
  if (imageError) throw imageError;
  const { data: scroll, error: scrollError } = await supabase.from("scrolls").select("*").eq("id", image.scroll_id).single();
  if (scrollError) throw scrollError;

  const targetCount = Number(scroll.image_count ?? image.image_index);
  const rebuild = await rebuildImagesFromIndex(image.scroll_id, Number(image.image_index), targetCount, { pauseAfter: false });
  return { imageId, regenerated: true, rebuild };
}

async function requestInsertImage(imageId, side) {
  if (!isUuid(imageId)) throw new Error("Invalid imageId");
  const { data: image, error } = await supabase.from("scroll_images").select("*").eq("id", imageId).single();
  if (error) throw error;
  const targetIndex = side === "before" ? Number(image.image_index) : Number(image.image_index) + 1;
  const { data: scroll, error: scrollError } = await supabase.from("scrolls").select("*").eq("id", image.scroll_id).single();
  if (scrollError) throw scrollError;
  const originalCount = Number(scroll.image_count ?? image.image_index);
  const rebuild = await rebuildImagesFromIndex(image.scroll_id, targetIndex, originalCount + 1, { pauseAfter: false });
  await supabase.from("generation_logs").insert({
    scroll_id: image.scroll_id,
    level: "success",
    message: `已请求在第 ${image.image_index} 张${side === "before" ? "前" : "后"}插入`,
    detail: `已从第 ${targetIndex} 张开始重绘到第 ${originalCount + 1} 张。`,
  });
  return { imageId, side, targetIndex, rebuild };
}

async function markFollowingForReview(image) {
  const { error: imageError } = await supabase
    .from("scroll_images")
    .update({ status: "needs_review", has_stitch_warning: true })
    .eq("scroll_id", image.scroll_id)
    .gt("image_index", image.image_index);
  if (imageError) throw imageError;
  const { error: scrollError } = await supabase
    .from("scrolls")
    .update({ status: "paused", auto_generation_enabled: false, updated_at: new Date().toISOString() })
    .eq("id", image.scroll_id);
  if (scrollError) throw scrollError;
}

async function loadLatestImage(scrollId) {
  const { data, error } = await supabase
    .from("scroll_images")
    .select("full_image_url")
    .eq("scroll_id", scrollId)
    .order("image_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function optimizeTheme(theme) {
  if (!process.env.DEEPSEEK_API_KEY) return fallbackPrompt(theme);

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "你是画卷提示词工程师。只输出适合连续横向长卷生成的中文提示词正文。" },
        { role: "user", content: theme },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) return fallbackPrompt(theme);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || fallbackPrompt(theme);
}

async function loadPreviousImage(scrollId, imageIndex) {
  const { data, error } = await supabase
    .from("scroll_images")
    .select("*")
    .eq("scroll_id", scrollId)
    .eq("image_index", imageIndex)
    .single();
  if (error) throw error;
  return data;
}

async function generateImage(prompt, referenceImageBase64) {
  if (process.env.LOCAL_DETERMINISTIC_IMAGE_GENERATION === "true") return generateDeterministicImage(prompt, 1);
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const v1 = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const responsesResult = await tryResponsesImageTool(prompt, referenceImageBase64);
  if (responsesResult) return responsesResult;
  if (referenceImageBase64) {
    log("retrying Responses image tool without reference image");
    const textOnlyResponsesResult = await tryResponsesImageTool(prompt, undefined);
    if (textOnlyResponsesResult) return textOnlyResponsesResult;
  }
  return tryImageApi(v1, process.env.OPENAI_IMAGE_API_MODEL ?? "gpt-image-1", prompt);
}

async function generateOutpaintedImage(prompt, previousImageBuffer, overlapRatio, sourceOverlapWidth, sourceHeight, sourceWidth, referenceImageBase64) {
  if (process.env.LOCAL_DETERMINISTIC_IMAGE_GENERATION === "true") return generateDeterministicImage(prompt, 2);
  const editResult = await tryImageEditOutpaint(prompt, previousImageBuffer, overlapRatio, sourceOverlapWidth, sourceHeight, sourceWidth);
  if (editResult) return editResult;
  void referenceImageBase64;
  log("outpaint edit failed; refusing plain generation because strict scroll stitching requires edit-based continuation");
  return { prompt, model: `${process.env.OPENAI_IMAGE_API_MODEL ?? "gpt-image-1"} edit-outpaint failed`, fallback: true };
}

async function generateDeterministicImage(prompt, seed) {
  const width = 1152;
  const height = 768;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      raw[offset] = (x + seed * 31) % 256;
      raw[offset + 1] = (y + seed * 47) % 256;
      raw[offset + 2] = (x + y + seed * 59) % 256;
    }
  }
  const bytes = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
  return { prompt, model: "deterministic-local", bytes, mimeType: "image/png", fallback: false };
}

async function tryImageEditOutpaint(prompt, previousImageBuffer, overlapRatio, sourceOverlapWidth, sourceHeight = 768, sourceWidth) {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const v1 = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const endpoint = `${v1}/images/edits`;
  const model = process.env.OPENAI_IMAGE_API_MODEL ?? "gpt-image-1";
  const editWidth = sourceWidth ?? 1536;
  const editHeight = sourceWidth ? sourceHeight : 1024;
  const overlapWidth = sourceOverlapWidth ?? Math.max(1, Math.round((editWidth / (1 + overlapRatio)) * overlapRatio));
  const canvas = await createOutpaintCanvas(previousImageBuffer, editWidth, editHeight, overlapWidth, sourceOverlapWidth ?? overlapWidth, sourceHeight);
  const mask = await createOutpaintMask(editWidth, editHeight, overlapWidth);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    log(`trying Image Edit outpaint model ${model}`);
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", sourceWidth ? "auto" : "1536x1024");
    form.append("quality", "high");
    form.append("input_fidelity", "high");
    form.append("n", "1");
    form.append("image[]", new Blob([new Uint8Array(canvas)], { type: "image/png" }), "canvas.png");
    form.append("image[]", new Blob([new Uint8Array(previousImageBuffer)], { type: "image/png" }), "previous.png");
    form.append("mask", new Blob([mask], { type: "image/png" }), "mask.png");

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });
    const text = await response.text();
    log(`Image Edit response ${response.status}, length ${text.length}`);
    if (!response.ok) return null;
    const data = JSON.parse(text);
    const base64 = data.data?.[0]?.b64_json;
    if (!base64) return null;
    return { prompt, model: `${model} edit-outpaint`, bytes: Buffer.from(base64, "base64"), mimeType: "image/png", fallback: false };
  } catch (error) {
    log(`Image Edit threw ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryResponsesImageTool(prompt, referenceImageBase64) {
  const responseModel = process.env.OPENAI_RESPONSE_MODEL || process.env.OPENAI_MODEL || "gpt-5.5";
  const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240000);
  const content = [{ type: "input_text", text: prompt }];
  if (referenceImageBase64) {
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${referenceImageBase64}`,
      detail: "high",
    });
  }

  try {
    log(`trying Responses image tool responseModel=${responseModel}, imageModel=${imageModel}`);
    const response = await openai.responses.create(
      {
        model: responseModel,
        input: [
          {
            role: "user",
            content,
          },
        ],
        tools: [
          {
            type: "image_generation",
            model: imageModel,
            quality: "high",
            size: "1536x1024",
          },
        ],
        reasoning: { effort: "medium" },
      },
      { signal: controller.signal },
    );

    const imageCall = response.output?.find((item) => item.type === "image_generation_call");
    const base64 = imageCall?.result;
    log(`Responses image tool status=${imageCall?.status ?? "missing"}, base64=${typeof base64 === "string" ? base64.length : 0}`);
    if (typeof base64 !== "string" || base64.length < 100) return null;

    return { prompt, model: `${responseModel} + ${imageModel}`, bytes: Buffer.from(base64, "base64"), mimeType: "image/png", fallback: false };
  } catch (error) {
    log(`Responses image tool threw ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryImageApi(v1, model, prompt) {
  const endpoint = `${v1}/images/generations`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    log(`trying Image API model ${model}`);
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        size: "1024x1024",
        quality: "low",
        n: 1,
      }),
    });

    const text = await response.text();
    log(`Image API response ${response.status}, length ${text.length}`);
    if (!response.ok) return null;

    const data = JSON.parse(text);
    const base64 = data.data?.[0]?.b64_json;
    if (!base64) return null;

    return { prompt, model, bytes: Buffer.from(base64, "base64"), mimeType: "image/png", fallback: false };
  } catch (error) {
    log(`Image API threw ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function persistImage(scrollId, targetIndex, generated) {
  return persistGeneratedImageToSupabase({ supabase, bucket: "scroll-images", scrollId, targetIndex, generated });
}

function readLocalPublicImage(publicUrl) {
  if (/^https?:\/\//.test(publicUrl)) return fetch(publicUrl).then(async (response) => {
    if (!response.ok) throw new Error(`Failed to download previous image: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  });
  if (!publicUrl?.startsWith("/")) throw new Error(`Only local public image URLs are supported in dev mode: ${publicUrl}`);
  return readFileSync(`public${publicUrl.replaceAll("/", "\\")}`);
}

async function normalizeImageBuffer(imageBuffer, targetWidth, targetHeight) {
  return sharp(imageBuffer)
    .resize(targetWidth, targetHeight, { fit: "fill" })
    .png()
    .toBuffer();
}

async function extractRightOverlap(imageBuffer, overlapRatio) {
  const normalized = await normalizeImageBuffer(imageBuffer, 1024, 768);
  const overlapWidth = Math.max(1, Math.round(1024 * overlapRatio));
  return extractRightOverlapByWidth(normalized, overlapWidth, 768);
}

async function extractRightOverlapByWidth(imageBuffer, overlapWidth, height = 768) {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 1024;
  const normalized = await normalizeImageBuffer(imageBuffer, width, height);
  const safeOverlapWidth = Math.max(1, Math.min(overlapWidth, width));
  return sharp(normalized)
    .extract({ left: width - safeOverlapWidth, top: 0, width: safeOverlapWidth, height })
    .png()
    .toBuffer();
}

async function copyPreviousOverlapIntoNewImage(newImageBuffer, previousImageBuffer, overlapWidth, height, overlapRatio, width = 1152) {
  const normalizedNew = await normalizeImageBuffer(newImageBuffer, width, height);
  const resizedPrevOverlap = await extractRightOverlapByWidth(previousImageBuffer, overlapWidth, height);
  return sharp(normalizedNew)
    .composite([{ input: resizedPrevOverlap, left: 0, top: 0, blend: "over" }])
    .png()
    .toBuffer();
}

async function calculateStitchQualityScore(newImageBuffer, previousImageBuffer, overlapWidth, height) {
  const newOverlap = await sharp(newImageBuffer)
    .resize({ height, fit: "cover", position: "center" })
    .extract({ left: 0, top: 0, width: overlapWidth, height })
    .removeAlpha()
    .raw()
    .toBuffer();
  const prevOverlap = await extractRightOverlapByWidth(previousImageBuffer, overlapWidth, height);
  const previousRaw = await sharp(prevOverlap).removeAlpha().raw().toBuffer();
  const length = Math.min(newOverlap.length, previousRaw.length);
  if (!length) return 0;

  let totalDifference = 0;
  for (let index = 0; index < length; index += 1) totalDifference += Math.abs(newOverlap[index] - previousRaw[index]);
  const meanDifference = totalDifference / length;
  return Math.max(0, Math.min(100, Math.round(100 - (meanDifference / 255) * 100)));
}

function getScrollImageDimensions(isFirst, overlapRatio) {
  const overlapWidth = isFirst ? 0 : Math.round(SCROLL_VISIBLE_WIDTH * overlapRatio);
  const width = SCROLL_VISIBLE_WIDTH + overlapWidth;
  return {
    width,
    height: SCROLL_IMAGE_HEIGHT,
    overlapWidth,
    visibleWidth: SCROLL_VISIBLE_WIDTH,
  };
}

async function createOutpaintCanvas(previousImageBuffer, width, height, overlapWidth, sourceOverlapWidth = overlapWidth, sourceHeight = height) {
  const previousOverlap = await extractRightOverlapByWidth(previousImageBuffer, sourceOverlapWidth, sourceHeight);
  const canvasOverlap = await sharp(previousOverlap)
    .resize(overlapWidth, height, { fit: "fill" })
    .png()
    .toBuffer();
  const transparentCanvas = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  return sharp(transparentCanvas).composite([{ input: canvasOverlap, left: 0, top: 0 }]).png().toBuffer();
}

async function createOutpaintMask(width, height, overlapWidth) {
  const transparentMask = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const lockedArea = await sharp({
    create: {
      width: overlapWidth,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    },
  })
    .png()
    .toBuffer();
  return sharp(transparentMask).composite([{ input: lockedArea, left: 0, top: 0 }]).png().toBuffer();
}

function fallbackPrompt(theme) {
  return `以「${theme}」为主题生成连续横向画卷，保持统一风格、空间连续和左到右叙事。`;
}

function buildImagePrompt(scroll, targetIndex, hasReferenceImage = false) {
  const isFirst = targetIndex === 1;
  const theme = String(scroll.original_theme ?? "清明上河图风格长卷");
  const optimizedPrompt = String(scroll.optimized_prompt ?? "");
  return [
    "Create one segment of a continuous horizontal Chinese handscroll painting.",
    "Visual style: Northern Song dynasty court handscroll, inspired by Along the River During the Qingming Festival, fine ink linework, pale mineral colors, dense but readable market life, ancient Bianjing city atmosphere.",
    `User theme: ${theme}`,
    optimizedPrompt ? `Long-term scroll direction: ${optimizedPrompt}` : "",
    `This is segment ${targetIndex}. ${isFirst ? "Start the scroll naturally with a 4:3 establishing composition." : "The left edge will be replaced with a pixel-perfect overlap from the previous image; focus on generating coherent new content to the right while matching the reference edge."}`,
    hasReferenceImage ? "A reference image is attached showing the exact previous right edge. Continue from it naturally into the new right-side scene." : "",
    "No modern objects, no text labels, no UI, no frame, no watermark. Make it feel like a real antique panoramic scroll, not a generic fantasy landscape.",
  ]
    .filter(Boolean)
    .join("\n");
}

function getRatioLabel(isFirst, overlapRatio) {
  void isFirst;
  void overlapRatio;
  return "4:3";
}

function loadEnv(path) {
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    process.env[line.slice(0, index).trim()] ??= line.slice(index + 1).trim();
  }
}

function normalizeOpenAIBaseUrl(value) {
  if (!value) return "https://api.openai.com/v1";
  const trimmed = value.replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
}

function log(message) {
  mkdirSync("output", { recursive: true });
  appendFileSync("output/dev-api.log", `[${new Date().toISOString()}] ${message}\n`);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

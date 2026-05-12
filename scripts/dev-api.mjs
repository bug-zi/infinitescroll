import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import sharp from "sharp";
import { persistGeneratedImageToSupabase } from "./dev-storage.mjs";
import { detectPaperBorderDrift } from "./image-validation.mjs";
import { createTimeoutFetch } from "./supabase-fetch.mjs";
import {
  AI_SCRIPT_TEMPLATE,
  AI_SCRIPT_TEMPLATE_VERSION,
  buildAiScriptCreativePlan,
  buildCreativePlanPromptSection,
  createCreativePlan,
  detectStoryMode,
  mapScriptFrameRow,
  normalizeCreativePlan,
} from "./creative-plan-runtime.mjs";
import {
  buildFallbackStyleWarning,
  buildStyleLockPromptSection,
  forbidsPaperScrollTexture,
  summarizePreviousFrameForNextPrompt,
  summarizePromptFallback,
} from "./style-lock-runtime.mjs";

loadEnv(".env.local");

const port = Number(process.env.DEV_API_PORT ?? 5180);
const FIXED_OVERLAP_PRESET = "maximum";
const FIXED_OVERLAP_RATIO = 0.25;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch: createTimeoutFetch() },
});
const schedulerState = {
  enabled: process.env.DISABLE_LOCAL_AUTO_GENERATION !== "true",
  intervalMs: Number(process.env.LOCAL_AUTO_GENERATION_POLL_MS ?? 30000),
  started: false,
  intervalActive: false,
  running: false,
  lastTickAt: null,
  lastResult: null,
  lastError: null,
};
const DEFAULT_GENERATION_TIMEOUT_MS = 12 * 60 * 1000;
const DEFAULT_POST_GENERATION_STAGE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_STALE_RUNNING_JOB_MINUTES = 30;
const generationTimeoutMs = parsePositiveInteger(process.env.GENERATION_TIMEOUT_MS) ?? DEFAULT_GENERATION_TIMEOUT_MS;
const postGenerationStageTimeoutMs = parsePositiveInteger(process.env.POST_GENERATION_STAGE_TIMEOUT_MS) ?? DEFAULT_POST_GENERATION_STAGE_TIMEOUT_MS;
const staleRunningJobMinutes =
  parsePositiveInteger(process.env.STALE_RUNNING_JOB_MINUTES) ?? Math.max(DEFAULT_STALE_RUNNING_JOB_MINUTES, Math.ceil(generationTimeoutMs / 60000) + 3);
const SCROLL_IMAGE_HEIGHT = 1152;
const SCROLL_VISIBLE_WIDTH = 1536;
const DEFAULT_RESPONSE_MODEL = "gpt-5.5";
const DEFAULT_IMAGE_TOOL_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_TOOL_FALLBACKS = "gpt-image-1.5,gpt-image-1";
const DEFAULT_IMAGE_API_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_API_FALLBACKS = "gpt-image-1.5,gpt-image-1";

function calculatePurgeAfter(archivedAtIso) {
  return new Date(Date.parse(archivedAtIso) + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function isMissingArchiveColumnError(error) {
  if (!error || typeof error !== "object") return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "42703" && (message.includes("archived_at") || message.includes("purge_after"));
}

async function runOptionalArchiveMaintenance(taskName, task) {
  try {
    await task();
  } catch (error) {
    if (!isMissingArchiveColumnError(error)) throw error;
    log(`${taskName} skipped because archive columns are not installed yet`);
  }
}

async function queryMaybeActiveRows(activeQuery, fallbackQuery) {
  const result = await activeQuery;
  if (!result.error || !isMissingArchiveColumnError(result.error)) return result;
  log("archive column filter skipped because archive columns are not installed yet");
  return await fallbackQuery;
}

export async function handleDevApiRequest(req, res) {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

    if (req.method === "POST" && url.pathname === "/api/cron/generate") {
      if (!isCronRequestAuthorized(req.headers.authorization)) {
        json(res, 401, { error: "Unauthorized" });
        return;
      }

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
      const data = await loadBootstrapData();
      json(res, 200, data);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scrolls/create") {
      const body = await readJson(req);
      const scroll = await createScroll(body);
      json(res, 200, { ok: true, scroll });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/prompts/optimize") {
      const body = await readJson(req);
      const theme = String(body.theme ?? "").trim();
      const requirements = String(body.requirements ?? "").trim();
      if (!theme) throw new Error("theme is required");
      const optimizedPrompt = await optimizeTheme(theme, requirements);
      json(res, 200, { ok: true, optimizedPrompt });
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

    if (req.method === "POST" && url.pathname === "/api/scrolls/restore") {
      const body = await readJson(req);
      const result = await restoreScroll(String(body.scrollId ?? ""));
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scrolls/purge") {
      const body = await readJson(req);
      const result = await purgeScroll(String(body.scrollId ?? ""));
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scripts/draft") {
      const body = await readJson(req);
      const draft = await draftScript(body);
      json(res, 200, { ok: true, draft });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/images/purge") {
      const body = await readJson(req);
      const result = await purgeImage(String(body.imageId ?? ""));
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

    if (req.method === "POST" && url.pathname === "/api/images/restore") {
      const body = await readJson(req);
      const result = await restoreImage(String(body.imageId ?? ""));
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
      const data = await loadSystemStatusData();
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
    log(error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : formatUnknownError(error));
    json(res, 500, { error: formatUnknownError(error) });
  }
}

export function startDevApiServer({ host = "127.0.0.1", listenPort = port } = {}) {
  const server = createServer(handleDevApiRequest);
  server.listen(listenPort, host, () => {
    console.log(`Local API server listening on http://${host}:${listenPort}`);
    startLocalScheduler();
  });
  return server;
}

export function startLocalScheduler() {
  if (!schedulerState.enabled || schedulerState.started) return;
  schedulerState.started = true;
  schedulerState.intervalActive = true;
  console.log(`Local auto-generation scheduler enabled. Polling every ${Math.round(schedulerState.intervalMs / 1000)}s.`);
  const interval = setInterval(() => {
    runSchedulerTick("interval").catch((error) => {
      schedulerState.lastError = formatUnknownError(error);
      log(`scheduler tick failed: ${schedulerState.lastError}`);
    });
  }, schedulerState.intervalMs);
  interval.unref?.();
  runSchedulerTick("startup").catch((error) => {
    schedulerState.lastError = formatUnknownError(error);
    log(`scheduler startup tick failed: ${schedulerState.lastError}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDevApiServer();
}

async function runSchedulerTick(source) {
  if (!schedulerState.enabled) return { skipped: "scheduler_disabled" };
  if (schedulerState.running) return { skipped: "scheduler_already_running" };
  schedulerState.running = true;
  schedulerState.lastTickAt = new Date().toISOString();
  schedulerState.lastError = null;
  try {
    await runOptionalArchiveMaintenance("purge expired archived scrolls", purgeExpiredArchivedScrolls);
    await runOptionalArchiveMaintenance("purge expired archived images", purgeExpiredArchivedImages);
    const releasedStaleJobs = await releaseStaleRunningJobs("Running job timed out and was released by scheduler");
    const result = await generateDueImages();
    schedulerState.lastResult = { source, generated: result.length, releasedStaleJobs, result };
    if (releasedStaleJobs) log(`scheduler ${source} released ${releasedStaleJobs} stale running job(s)`);
    if (result.length) log(`scheduler ${source} generated ${result.length} result(s)`);
    return schedulerState.lastResult;
  } catch (error) {
    schedulerState.lastError = formatUnknownError(error);
    throw error;
  } finally {
    schedulerState.running = false;
  }
}

async function releaseStaleRunningJobsForStatus() {
  return await releaseStaleRunningJobs("运行任务超过超时时间，已由状态检查释放");
}

async function releaseStaleRunningJobs(errorMessage) {
  const { data: runningJobs, error } = await supabase.from("generation_jobs").select("id,scroll_id,target_index,locked_at").eq("status", "running");
  if (error) throw error;
  let released = 0;
  for (const job of runningJobs ?? []) {
    if (isStaleRunningJob({ lockedAt: job.locked_at })) {
      await finishJob(job.id, "failed", errorMessage);
      released += 1;
      log(`released stale running job ${job.id} for scroll ${job.scroll_id ?? "unknown"} frame ${job.target_index ?? "unknown"}`);
    }
  }
  return released;
}

async function purgeExpiredArchivedScrolls() {
  const { data, error } = await supabase.from("scrolls").select("id").not("archived_at", "is", null).lte("purge_after", new Date().toISOString());
  if (error) throw error;
  for (const scroll of data ?? []) {
    await purgeScroll(scroll.id);
  }
}

async function createScroll(input) {
  const cleanTheme = String(input?.theme ?? "").trim();
  if (!cleanTheme) throw new Error("theme is required");

  const optimizedPrompt = String(input?.optimizedPrompt ?? "").trim();
  const scriptFramesInput = Array.isArray(input?.storyFrames) ? input.storyFrames : [];
  const wantsAiScript = input?.generationMode === "story" && input?.storyTemplate === AI_SCRIPT_TEMPLATE;
  const storyMode = wantsAiScript
    ? {
        generationMode: "story",
        storyTemplate: AI_SCRIPT_TEMPLATE,
        storyTemplateVersion: AI_SCRIPT_TEMPLATE_VERSION,
        storyTotalFrames: scriptFramesInput.length,
      }
    : detectStoryMode(cleanTheme, optimizedPrompt);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("scrolls")
    .insert({
      title: `${cleanTheme.slice(0, 12)}画卷`,
      original_theme: cleanTheme,
      optimized_prompt: optimizedPrompt,
      generation_mode: storyMode.generationMode,
      story_template: storyMode.storyTemplate,
      story_template_version: storyMode.storyTemplateVersion,
      story_total_frames: storyMode.storyTotalFrames,
      script_summary: typeof input?.scriptSummary === "string" ? input.scriptSummary.trim() : null,
      character_bible: typeof input?.characterBible === "string" ? input.characterBible.trim() : null,
      status: "paused",
      auto_generation_enabled: false,
      interval_minutes: 5,
      overlap_preset: FIXED_OVERLAP_PRESET,
      overlap_ratio: FIXED_OVERLAP_RATIO,
      image_count: 0,
      next_run_at: new Date(Date.now() + 300000).toISOString(),
      last_generated_at: null,
      thumbnail_url: "/assets/scroll-segment.svg",
    })
    .select()
    .single();

  if (error) throw error;

  if (wantsAiScript && scriptFramesInput.length) {
    const { error: frameError } = await supabase.from("scroll_story_frames").insert(
      scriptFramesInput.map((frame, index) => ({
        scroll_id: data.id,
        frame_index: Number(frame.frameIndex ?? index + 1),
        chapter: String(frame.chapter ?? ""),
        title: String(frame.title ?? `第 ${index + 1} 帧`),
        scene: String(frame.scene ?? ""),
        characters: Array.isArray(frame.characters) ? frame.characters : [],
        location: String(frame.location ?? ""),
        mood: String(frame.mood ?? ""),
        continuity_anchor: String(frame.continuityAnchor ?? ""),
        forbidden: String(frame.forbidden ?? ""),
        visual_prompt_hint: String(frame.visualPromptHint ?? ""),
      })),
    );
    if (frameError) throw frameError;
  }

  await supabase.from("generation_logs").insert({
    scroll_id: data.id,
    level: "success",
    message: "空白画卷已创建",
    detail: "尚未生成图片。点击立即生成或开启自动生成后开始绘制。",
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
  const archivedAt = new Date().toISOString();
  const purgeAfter = calculatePurgeAfter(archivedAt);
  const { error } = await supabase
    .from("scrolls")
    .update({
      archived_at: archivedAt,
      purge_after: purgeAfter,
      auto_generation_enabled: false,
      status: "paused",
      updated_at: archivedAt,
    })
    .eq("id", scrollId);
  if (error) throw error;
  return { scrollId, archivedAt, purgeAfter };
}

async function restoreScroll(scrollId) {
  if (!isUuid(scrollId)) throw new Error("Invalid scrollId");
  const { error } = await supabase
    .from("scrolls")
    .update({ archived_at: null, purge_after: null, auto_generation_enabled: true, status: "generating", updated_at: new Date().toISOString() })
    .eq("id", scrollId);
  if (error) throw error;
  return { scrollId };
}

async function purgeScroll(scrollId) {
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

async function loadSystemStatusData() {
  try {
    await releaseStaleRunningJobsForStatus();
    const [scrolls, images, jobs] = await Promise.all([
      supabase.from("scrolls").select("id,auto_generation_enabled,next_run_at"),
      supabase.from("scroll_images").select("id,generated_at"),
      supabase.from("generation_jobs").select("id,status"),
    ]);
    const error = scrolls.error ?? images.error ?? jobs.error;
    if (error) throw error;
    return {
      scrolls: scrolls.data ?? [],
      images: images.data ?? [],
      jobs: jobs.data ?? [],
      logs: [],
    };
  } catch (error) {
    schedulerState.lastError = formatUnknownError(error);
    log(`system status degraded: ${schedulerState.lastError}`);
    return { scrolls: [], images: [], jobs: [], logs: [], statusError: schedulerState.lastError };
  }
}

async function loadBootstrapData() {
  try {
    return await loadAppData();
  } catch (error) {
    schedulerState.lastError = formatUnknownError(error);
    log(`bootstrap data degraded: ${schedulerState.lastError}`);
    return { scrolls: [], images: [], jobs: [], logs: [], statusError: schedulerState.lastError };
  }
}

function buildSystemStatus(data) {
  const now = Date.now();
  const today = getStatusDateKey(new Date());
  const activeScrolls = data.scrolls.filter((scroll) => scroll.auto_generation_enabled);
  const nextScroll = activeScrolls
    .slice()
    .sort((a, b) => new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime())[0];
  const runningJobs = data.jobs.filter((job) => job.status === "running");
  const failedJobs = data.jobs.filter((job) => job.status === "failed");
  const generatedToday = data.images.filter((image) => getStatusDateKey(image.generated_at) === today).length;
  const serviceRunning = schedulerState.started && schedulerState.enabled;
  return {
    scheduler: schedulerState,
    cronRunning: serviceRunning,
    serviceRunning,
    autoGenerationEnabled: activeScrolls.length > 0,
    nextGlobalRunAt: nextScroll?.next_run_at ?? null,
    nextGlobalRunLabel: nextScroll ? getNextRunLabel(nextScroll.next_run_at, now) : "无开启画卷",
    generatedToday,
    totalGenerated: data.images.length,
    apiHealthPercent: failedJobs.length ? Math.max(20, 100 - failedJobs.length * 15) : 100,
    activeConcurrentJobs: runningJobs.length,
    maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
    failedJobs: failedJobs.length,
    activeScrolls: activeScrolls.length,
    statusError: data.statusError ?? null,
  };
}

function getStatusDateKey(value) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getNextRunLabel(nextRunAt, nowMs = Date.now()) {
  const targetMs = new Date(nextRunAt).getTime();
  if (!Number.isFinite(targetMs)) return "时间异常";
  const seconds = Math.ceil((targetMs - nowMs) / 1000);
  if (seconds <= 0) return "待触发";
  if (seconds < 60) return `${seconds} 秒后`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes} 分 ${restSeconds} 秒后` : `${minutes} 分后`;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(targetMs));
}

async function generateDueImages(scrollId, options = {}) {
  const filters = getCandidateScrollFilters({ scrollId, manual: Boolean(options.manual) });
  const buildQuery = (includeArchiveFilter) => {
    let query = supabase.from("scrolls").select("*").limit(Number(process.env.MAX_CONCURRENT_JOBS ?? 2));
    if (includeArchiveFilter) query = query.is("archived_at", null);
    if (filters.requireAutoEnabled) query = query.eq("auto_generation_enabled", true);
    if (filters.scrollId) query = query.eq("id", filters.scrollId);
    if (filters.dueBeforeIso) query = query.lte("next_run_at", filters.dueBeforeIso);
    return query;
  };

  const { data: scrolls, error } = await queryMaybeActiveRows(buildQuery(true), buildQuery(false));
  if (error) throw error;

  const settled = await Promise.allSettled((scrolls ?? []).map((scroll) => generateOneScrollImage(scroll)));
  return settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return { scrollId: scrolls?.[index]?.id, failed: true, error: formatUnknownError(result.reason) };
  });
}

async function generateOneScrollImage(scroll) {
  const targetIndex = Number(scroll.image_count ?? 0) + 1;
  if (isStoryTargetBeyondEnd({ generationMode: scroll.generation_mode, storyTotalFrames: scroll.story_total_frames, targetIndex })) {
    await markScrollComplete(scroll.id);
    return { scrollId: scroll.id, targetIndex, skipped: "story_complete" };
  }
  const aiScriptFrame = await loadAiScriptFrameIfNeeded(scroll, targetIndex);
  if (aiScriptFrame?.complete) {
    await markScrollComplete(scroll.id);
    return { scrollId: scroll.id, targetIndex, skipped: "story_complete" };
  }
  const existingTargetImage = await loadExistingGeneratedImage(scroll.id, targetIndex);
  if (existingTargetImage) {
    return await recoverExistingGeneratedFrame(scroll, targetIndex, existingTargetImage);
  }
  const runningJob = await loadRunningJob(scroll.id);
  if (runningJob) {
    if (isStaleRunningJob({ lockedAt: runningJob.locked_at })) {
      await finishJob(runningJob.id, "failed", "Running job timed out and was released for a retry");
    } else {
      return { scrollId: scroll.id, targetIndex, skipped: "running_job_exists" };
    }
  }
  const job = await createRunningJob(scroll, targetIndex, "auto_next");
  try {
    const isFirst = targetIndex === 1;
    const overlapRatio = FIXED_OVERLAP_RATIO;
    const { width, height, overlapWidth, visibleWidth } = getScrollImageDimensions(isFirst, overlapRatio);
    const now = new Date().toISOString();
    const previousImage = isFirst ? null : await loadPreviousImage(scroll.id, targetIndex - 1);
    const previousVisibleBuffer = previousImage ? await readLocalPublicImage(previousImage.full_image_url) : null;
    if (!isFirst && !previousVisibleBuffer) {
      const message = `Previous frame ${targetIndex - 1} image could not be downloaded; strict scroll continuation requires a reference image`;
      await finishGenerationFailure(job.id, scroll.id, targetIndex, message);
      return { scrollId: scroll.id, targetIndex, failed: true, error: message };
    }
    const styleReferenceBuffer = previousVisibleBuffer ? await loadStyleReferenceImageBuffer(scroll.id, targetIndex, previousVisibleBuffer) : null;
    const styleReferenceImageBase64 = styleReferenceBuffer ? Buffer.from(styleReferenceBuffer).toString("base64") : undefined;
    const referenceImageBase64 =
      previousVisibleBuffer && overlapWidth > 0 ? (await extractRightOverlapByWidth(previousVisibleBuffer, overlapWidth, height)).toString("base64") : undefined;
    const creativePlan = aiScriptFrame?.frame
      ? buildAiScriptCreativePlan({
          frame: aiScriptFrame.frame,
          totalFrames: Number(scroll.story_total_frames ?? aiScriptFrame.totalFrames),
          previousSummary: targetIndex > 1 ? summarizePreviousPrompt(previousImage?.prompt, 240) : "",
        })
      : normalizeCreativePlan(job.hasPersistedCreativePlan ? job.creative_plan : undefined, {
          theme: scroll.original_theme,
          optimizedPrompt: scroll.optimized_prompt,
          generationMode: scroll.generation_mode,
          storyTemplate: scroll.story_template,
          storyTemplateVersion: scroll.story_template_version,
          storyTotalFrames: scroll.story_total_frames,
          previousPrompt: scroll.generation_mode === "story" ? undefined : summarizePreviousPrompt(previousImage?.prompt),
          targetIndex,
          hasReferenceImage: Boolean(previousVisibleBuffer),
        });
    if (JSON.stringify(creativePlan) !== JSON.stringify(job.creative_plan)) {
      await updateJobCreativePlan(job.id, creativePlan, now);
    }
    const prompt = buildImagePrompt(scroll, targetIndex, Boolean(referenceImageBase64), creativePlan, Boolean(styleReferenceImageBase64));
    const generated = await withGenerationTimeout(
      previousVisibleBuffer
        ? generateOutpaintedImage(prompt, previousVisibleBuffer, overlapRatio, overlapWidth, height, width, referenceImageBase64, styleReferenceImageBase64)
        : generateImage(prompt, referenceImageBase64),
    );

    if (!generated?.bytes) {
      await finishGenerationFailure(job.id, scroll.id, targetIndex, "Image model did not return valid image bytes");
      return { scrollId: scroll.id, targetIndex, failed: true, error: "Image model did not return valid image bytes" };
    }
    log(`frame ${targetIndex} image generation returned; bytes=${generated.bytes.byteLength}; model=${generated.model}`);

    let stitchQualityScore;
    if (previousVisibleBuffer && overlapWidth > 0) {
      generated.bytes = await withPostGenerationStage(`frame ${targetIndex} overlap postprocess`, () =>
        copyPreviousOverlapIntoNewImage(generated.bytes, previousVisibleBuffer, overlapWidth, height, overlapRatio, width, Math.round(overlapWidth * 0.25)),
      );
      stitchQualityScore = await withPostGenerationStage(`frame ${targetIndex} seam score`, () =>
        calculateVisibleSeamQualityScore(generated.bytes, overlapWidth, height, Math.round(overlapWidth * 0.125)),
      );
    } else {
      generated.bytes = await withPostGenerationStage(`frame ${targetIndex} normalize image`, () => normalizeImageBuffer(generated.bytes, width, height));
    }
    const hasStitchWarning = typeof stitchQualityScore === "number" && stitchQualityScore < 82;
    const styleFallbackWarning = buildFallbackStyleWarning(generated.model);
    if (shouldEnforceFullBleedCanvas(generated.prompt)) {
      const paperBorderCheck = await withPostGenerationStage(`frame ${targetIndex} full-bleed paper border check`, () => detectPaperBorderDrift(generated.bytes));
      if (paperBorderCheck.hasPaperBorderDrift) {
        const message = paperBorderCheck.reason ?? "Generated image contains paper border drift";
        await finishGenerationFailure(job.id, scroll.id, targetIndex, message);
        return { scrollId: scroll.id, targetIndex, failed: true, error: message };
      }
    }
    const persistCheck = await withPostGenerationStage(`frame ${targetIndex} persist eligibility check`, () =>
      canPersistGeneratedImageResult(job.id, scroll.id, targetIndex),
    );
    if (!persistCheck.canPersist) {
      await finishJob(job.id, "failed", persistCheck.reason);
      await safeInsertGenerationLog({
        scroll_id: scroll.id,
        level: "warning",
        message: `第 ${targetIndex} 张重复生成已丢弃`,
        detail: persistCheck.reason,
      });
      return { scrollId: scroll.id, targetIndex, skipped: "duplicate_or_released_job", error: persistCheck.reason };
    }

    const imageUrl = await withPostGenerationStage(`frame ${targetIndex} storage upload`, () => persistImage(scroll.id, targetIndex, generated));
    const image = await withPostGenerationStage(`frame ${targetIndex} image row insert`, () =>
      insertGeneratedImageRow(scroll, targetIndex, imageUrl, generated, {
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

    const completesStory = shouldCompleteStoryAfterFrame({ generationMode: scroll.generation_mode, storyTotalFrames: scroll.story_total_frames, targetIndex });
    const nextFrame = completesStory ? { complete: true } : await loadAiScriptFrameIfNeeded(scroll, targetIndex + 1);
    if (nextFrame?.complete) {
      await markScrollComplete(scroll.id);
    } else {
      await withPostGenerationStage(`frame ${targetIndex} queue next frame`, () =>
        retryTransientOperation(`frame ${targetIndex} queue next frame`, () =>
          insertQueuedJob({
            scrollId: scroll.id,
            targetIndex: targetIndex + 1,
            scheduledFor: nextRunAt,
            creativePlan: nextFrame?.frame
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
                }),
          }),
        ),
      );
    }

    await finishJob(job.id, "succeeded");
    await safeInsertGenerationLog({
      scroll_id: scroll.id,
      level: hasStitchWarning || styleFallbackWarning ? "warning" : "success",
      message: `第 ${targetIndex} 张生成成功`,
      detail: [
        typeof stitchQualityScore === "number" ? `真实图片已生成，衔接评分 ${stitchQualityScore} 分。` : "真实图片已生成并保存到 Supabase Storage。",
        styleFallbackWarning,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    return { scrollId: scroll.id, targetIndex, imageUrl, imageId: image.id, fallback: false };
  } catch (error) {
    const message = formatUnknownError(error);
    await finishGenerationFailure(job.id, scroll.id, targetIndex, message);
    return { scrollId: scroll.id, targetIndex, failed: true, error: message };
  }
}

async function insertGeneratedImageRow(scroll, targetIndex, imageUrl, generated, dimensions) {
  const { width, height, visibleWidth, overlapWidth, overlapRatio, isFirst, stitchQualityScore, hasStitchWarning, now } = dimensions;
  const payload = {
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
  };
  return await retryTransientOperation(`frame ${targetIndex} image row insert`, async () => {
    const existingBeforeInsert = await loadExistingGeneratedImage(scroll.id, targetIndex);
    if (existingBeforeInsert) return existingBeforeInsert;

    const { data, error } = await supabase
        .from("scroll_images")
        .insert(payload)
        .select()
        .single();
    if (!error) return data;

    const existingAfterInsertError = await loadExistingGeneratedImage(scroll.id, targetIndex);
    if (existingAfterInsertError) return existingAfterInsertError;
    throw error;
  });
}

async function loadExistingGeneratedImage(scrollId, targetIndex) {
  const { data, error } = await supabase
    .from("scroll_images")
    .select("*")
    .eq("scroll_id", scrollId)
    .eq("image_index", targetIndex)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function recoverExistingGeneratedFrame(scroll, targetIndex, image) {
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
  const nextFrame = completesStory ? { complete: true } : await loadAiScriptFrameIfNeeded(scroll, targetIndex + 1);
  if (nextFrame?.complete) {
    await markScrollComplete(scroll.id);
  } else {
    await withPostGenerationStage(`frame ${targetIndex} recover queue next frame`, () =>
      retryTransientOperation(`frame ${targetIndex} recover queue next frame`, () =>
        insertQueuedJob({
          scrollId: scroll.id,
          targetIndex: targetIndex + 1,
          scheduledFor: nextRunAt,
          creativePlan: nextFrame?.frame
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
              }),
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
  await safeInsertGenerationLog({
    scroll_id: scroll.id,
    level: "success",
    message: `第 ${targetIndex} 张已恢复`,
    detail: "检测到图片已保存但画卷计数未推进，已恢复生成进度并继续排队下一张。",
  });
  return { scrollId: scroll.id, targetIndex, recovered: true, imageUrl: image.full_image_url, imageId: image.id };
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
  await safeInsertGenerationLog({
    scroll_id: scrollId,
    level: "error",
    message: `第 ${targetIndex} 张生成失败`,
    detail: String(errorMessage).slice(0, 1000),
  });
}

async function safeInsertGenerationLog(payload) {
  await retryTransientOperation(`generation log: ${payload.message ?? "insert"}`, async () => {
    const { error } = await supabase.from("generation_logs").insert(payload);
    if (error) throw error;
  }).catch((error) => {
    log(`generation log insert skipped after retries: ${formatUnknownError(error)}`);
  });
}

async function canPersistGeneratedImageResult(jobId, scrollId, targetIndex) {
  return await retryTransientOperation(`frame ${targetIndex} persist eligibility check`, async () => {
    const [{ data: currentJob, error: jobError }, { data: existingImage, error: imageError }] = await Promise.all([
      supabase.from("generation_jobs").select("status").eq("id", jobId).maybeSingle(),
      supabase.from("scroll_images").select("id").eq("scroll_id", scrollId).eq("image_index", targetIndex).maybeSingle(),
    ]);
    if (jobError) throw jobError;
    if (imageError) throw imageError;
    const canPersist = currentJob?.status === "running" && !existingImage?.id;
    return {
      canPersist,
      reason: existingImage?.id
        ? `Target image ${targetIndex} already exists; discarding duplicate generated result`
        : `Job ${jobId} is no longer running; discarding late generated result`,
    };
  });
}

async function runSupabaseResult(label, task, maxAttempts = 3) {
  return await retryTransientOperation(label, async () => {
    const result = await task();
    if (result?.error) throw result.error;
    return result;
  }, maxAttempts);
}

async function retryTransientOperation(label, task, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) log(`${label} retry ${attempt}/${maxAttempts}`);
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransientFetchError(error) || attempt === maxAttempts) throw error;
      const delayMs = 1000 * attempt;
      log(`${label} transient failure, retrying in ${delayMs}ms: ${formatUnknownError(error)}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

function isRetryableTransientFetchError(error) {
  if (!error || typeof error !== "object") return false;
  const name = String(error.name ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return name === "AbortError" || name === "TypeError" || message.includes("fetch failed") || message.includes("timeout") || message.includes("aborted") || message.includes("network");
}

function withGenerationTimeout(promise) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`图片生成超过 ${Math.round(generationTimeoutMs / 60000)} 分钟未返回`)), generationTimeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function withPostGenerationStage(stageName, task) {
  const startedAt = Date.now();
  log(`${stageName} started`);
  let timeout;
  try {
    const result = await Promise.race([
      task(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${stageName} timed out after ${Math.round(postGenerationStageTimeoutMs / 1000)} seconds`)), postGenerationStageTimeoutMs);
      }),
    ]);
    log(`${stageName} finished in ${Date.now() - startedAt}ms`);
    return result;
  } catch (error) {
    log(`${stageName} failed after ${Date.now() - startedAt}ms: ${formatUnknownError(error)}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

async function loadAiScriptFrameIfNeeded(scroll, targetIndex) {
  if (scroll.generation_mode !== "story" || scroll.story_template !== AI_SCRIPT_TEMPLATE) return null;
  const totalFrames = Number(scroll.story_total_frames ?? 0);
  if (totalFrames > 0 && targetIndex > totalFrames) return { complete: true, totalFrames };
  const { data, error } = await supabase
    .from("scroll_story_frames")
    .select("*")
    .eq("scroll_id", scroll.id)
    .eq("frame_index", targetIndex)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { complete: true, totalFrames };
  return { complete: false, totalFrames, frame: mapScriptFrameRow(data) };
}

async function markScrollComplete(scrollId) {
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

function getCandidateScrollFilters({ scrollId, manual = false, nowIso = new Date().toISOString() }) {
  return {
    scrollId: scrollId ?? undefined,
    requireAutoEnabled: !manual,
    dueBeforeIso: manual || scrollId ? undefined : nowIso,
  };
}

function getImageRequestTimeoutMs() {
  const defaultGenerationTimeoutMs = 12 * 60 * 1000;
  const defaultImageRequestTimeoutMs = 4 * 60 * 1000;
  const configuredGenerationTimeoutMs = parsePositiveInteger(process.env.GENERATION_TIMEOUT_MS) ?? defaultGenerationTimeoutMs;
  const configuredImageTimeoutMs = parsePositiveInteger(process.env.OPENAI_IMAGE_TIMEOUT_MS);
  const customGatewayDefaultMs = Math.max(60 * 1000, configuredGenerationTimeoutMs - 60 * 1000);
  const defaultTimeoutMs = isCustomOpenAICompatibleBaseUrl(getEnvValue("OPENAI_BASE_URL")) ? customGatewayDefaultMs : defaultImageRequestTimeoutMs;
  return Math.min(configuredGenerationTimeoutMs, configuredImageTimeoutMs ?? defaultTimeoutMs);
}

function getImageEditRequestTimeoutMs() {
  const defaultImageEditRequestTimeoutMs = 45 * 1000;
  const configuredEditTimeoutMs = parsePositiveInteger(process.env.OPENAI_IMAGE_EDIT_TIMEOUT_MS);
  const imageRequestTimeoutMs = getImageRequestTimeoutMs();
  const defaultTimeoutMs = isCustomOpenAICompatibleBaseUrl(getEnvValue("OPENAI_BASE_URL")) ? imageRequestTimeoutMs : defaultImageEditRequestTimeoutMs;
  return Math.min(imageRequestTimeoutMs, configuredEditTimeoutMs ?? defaultTimeoutMs);
}

function parsePositiveInteger(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function isCustomOpenAICompatibleBaseUrl(value) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname !== "api.openai.com" && !hostname.endsWith(".openai.com");
  } catch {
    return false;
  }
}

function isStaleRunningJob({ lockedAt, nowIso = new Date().toISOString(), staleAfterMinutes = staleRunningJobMinutes }) {
  if (!lockedAt) return false;
  const lockedTime = Date.parse(lockedAt);
  const nowTime = Date.parse(nowIso);
  if (Number.isNaN(lockedTime) || Number.isNaN(nowTime)) return false;
  return nowTime - lockedTime > staleAfterMinutes * 60000;
}

function isStoryTargetBeyondEnd({ generationMode, storyTotalFrames, targetIndex }) {
  const totalFrames = Number(storyTotalFrames ?? 0);
  return generationMode === "story" && totalFrames > 0 && targetIndex > totalFrames;
}

function shouldCompleteStoryAfterFrame({ generationMode, storyTotalFrames, targetIndex }) {
  const totalFrames = Number(storyTotalFrames ?? 0);
  return generationMode === "story" && totalFrames > 0 && targetIndex >= totalFrames;
}

async function createRunningJob(scroll, targetIndex, type) {
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

  const initialPlan = normalizeCreativePlan(queuedJob?.creative_plan, {
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
          locked_by: "local-dev-api",
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
          type,
          status: "running",
          scheduled_for: now,
          locked_at: now,
          locked_by: "local-dev-api",
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
            locked_by: "local-dev-api",
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
            type,
            status: "running",
            scheduled_for: now,
            locked_at: now,
            locked_by: "local-dev-api",
          })
          .select()
          .single();
  }
  const { data, error } = jobResult;
  if (error) throw error;
  if (data) data.hasPersistedCreativePlan = hasPersistedCreativePlan;
  return data;
}

async function finishJob(jobId, status, errorMessage) {
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

function isMissingCreativePlanColumn(error) {
  const message = String(error?.message ?? "").toLowerCase();
  const code = String(error?.code ?? "");
  return code === "PGRST204" || code === "42703" || (message.includes("creative_plan") && (message.includes("column") || message.includes("does not exist")));
}

async function insertInitialJob(input) {
  const { error } = await supabase.from("generation_jobs").insert({
    scroll_id: input.scrollId,
    target_index: 1,
    type: "auto_next",
    status: "queued",
    scheduled_for: input.scheduledFor,
    creative_plan: input.creativePlan,
  });
  if (!error) return;
  if (!isMissingCreativePlanColumn(error)) throw error;
  const { error: fallbackError } = await supabase.from("generation_jobs").insert({
    scroll_id: input.scrollId,
    target_index: 1,
    type: "auto_next",
    status: "queued",
    scheduled_for: input.scheduledFor,
  });
  if (fallbackError) throw fallbackError;
}

async function updateJobCreativePlan(jobId, creativePlan, now) {
  const { error } = await supabase.from("generation_jobs").update({ creative_plan: creativePlan, updated_at: now }).eq("id", jobId);
  if (error && !isMissingCreativePlanColumn(error)) throw error;
}

async function insertQueuedJob(input) {
  const { error } = await supabase.from("generation_jobs").insert({
    scroll_id: input.scrollId,
    target_index: input.targetIndex,
    type: "auto_next",
    status: "queued",
    scheduled_for: input.scheduledFor,
    creative_plan: input.creativePlan,
  });
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

async function deleteImage(imageId) {
  if (!isUuid(imageId)) throw new Error("Invalid imageId");
  const { data: image, error: imageError } = await supabase.from("scroll_images").select("scroll_id,image_index").eq("id", imageId).single();
  if (imageError) throw imageError;
  const archivedAt = new Date().toISOString();
  const purgeAfter = calculatePurgeAfter(archivedAt);
  const { error: archiveError } = await supabase.from("scroll_images").update({ archived_at: archivedAt, purge_after: purgeAfter }).eq("id", imageId);
  if (archiveError) throw archiveError;

  await supabase.from("generation_logs").insert({
    scroll_id: image.scroll_id,
    level: "warning",
    message: `第 ${image.image_index} 张已移入归档站`,
    detail: "7 天内可从归档站恢复到原位置。",
  });

  return { imageId, scrollId: image.scroll_id, imageIndex: image.image_index, archivedAt, purgeAfter };
}

async function restoreImage(imageId) {
  if (!isUuid(imageId)) throw new Error("Invalid imageId");
  const { data: image, error: imageError } = await supabase.from("scroll_images").select("scroll_id,image_index").eq("id", imageId).single();
  if (imageError) throw imageError;
  const { error } = await supabase.from("scroll_images").update({ archived_at: null, purge_after: null }).eq("id", imageId);
  if (error) throw error;

  await supabase.from("generation_logs").insert({
    scroll_id: image.scroll_id,
    level: "success",
    message: `第 ${image.image_index} 张已恢复`,
    detail: "图片已回到画卷原位置。",
  });

  return { imageId, scrollId: image.scroll_id, imageIndex: image.image_index };
}

async function purgeImage(imageId) {
  if (!isUuid(imageId)) throw new Error("Invalid imageId");
  const { data: image, error: imageLoadError } = await supabase.from("scroll_images").select("full_image_url").eq("id", imageId).single();
  if (imageLoadError) throw imageLoadError;

  const storagePath = getStoragePathFromPublicUrl(image?.full_image_url, "scroll-images");
  if (storagePath) {
    const { error: storageError } = await supabase.storage.from("scroll-images").remove([storagePath]);
    if (storageError) throw storageError;
  }

  const { error: deleteError } = await supabase.from("scroll_images").delete().eq("id", imageId);
  if (deleteError) throw deleteError;
  return { imageId, deletedImages: 1 };
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
  const buildQuery = (includeArchiveFilter) => {
    let query = supabase.from("scroll_images").select("full_image_url").eq("scroll_id", scrollId);
    if (includeArchiveFilter) query = query.is("archived_at", null);
    return query.order("image_index", { ascending: false }).limit(1).maybeSingle();
  };

  const { data, error } = await queryMaybeActiveRows(buildQuery(true), buildQuery(false));
  if (error) throw error;
  return data;
}

async function optimizeTheme(theme, requirements = "") {
  if (!process.env.DEEPSEEK_API_KEY) return fallbackPrompt(theme, requirements);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 20000));

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "你是《无限画卷》的画卷提示词工程师。必须严格围绕用户主题优化提示词，不得替换成无关题材，不得泛化成普通山水或古风模板。用户补充要求优先级高于默认画卷审美；用户明确禁止的风格、媒介、题材或元素必须作为硬约束执行。输出必须是中文提示词正文，不要标题、解释、编号或 Markdown。提示词要适合横向连续长卷：说明核心题材、时代或世界观、视觉风格、色彩与光照、左到右叙事推进、相邻画面衔接、可持续生成的空间线索。",
          },
          {
            role: "user",
            content: [
              `用户主题：${theme}`,
              requirements ? `补充要求：${requirements}` : "",
              "请把这个主题优化成一段可直接交给图像模型生成连续横向画卷的提示词。必须保留并强化主题中的关键名词和气质。",
              "如果补充要求里出现“不要、不得、禁止、不使用、不用、避免、no、without、avoid”等禁止性表达，不得在输出中重新加入这些被禁止的词、媒介或风格，也不得用同义描述把它们带回。",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        temperature: 0.35,
      }),
    });

    if (!response.ok) return fallbackPrompt(theme, requirements);
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || fallbackPrompt(theme, requirements);
  } catch {
    return fallbackPrompt(theme, requirements);
  } finally {
    clearTimeout(timeout);
  }
}

async function draftScript(input) {
  const theme = String(input?.theme ?? "").trim();
  if (!theme) throw new Error("theme is required");
  const frameCount = normalizeScriptFrameCount(input?.frameCount);
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is required for script drafting");
  const content = await requestDeepSeekScript({
    theme,
    frameCount,
    requirements: String(input?.requirements ?? "").trim(),
    stylePrompt: String(input?.stylePrompt ?? "").trim(),
  });
  return normalizeScriptDraftPayload(JSON.parse(content), frameCount, theme);
}

function normalizeScriptFrameCount(value) {
  const count = Number(value);
  return [24, 48, 96, 128].includes(count) ? count : 48;
}

async function requestDeepSeekScript({ theme, frameCount, requirements, stylePrompt }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 60000));
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.45,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是《无限画卷》的专业编剧和分镜导演。必须输出严格 JSON，不要 Markdown。剧情必须逐帧推进，角色和视觉风格保持一致。用户补充要求优先级高于默认画卷审美；用户明确禁止的风格、媒介、题材或元素必须作为硬约束执行，并写入 visualStyle、每帧 forbidden 与 visualPromptHint。",
          },
          {
            role: "user",
            content: [
              `主题：${theme}`,
              `总帧数：${frameCount}`,
              requirements ? `补充要求：${requirements}` : "",
              stylePrompt ? `视觉风格提示：${stylePrompt}` : "",
              "请输出 JSON 对象，字段必须包含：title, summary, visualStyle, characterBible, frames。",
              "frames 长度必须等于总帧数，每帧包含 frameIndex, chapter, title, scene, characters, location, mood, continuityAnchor, forbidden, visualPromptHint。",
              "如果补充要求或视觉风格提示中包含禁止性表达，forbidden 必须逐帧写入这些禁止项；visualStyle 和 visualPromptHint 必须采用用户指定的正向风格，不得把被禁止的媒介或风格带回。",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek script draft failed: ${response.status} ${await response.text()}`);
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("DeepSeek returned empty script draft");
    return raw;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeScriptDraftPayload(value, frameCount, theme) {
  const frames = Array.isArray(value?.frames) ? value.frames : [];
  if (frames.length !== frameCount) throw new Error(`Expected ${frameCount} script frames, got ${frames.length}`);
  return {
    title: String(value.title ?? `${theme}画卷剧本`).trim(),
    summary: String(value.summary ?? "").trim(),
    visualStyle: String(value.visualStyle ?? "").trim(),
    characterBible: String(value.characterBible ?? "").trim(),
    frames: frames.map((frame, index) => ({
      frameIndex: Number(frame.frameIndex ?? index + 1),
      chapter: String(frame.chapter ?? "未分章").trim(),
      title: String(frame.title ?? `第 ${index + 1} 帧`).trim(),
      scene: String(frame.scene ?? "").trim(),
      characters: Array.isArray(frame.characters) ? frame.characters.map((item) => String(item).trim()).filter(Boolean) : [],
      location: String(frame.location ?? "").trim(),
      mood: String(frame.mood ?? "").trim(),
      continuityAnchor: String(frame.continuityAnchor ?? "采用分镜长卷衔接：用道路、云气、光色、卷轴纹理和运动方向承接上一帧。").trim(),
      forbidden: String(frame.forbidden ?? "只画当前剧情帧，不得提前画后续剧情，不得跳过剧情，不得改编成无关场景。").trim(),
      visualPromptHint: String(frame.visualPromptHint ?? "").trim(),
    })),
  };
}

async function purgeExpiredArchivedImages() {
  const { data, error } = await supabase.from("scroll_images").select("id").not("archived_at", "is", null).lte("purge_after", new Date().toISOString());
  if (error) throw error;
  for (const image of data ?? []) {
    await purgeImage(image.id);
  }
}

async function loadPreviousImage(scrollId, imageIndex) {
  const buildQuery = (includeArchiveFilter) => {
    let query = supabase.from("scroll_images").select("*").eq("scroll_id", scrollId).eq("image_index", imageIndex);
    if (includeArchiveFilter) query = query.is("archived_at", null);
    return query.single();
  };

  const { data, error } = await queryMaybeActiveRows(buildQuery(true), buildQuery(false));
  if (error) throw error;
  return data;
}

async function loadStyleReferenceImageBuffer(scrollId, targetIndex, fallbackBuffer) {
  if (targetIndex <= 1) return null;
  try {
    const referenceImage = await loadPreviousImage(scrollId, 1);
    if (!referenceImage?.full_image_url) return fallbackBuffer;
    return (await readLocalPublicImage(referenceImage.full_image_url)) ?? fallbackBuffer;
  } catch (error) {
    log(`style reference image load failed; using previous frame as style reference: ${formatUnknownError(error)}`);
    return fallbackBuffer;
  }
}

async function generateImage(prompt, referenceImageBase64) {
  if (process.env.LOCAL_DETERMINISTIC_IMAGE_GENERATION === "true") return generateDeterministicImage(prompt, 1);
  const baseUrl = (getEnvValue("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const v1 = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const preferImageApi = shouldPreferImageApi(baseUrl);

  if (preferImageApi) {
    const imageApiResult = await tryImageApi(v1, compactPromptForImageApi(prompt));
    if (imageApiResult) return imageApiResult;
  }

  const responsesResult = await tryResponsesImageTool(prompt, referenceImageBase64);
  if (responsesResult) return responsesResult;
  if (referenceImageBase64) {
    log("retrying Responses image tool without reference image");
    const textOnlyResponsesResult = await tryResponsesImageTool(prompt, undefined);
    if (textOnlyResponsesResult) return textOnlyResponsesResult;
  }
  if (!preferImageApi) {
    const imageApiResult = await tryImageApi(v1, prompt);
    if (imageApiResult) return imageApiResult;
  }
  return fallbackImage(prompt, getImageApiModelCandidates()[0]);
}

async function generateOutpaintedImage(prompt, previousImageBuffer, overlapRatio, sourceOverlapWidth, sourceHeight, sourceWidth, referenceImageBase64, styleReferenceImageBase64) {
  if (process.env.LOCAL_DETERMINISTIC_IMAGE_GENERATION === "true") return generateDeterministicImage(prompt, 2);
  void referenceImageBase64;
  const editResult = await tryImageEditOutpaint(prompt, previousImageBuffer, overlapRatio, sourceOverlapWidth, sourceHeight, sourceWidth, styleReferenceImageBase64);
  if (editResult) return editResult;
  log("outpaint edit failed; refusing plain generation because strict scroll stitching requires edit-based continuation");
  return { prompt, model: `${getImageApiModelCandidates()[0]} edit-outpaint failed`, fallback: true };
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

async function fallbackImage(prompt, model) {
  const bytes = await getLocalFallbackImageBytes();
  return {
    imageUrl: "/assets/scroll-segment.svg",
    model: `${model} local fallback`,
    prompt,
    bytes,
    mimeType: "image/png",
    fallback: true,
  };
}

let localFallbackImageBytesPromise = null;

function getLocalFallbackImageBytes() {
  if (!localFallbackImageBytesPromise) {
    localFallbackImageBytesPromise = sharp(readFileSync(new URL("../public/assets/scroll-segment.svg", import.meta.url)))
      .png()
      .toBuffer();
  }
  return localFallbackImageBytesPromise;
}

async function tryImageEditOutpaint(prompt, previousImageBuffer, overlapRatio, sourceOverlapWidth, sourceHeight = 768, sourceWidth, styleReferenceImageBase64) {
  const baseUrl = (getEnvValue("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const v1 = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const endpoint = `${v1}/images/edits`;
  const editWidth = sourceWidth ?? 1536;
  const editHeight = sourceWidth ? sourceHeight : 1024;
  const overlapWidth = sourceOverlapWidth ?? Math.max(1, Math.round((editWidth / (1 + overlapRatio)) * overlapRatio));
  const canvas = await createOutpaintCanvas(previousImageBuffer, editWidth, editHeight, overlapWidth, sourceOverlapWidth ?? overlapWidth, sourceHeight);
  const mask = await createOutpaintMask(editWidth, editHeight, overlapWidth);
  for (const model of getImageApiModelCandidates()) {
    for (const apiKey of getOpenAIKeyPool()) {
    const keyLabel = getOpenAIKeyLabel(apiKey);
    const imageTimeoutMs = getImageEditRequestTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), imageTimeoutMs);
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", sourceWidth ? "auto" : "1536x1024");
    form.append("quality", "high");
    if (model !== "gpt-image-2") form.append("input_fidelity", "high");
    form.append("n", "1");
    form.append("image[]", new Blob([new Uint8Array(canvas)], { type: "image/png" }), "canvas.png");
    form.append("image[]", new Blob([new Uint8Array(previousImageBuffer)], { type: "image/png" }), "previous.png");
    if (styleReferenceImageBase64) {
      form.append("image[]", new Blob([new Uint8Array(Buffer.from(styleReferenceImageBase64, "base64"))], { type: "image/png" }), "style-reference.png");
    }
    form.append("mask", new Blob([mask], { type: "image/png" }), "mask.png");

    try {
      log(`trying Image Edit outpaint model ${model} using ${keyLabel}`);
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      });
      const text = await response.text();
      log(`Image Edit ${keyLabel} response ${response.status}, length ${text.length}`);
      if (!response.ok) continue;
      const data = JSON.parse(text);
      const base64 = data.data?.[0]?.b64_json;
      if (!base64) {
        log(`Image Edit ${keyLabel} returned no image bytes`);
        continue;
      }
      const bytes = Buffer.from(base64, "base64");
      log(`Image Edit ${keyLabel} decoded ${bytes.byteLength} bytes`);
      return { prompt, model: `${model} edit-outpaint (${keyLabel})`, bytes, mimeType: "image/png", fallback: false };
    } catch (error) {
      if (isAbortError(error)) {
        log(`Image Edit ${keyLabel} timed out after ${imageTimeoutMs}ms for ${model}; falling back to reference-guided generation`);
        return null;
      }
      log(`Image Edit ${keyLabel} threw ${formatUnknownError(error)}`);
    } finally {
      clearTimeout(timeout);
    }
    }
  }
  return null;
}

async function tryResponsesImageTool(prompt, referenceImageBase64) {
  const responseModel = getEnvValue("OPENAI_RESPONSE_MODEL") || getEnvValue("OPENAI_MODEL") || DEFAULT_RESPONSE_MODEL;
  const content = [{ type: "input_text", text: prompt }];
  if (referenceImageBase64) {
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${referenceImageBase64}`,
      detail: "high",
    });
  }

  for (const imageModel of getImageToolModelCandidates()) {
    for (const apiKey of getOpenAIKeyPool()) {
    const keyLabel = getOpenAIKeyLabel(apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getImageRequestTimeoutMs());
    const client = createOpenAIClient(apiKey);
    try {
      log(`trying Responses image tool responseModel=${responseModel}, imageModel=${imageModel} using ${keyLabel}`);
      const response = await client.responses.create(
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
              action: "generate",
            },
          ],
          reasoning: { effort: "medium" },
        },
        { signal: controller.signal },
      );

      const imageCall = response.output?.find((item) => item.type === "image_generation_call");
      const base64 = imageCall?.result;
      log(`Responses image tool ${keyLabel} status=${imageCall?.status ?? "missing"}, base64=${typeof base64 === "string" ? base64.length : 0}`);
      if (typeof base64 !== "string" || base64.length < 100) continue;

      return { prompt, model: `${responseModel} + ${imageModel} (${keyLabel})`, bytes: Buffer.from(base64, "base64"), mimeType: "image/png", fallback: false };
    } catch (error) {
      if (isAbortError(error)) {
        log(`Responses image tool ${keyLabel} timed out for ${imageModel}; falling back to Image API generation`);
        return null;
      }
      log(`Responses image tool ${keyLabel} threw ${formatUnknownError(error)}`);
    } finally {
      clearTimeout(timeout);
    }
    }
  }
  return null;
}

async function tryImageApi(v1, prompt) {
  const endpoint = `${v1}/images/generations`;
  const useFreshProcess = shouldPreferImageApi(v1);

  for (const model of getImageApiModelCandidates()) {
    for (const apiKey of getOpenAIKeyPool()) {
    const keyLabel = getOpenAIKeyLabel(apiKey);
    const controller = new AbortController();
    const imageTimeoutMs = getImageRequestTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), imageTimeoutMs);
    try {
      log(`trying Image API model ${model} using ${keyLabel}; promptChars=${prompt.length}; promptPreview=${JSON.stringify(prompt.slice(0, 260))}`);
      if (useFreshProcess) {
        const childResult = await runImageApiInFreshProcess({ endpoint, apiKey, model, prompt, timeoutMs: imageTimeoutMs });
        if (childResult.base64) {
          log(`Image API ${keyLabel} child response ${childResult.status}, base64=${childResult.base64.length}`);
          return { prompt, model: `${model} (${keyLabel})`, bytes: Buffer.from(childResult.base64, "base64"), mimeType: "image/png", fallback: false };
        }
        log(`Image API ${keyLabel} child response ${childResult.status ?? "error"}, detail=${childResult.error ?? childResult.text ?? ""}`);
        continue;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
      log(`Image API ${keyLabel} response ${response.status}, length ${text.length}`);
      if (!response.ok) continue;

      const data = JSON.parse(text);
      const base64 = data.data?.[0]?.b64_json;
      if (!base64) continue;

      return { prompt, model: `${model} (${keyLabel})`, bytes: Buffer.from(base64, "base64"), mimeType: "image/png", fallback: false };
    } catch (error) {
      log(`Image API ${keyLabel} threw ${formatUnknownError(error)}`);
    } finally {
      clearTimeout(timeout);
    }
    }
  }
  return null;
}

function runImageApiInFreshProcess({ endpoint, apiKey, model, prompt, timeoutMs }) {
  const childCode = `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", async () => {
  const payload = JSON.parse(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), payload.timeoutMs);
  try {
    const response = await fetch(payload.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: "Bearer " + payload.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: payload.model,
        prompt: payload.prompt,
        size: "1024x1024",
        quality: "low",
        n: 1,
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      console.log(JSON.stringify({ status: response.status, text: text.slice(0, 500) }));
      return;
    }
    const data = JSON.parse(text);
    console.log(JSON.stringify({ status: response.status, base64: data.data?.[0]?.b64_json ?? "" }));
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error), errorName: error?.name }));
  } finally {
    clearTimeout(timeout);
  }
});
`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", childCode], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const parentTimeout = setTimeout(() => {
      child.kill();
      resolve({ error: `child image request timed out after ${timeoutMs}ms` });
    }, timeoutMs + 5000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(parentTimeout);
      resolve({ error: error.message });
    });
    child.on("close", () => {
      clearTimeout(parentTimeout);
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({ error: stderr.trim() || stdout.trim() || "child image request returned no JSON" });
      }
    });
    child.stdin.end(JSON.stringify({ endpoint, apiKey, model, prompt, timeoutMs }));
  });
}

async function persistImage(scrollId, targetIndex, generated) {
  return persistGeneratedImageToSupabase({ supabase, bucket: "scroll-images", scrollId, targetIndex, generated });
}

async function readLocalPublicImage(publicUrl) {
  if (/^https?:\/\//.test(publicUrl)) {
    const timeoutMs = Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS ?? 60000);
    const maxAttempts = parsePositiveInteger(process.env.IMAGE_DOWNLOAD_MAX_ATTEMPTS) ?? 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(publicUrl, { signal: controller.signal });
        if (response.ok) return Buffer.from(await response.arrayBuffer());
        log(`previous image download returned ${response.status} for ${publicUrl}`);
        if (!isRetryableImageDownloadStatus(response.status) || attempt === maxAttempts) {
          return null;
        }
      } catch (error) {
        log(`previous image download failed for ${publicUrl}: ${formatUnknownError(error)}`);
        if (!isRetryableTransientFetchError(error) || attempt === maxAttempts) {
          return null;
        }
      } finally {
        clearTimeout(timeout);
      }
      const delayMs = 1200 * attempt;
      log(`retrying previous image download ${attempt + 1}/${maxAttempts} after ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
  }
  if (!publicUrl?.startsWith("/")) throw new Error(`Only local public image URLs are supported in dev mode: ${publicUrl}`);
  return readFileSync(`public${publicUrl.replaceAll("/", "\\")}`);
}

function isRetryableImageDownloadStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
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

async function copyPreviousOverlapIntoNewImage(newImageBuffer, previousImageBuffer, overlapWidth, height, overlapRatio, width = 1152, featherWidth = 0) {
  const normalizedNew = await normalizeImageBuffer(newImageBuffer, width, height);
  const resizedPrevOverlap = await extractRightOverlapByWidth(previousImageBuffer, overlapWidth, height);
  const composite = [{ input: resizedPrevOverlap, left: 0, top: 0, blend: "over" }];
  const safeFeatherWidth = Math.max(0, Math.min(Math.floor(featherWidth), overlapWidth));
  if (safeFeatherWidth > 0) {
    const featherRgb = await sharp(resizedPrevOverlap)
      .extract({ left: Math.max(0, overlapWidth - safeFeatherWidth), top: 0, width: safeFeatherWidth, height })
      .resize(safeFeatherWidth, height, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();
    const featherRgba = Buffer.alloc(safeFeatherWidth * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < safeFeatherWidth; x += 1) {
        const rgbOffset = (y * safeFeatherWidth + x) * 3;
        const rgbaOffset = (y * safeFeatherWidth + x) * 4;
        const alpha = Math.round(150 * (1 - x / Math.max(1, safeFeatherWidth - 1)));
        featherRgba[rgbaOffset] = featherRgb[rgbOffset];
        featherRgba[rgbaOffset + 1] = featherRgb[rgbOffset + 1];
        featherRgba[rgbaOffset + 2] = featherRgb[rgbOffset + 2];
        featherRgba[rgbaOffset + 3] = alpha;
      }
    }
    const featherSource = await sharp(featherRgba, { raw: { width: safeFeatherWidth, height, channels: 4 } }).png().toBuffer();
    composite.push({ input: featherSource, left: overlapWidth, top: 0, blend: "over" });
  }
  return sharp(normalizedNew)
    .composite(composite)
    .png()
    .toBuffer();
}

async function calculateVisibleSeamQualityScore(imageBuffer, seamX, height, bandWidth = 48) {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? seamX * 2;
  const normalized = await normalizeImageBuffer(imageBuffer, width, height);
  const safeSeamX = Math.max(1, Math.min(Math.round(seamX), width - 1));
  const safeBandWidth = Math.max(1, Math.min(Math.floor(bandWidth), safeSeamX, width - safeSeamX));
  const leftBand = await sharp(normalized)
    .extract({ left: safeSeamX - safeBandWidth, top: 0, width: safeBandWidth, height })
    .removeAlpha()
    .raw()
    .toBuffer();
  const rightBand = await sharp(normalized)
    .extract({ left: safeSeamX, top: 0, width: safeBandWidth, height })
    .removeAlpha()
    .raw()
    .toBuffer();
  const length = Math.min(leftBand.length, rightBand.length);
  if (!length) return 0;

  let totalDifference = 0;
  for (let index = 0; index < length; index += 1) totalDifference += Math.abs(leftBand[index] - rightBand[index]);
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

function fallbackPrompt(theme, requirements = "") {
  const requirementText = String(requirements).trim() ? `严格遵守补充要求：${String(requirements).trim()}。` : "";
  return `以「${theme}」为唯一核心主题生成连续横向画卷，保留主题中的关键人物、地点、时代、材质与气质。${requirementText}画面保持统一的视觉风格、色彩温度、笔触密度、光照方向和空间透视，从左到右自然推进叙事；每一段都延续上一段右侧边缘的道路、水系、建筑、人群、地平线和远景层次，避免突然切换场景。`;
}

function summarizePreviousPrompt(value, maxLength = 360) {
  return summarizePromptFallback(value, maxLength);
}

function summarizePreviousPlanForNextPrompt(plan, fallbackPrompt) {
  return summarizePreviousFrameForNextPrompt(plan, fallbackPrompt);
}

function buildImagePrompt(scroll, targetIndex, hasReferenceImage = false, creativePlan = createCreativePlan({ targetIndex, hasReferenceImage }), hasStyleReferenceImage = false) {
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
      : `This is segment ${targetIndex}. ${isFirst ? "Start the scroll naturally with a 4:3 establishing composition." : "The left edge will be replaced with a pixel-perfect overlap from the previous image; focus on generating coherent new content to the right while matching the reference edge."}`,
    hasReferenceImage
      ? isStoryMode
        ? avoidPaperScrollTexture
          ? "A reference image is attached. Use the supplied left-edge context as a hard visual anchor: match composition density, figure scale, linework, color temperature, lighting direction, garden architecture, and canvas boundary. The story may advance, but the medium and canvas edges must not change."
          : "A reference image is attached. Use it only for palette, paper texture, and scroll transition; story accuracy has priority over same-location seamlessness."
        : "A reference image is attached showing the exact previous right edge. Continue from it naturally into the new right-side scene."
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
    avoidPaperScrollTexture
      ? "No modern objects, no text labels, no UI, no frame, no watermark. Make it feel like a continuous full-bleed panoramic comic scene, not a mounted paper artifact."
      : "No modern objects, no text labels, no UI, no frame, no watermark. Make it feel like a real antique panoramic scroll, not a generic fantasy landscape.",
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizePaperScrollTriggers(value) {
  return String(value ?? "")
    .replace(/\bhandscroll\b/gi, "horizontal comic sequence")
    .replace(/\bpaper texture\b/gi, "surface consistency")
    .replace(/\bscroll transition\b/gi, "visual continuity")
    .replace(/\bantique scroll finish\b/gi, "comic finish")
    .replace(/\breal antique panoramic scroll\b/gi, "continuous panoramic comic scene")
    .replace(/卷轴纹理/g, "画面动线")
    .replace(/卷轴衔接/g, "画面衔接");
}

function shouldEnforceFullBleedCanvas(prompt) {
  return /full-bleed canvas requirement/i.test(prompt) || /no paper borders/i.test(prompt);
}

function getRatioLabel(isFirst, overlapRatio) {
  if (isFirst) return "4:3";
  const widthUnits = 4 * (1 + overlapRatio);
  return `${Number.isInteger(widthUnits) ? widthUnits : widthUnits.toFixed(1)}:3`;
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

function getOpenAIKeyPool() {
  const keys = [
    ...(process.env.OPENAI_API_KEYS ?? "").split(","),
    process.env.OPENAI_API_KEY ?? "",
  ]
    .map((key) => key.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

function getOpenAIKeyLabel(apiKey) {
  const index = getOpenAIKeyPool().indexOf(apiKey);
  return `key #${index + 1}`;
}

function getImageToolModelCandidates() {
  return buildModelCandidates(getEnvValue("OPENAI_IMAGE_MODEL") || DEFAULT_IMAGE_TOOL_MODEL, getEnvValue("OPENAI_IMAGE_MODEL_FALLBACKS") || DEFAULT_IMAGE_TOOL_FALLBACKS);
}

function getImageApiModelCandidates() {
  return buildModelCandidates(getEnvValue("OPENAI_IMAGE_API_MODEL") || DEFAULT_IMAGE_API_MODEL, getEnvValue("OPENAI_IMAGE_API_MODEL_FALLBACKS") || DEFAULT_IMAGE_API_FALLBACKS);
}

function shouldPreferImageApi(baseUrl) {
  const configured = getEnvValue("OPENAI_PREFER_IMAGE_API").toLowerCase();
  if (["1", "true", "yes", "on"].includes(configured)) return true;
  if (["0", "false", "no", "off"].includes(configured)) return false;
  return !isOfficialOpenAIBaseUrl(baseUrl);
}

function isOfficialOpenAIBaseUrl(baseUrl) {
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function compactPromptForImageApi(prompt) {
  const maxChars = 700;
  const getValue = (prefix) => {
    const line = prompt
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix));
    return line?.slice(prefix.length).trim() ?? "";
  };
  const theme = getValue("User theme:") || "连续画卷";
  const direction = getValue("Long-term scroll direction:");
  const frameMatch = prompt.match(/This is story frame\s+(\d+)/i);
  const frameLabel = frameMatch ? `第${frameMatch[1]}帧` : "";
  const title = getValue("Title:").replace(/^第\s*\d+\s*\/\s*\d+\s*帧[:：]\s*/, "").trim();
  const characters = getValue("Characters:");
  const location = getValue("Location:");
  const mood = getValue("Mood:");
  const scene = getValue("New scene:");
  const forbidden = getValue("Forbidden drift:");
  const style = direction.includes("国风漫画") || direction.includes("彩色分镜")
    ? "国风漫画彩色分镜，细净勾线，柔和赛璐璐上色，清代服饰，场景设定一致"
    : (direction.slice(0, 120) || "保持用户指定视觉风格");
  const forbiddenSummary = forbidden || "现代物品、文字、水印、无关场景";
  const compact = [
    `${theme}${style ? `，${style}` : ""}${frameLabel ? `，${frameLabel}` : ""}${title ? `：${title}` : ""}。`,
    scene ? `${scene}。` : "",
    characters ? `人物：${characters}。` : "",
    location ? `地点：${location}。` : "",
    mood ? `氛围：${mood}。` : "",
    `禁止：${forbiddenSummary}。只画当前剧情，不提前画后续。`,
  ].join("");

  return compact.length > 80 ? compact.slice(0, maxChars) : prompt.slice(0, maxChars);
}

function buildModelCandidates(primary, fallbacks) {
  return [...new Set([primary, ...fallbacks.split(",")].map((model) => model.trim()).filter(Boolean))];
}

function getEnvValue(name) {
  const value = process.env[name]?.trim();
  return value && value !== "undefined" && value !== "null" ? value : "";
}

function createOpenAIClient(apiKey) {
  return new OpenAI({
    apiKey,
    baseURL: normalizeOpenAIBaseUrl(getEnvValue("OPENAI_BASE_URL")),
  });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isCronRequestAuthorized(authorizationHeader, cronSecret = process.env.CRON_SECRET) {
  if (!cronSecret) return true;
  const value = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  return value === `Bearer ${cronSecret}`;
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

function formatUnknownError(error) {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object") return String(error);

  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  if (code && message) return `${code}: ${message}`;
  if (message) return message;
  return safeStringify(error);
}

function isAbortError(error) {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "APIUserAbortError" || /aborted|abort/i.test(error.message);
}

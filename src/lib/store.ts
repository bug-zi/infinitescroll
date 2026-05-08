import { useEffect, useMemo, useState } from "react";
import { mockImages, mockJobs, mockLogs, mockScrolls, mockSystemStatus } from "../data/mockData";
import { createCreativePlan } from "./creativePlan";
import { FIXED_OVERLAP_PRESET, FIXED_OVERLAP_RATIO } from "./stitching";
import { planImageDeletion, shouldRegenerateImmediately } from "./imageOperations";
import { chooseScrollAfterDeletion } from "./scrollManagement";
import { deriveSystemStatus } from "./systemStatus";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { mapImageRow, mapJobRow, mapLogRow, mapScrollRow } from "./supabaseMappers";
import type { GenerationJob, GenerationLog, Scroll, ScrollImage, SystemStatus } from "../types";

type DataMode = "loading" | "supabase" | "mock";

type CreateScrollApiResponse = {
  scroll?: Record<string, unknown>;
};

type UpdateScrollApiResponse = {
  scroll?: Record<string, unknown>;
};

type BootstrapResponse = {
  scrolls: Record<string, unknown>[];
  images: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  logs: Record<string, unknown>[];
};

type SystemStatusResponse = Partial<SystemStatus> & {
  serviceRunning?: boolean;
  failedJobs?: number;
  activeScrolls?: number;
};

const BOOTSTRAP_CACHE_KEY = "infinite-scroll:bootstrap-data:v1";

function localLog(scrollId: string, message: string, detail: string, level: GenerationLog["level"] = "info"): GenerationLog {
  return {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    scrollId,
    level,
    message,
    detail,
    createdAt: new Date().toISOString(),
  };
}

function readBootstrapCache(): BootstrapResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BootstrapResponse>;
    if (!Array.isArray(value.scrolls) || !Array.isArray(value.images) || !Array.isArray(value.jobs) || !Array.isArray(value.logs)) return null;
    return {
      scrolls: value.scrolls,
      images: value.images,
      jobs: value.jobs,
      logs: value.logs,
    };
  } catch {
    return null;
  }
}

function writeBootstrapCache(payload: BootstrapResponse) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Cache is a startup optimization only.
  }
}

export function useInfiniteScrollStore() {
  const useMockInitialState = !isSupabaseConfigured;
  const [scrolls, setScrolls] = useState<Scroll[]>(useMockInitialState ? mockScrolls : []);
  const [images, setImages] = useState<ScrollImage[]>(useMockInitialState ? mockImages : []);
  const [jobs, setJobs] = useState<GenerationJob[]>(useMockInitialState ? mockJobs : []);
  const [logs, setLogs] = useState<GenerationLog[]>(useMockInitialState ? mockLogs : []);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>(mockSystemStatus);
  const [serviceStatus, setServiceStatus] = useState<Pick<SystemStatus, "serviceRunning" | "maxConcurrentJobs" | "statusError">>({
    serviceRunning: mockSystemStatus.serviceRunning,
    maxConcurrentJobs: mockSystemStatus.maxConcurrentJobs,
    statusError: mockSystemStatus.statusError,
  });
  const [selectedScrollId, setSelectedScrollId] = useState(useMockInitialState ? mockScrolls[0].id : "");
  const [selectedImageId, setSelectedImageId] = useState(useMockInitialState ? mockImages[0].id : "");
  const [dataMode, setDataMode] = useState<DataMode>(isSupabaseConfigured ? "loading" : "mock");
  const [dataMessage, setDataMessage] = useState("正在连接 Supabase...");
  const [isGenerating, setIsGenerating] = useState(false);

  async function loadRemoteData(keepSelection = true) {
    try {
      const response = await fetch("/api/bootstrap/data");
      if (response.ok) {
        const payload = (await response.json()) as BootstrapResponse;
        writeBootstrapCache(payload);
        applyRemoteData(payload.scrolls, payload.images, payload.jobs, payload.logs, keepSelection);
        void loadSystemStatus();
        return;
      }
    } catch {
      // Fall back to direct anon Supabase reads below.
    }

    if (!supabase) {
      setDataMode("mock");
      setDataMessage("未配置 Supabase，当前使用本地模拟数据。");
      return;
    }

    const [scrollResult, imageResult, jobResult, logResult] = await Promise.all([
      supabase.from("scrolls").select("*").order("created_at", { ascending: false }),
      supabase.from("scroll_images").select("*").order("image_index", { ascending: true }),
      supabase.from("generation_jobs").select("*").order("scheduled_for", { ascending: true }),
      supabase.from("generation_logs").select("*").order("created_at", { ascending: false }).limit(80),
    ]);

    const error = scrollResult.error ?? imageResult.error ?? jobResult.error ?? logResult.error;
    if (error) {
      setDataMode("mock");
      setDataMessage(`Supabase 读取失败：${error.message}`);
      setScrolls([]);
      setImages([]);
      setJobs([]);
      setLogs([]);
      return;
    }

    applyRemoteData(scrollResult.data ?? [], imageResult.data ?? [], jobResult.data ?? [], logResult.data ?? [], keepSelection);
    void loadSystemStatus();
  }

  async function loadSystemStatus() {
    try {
      const response = await fetch("/api/system/status");
      if (!response.ok) return;
      const payload = (await response.json()) as SystemStatusResponse;
      setServiceStatus((current) => ({
        serviceRunning: Boolean(payload.serviceRunning ?? payload.cronRunning ?? current.serviceRunning),
        maxConcurrentJobs: Number(payload.maxConcurrentJobs ?? current.maxConcurrentJobs),
        statusError: typeof payload.statusError === "string" ? payload.statusError : payload.statusError === null ? null : current.statusError,
      }));
    } catch {
      // Status is informative; data loading should not fail because of it.
    }
  }

  function applyRemoteData(
    scrollRows: Record<string, unknown>[],
    imageRows: Record<string, unknown>[],
    jobRows: Record<string, unknown>[],
    logRows: Record<string, unknown>[],
    keepSelection: boolean,
  ) {
    const nextScrolls = scrollRows.map(mapScrollRow);
    const nextImages = imageRows.map(mapImageRow);
    const nextJobs = jobRows.map(mapJobRow);
    const nextLogs = logRows.map(mapLogRow);

    setDataMode("supabase");
    setDataMessage(nextScrolls.length ? "Supabase 已连接，数据已同步。" : "Supabase 已连接，当前还没有画卷。");
    setScrolls(nextScrolls);
    setImages(nextImages);
    setJobs(nextJobs);
    setLogs(nextLogs);

    if (!nextScrolls.length) return;

    const currentScrollStillExists = keepSelection && nextScrolls.some((scroll) => scroll.id === selectedScrollId);
    const nextSelectedScrollId = currentScrollStillExists ? selectedScrollId : nextScrolls[0].id;
    setSelectedScrollId(nextSelectedScrollId);

    const currentImageStillExists = keepSelection && nextImages.some((image) => image.id === selectedImageId);
    if (!currentImageStillExists) {
      const firstImage = nextImages.find((image) => image.scrollId === nextSelectedScrollId);
      if (firstImage) setSelectedImageId(firstImage.id);
    }
  }

  useEffect(() => {
    setSystemStatus(deriveSystemStatus(scrolls, images, jobs, serviceStatus));
  }, [scrolls, images, jobs, serviceStatus]);

  useEffect(() => {
    const cached = readBootstrapCache();
    if (cached) {
      applyRemoteData(cached.scrolls, cached.images, cached.jobs, cached.logs, false);
      setDataMessage("已显示上次同步的数据，正在后台刷新 Supabase...");
    }
    void loadRemoteData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedScroll = scrolls.find((scroll) => scroll.id === selectedScrollId) ?? scrolls[0];
  const scrollImages = useMemo(
    () => (selectedScroll ? images.filter((image) => image.scrollId === selectedScroll.id).sort((a, b) => a.index - b.index) : []),
    [images, selectedScroll],
  );
  const selectedImage = scrollImages.find((image) => image.id === selectedImageId) ?? scrollImages[0];
  const scrollJobs = selectedScroll ? jobs.filter((job) => job.scrollId === selectedScroll.id).sort((a, b) => a.targetIndex - b.targetIndex) : [];
  const scrollLogs = selectedScroll ? logs.filter((log) => log.scrollId === selectedScroll.id) : [];

  async function addLog(message: string, detail: string, level: GenerationLog["level"] = "info", scrollId = selectedScroll?.id ?? "") {
    if (!scrollId) return;
    const log = localLog(scrollId, message, detail, level);
    setLogs((current) => [log, ...current]);
    if (dataMode === "supabase" && supabase) {
      const { error } = await supabase.from("generation_logs").insert({
        scroll_id: scrollId,
        level,
        message,
        detail,
      });
      if (error) console.warn("Failed to persist generation log", error.message);
    }
  }

  function selectScroll(scrollId: string) {
    setSelectedScrollId(scrollId);
    const firstImage = images.find((image) => image.scrollId === scrollId);
    if (firstImage) setSelectedImageId(firstImage.id);
  }

  async function toggleAutoGeneration() {
    if (!selectedScroll) return;
    const nextEnabled = !selectedScroll.autoGenerationEnabled;
    const previousScroll = selectedScroll;
    let updatedScroll: Scroll | undefined;

    if (dataMode === "supabase") {
      try {
        const response = await fetch("/api/scrolls/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scrollId: selectedScroll.id,
            autoGenerationEnabled: nextEnabled,
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        const payload = (await response.json()) as UpdateScrollApiResponse;
        if (payload.scroll) updatedScroll = mapScrollRow(payload.scroll);
      } catch (error) {
        setDataMessage(error instanceof Error ? `自动生成状态更新失败：${error.message}` : "自动生成状态更新失败。");
        return;
      }
    }

    setScrolls((current) =>
      current.map((scroll) =>
        scroll.id === previousScroll.id
          ? (updatedScroll ?? { ...scroll, autoGenerationEnabled: nextEnabled, status: nextEnabled ? "generating" : "paused" })
          : scroll,
      ),
    );
    await addLog(nextEnabled ? "自动生成已开启" : "自动生成已暂停", nextEnabled ? "画卷会继续进入定时队列" : "该画卷不会继续自动生成");
    await loadRemoteData();
  }

  async function createScroll(theme: string) {
    const cleanTheme = theme.trim();
    if (!cleanTheme) return;
    setDataMessage("正在创建画卷并优化提示词...");

    try {
      const response = await fetch("/api/scrolls/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: cleanTheme }),
      });
      if (response.ok) {
        const payload = (await response.json()) as CreateScrollApiResponse;
        await loadRemoteData(false);
        if (payload.scroll && typeof payload.scroll.id === "string") setSelectedScrollId(payload.scroll.id);
        return;
      }
    } catch {
      // Local Vite uses the API proxy only when npm run dev:api is running.
    }

    if (dataMode === "supabase" && supabase) {
      const now = new Date().toISOString();
      const nextRunAt = new Date(Date.now() + 300000).toISOString();
      const optimizedPrompt = `以「${cleanTheme}」为主题生成连续横向画卷，保持风格、光照、空间透视和左到右叙事连续。`;
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

      if (error) {
        setDataMessage(`创建失败：${error.message}`);
        return;
      }

      await supabase.from("generation_jobs").insert({
        scroll_id: data.id,
        target_index: 1,
        type: "auto_next",
        status: "queued",
        scheduled_for: nextRunAt,
        creative_plan: createCreativePlan({
          theme: cleanTheme,
          optimizedPrompt,
          targetIndex: 1,
          hasReferenceImage: false,
        }),
      });
      await addLog("画卷已创建", "第一张图片任务已进入队列", "success", data.id);
      await loadRemoteData(false);
      setSelectedScrollId(data.id);
      return;
    }

    const id = `scroll-${Date.now()}`;
    const newScroll: Scroll = {
      id,
      title: `${cleanTheme.slice(0, 12)}画卷`,
      status: "generating",
      originalTheme: cleanTheme,
      optimizedPrompt: `以「${cleanTheme}」为主题生成连续横向画卷，保持统一风格。`,
      createdAt: new Date().toISOString(),
      lastGeneratedAt: new Date().toISOString(),
      nextRunAt: new Date(Date.now() + 300000).toISOString(),
      intervalMinutes: 5,
      overlapPreset: FIXED_OVERLAP_PRESET,
      overlapRatio: FIXED_OVERLAP_RATIO,
      imageCount: 0,
      autoGenerationEnabled: true,
      thumbnail: "/assets/scroll-segment.svg",
    };
    setScrolls((current) => [newScroll, ...current]);
    setSelectedScrollId(id);
  }

  async function generateNextImageNow() {
    if (!selectedScroll) return;
    if (dataMode !== "supabase" || selectedScroll.id.startsWith("scroll-")) {
      setDataMessage("请先等待 Supabase 同步完成，并选择真实数据库中的画卷后再生成。");
      return;
    }
    setIsGenerating(true);
    const previousImageCount = scrollImages.length;
    setDataMessage("正在提交真实图片生成任务。");

    try {
      const response = await fetch(`/api/cron/generate?scrollId=${encodeURIComponent(selectedScroll.id)}&manual=1&background=1`, {
        method: "POST",
      });

      if (!response.ok) {
        const detail = await response.text();
        setDataMessage(`生成失败：${detail}`);
        return;
      }

      setDataMessage("生成任务已提交，后台会继续生成真实图片。页面会自动刷新，也可以手动点刷新。");
      void pollForGeneratedImage(previousImageCount);
    } catch (error) {
      setDataMessage(error instanceof Error ? `生成请求失败：${error.message}` : "生成请求失败。请确认 npm run dev:api 正在运行。");
    } finally {
      setIsGenerating(false);
    }
  }

  async function retryJob(jobId: string) {
    setDataMessage("正在重试失败任务...");
    try {
      const response = await fetch("/api/jobs/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!response.ok) throw new Error(await response.text());
      setDataMessage("失败任务已重新提交。");
      await loadRemoteData();
    } catch (error) {
      setDataMessage(error instanceof Error ? `重试失败：${error.message}` : "重试失败。");
    }
  }

  async function updateScrollInfo(input: { scrollId: string; title: string; originalTheme: string; optimizedPrompt: string }) {
    setDataMessage("正在保存画卷信息...");
    try {
      const response = await fetch("/api/scrolls/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await response.text());
      setDataMessage("画卷信息已保存。");
      await loadRemoteData();
    } catch (error) {
      setDataMessage(error instanceof Error ? `保存失败：${error.message}` : "保存失败。");
    }
  }

  async function deleteScroll(scrollId: string) {
    const scroll = scrolls.find((item) => item.id === scrollId);
    if (!scroll) return;
    const nextSelectedScrollId = chooseScrollAfterDeletion(scrolls, scrollId, selectedScrollId);

    if (dataMode === "supabase" && !scrollId.startsWith("scroll-")) {
      try {
        const response = await fetch("/api/scrolls/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scrollId }),
        });
        if (!response.ok) throw new Error(await response.text());
      } catch (error) {
        setDataMessage(error instanceof Error ? `删除画卷失败：${error.message}` : "删除画卷失败。");
        return;
      }
    }

    setScrolls((current) => current.filter((item) => item.id !== scrollId));
    setImages((current) => current.filter((item) => item.scrollId !== scrollId));
    setJobs((current) => current.filter((item) => item.scrollId !== scrollId));
    setLogs((current) => current.filter((item) => item.scrollId !== scrollId));
    setSelectedScrollId(nextSelectedScrollId);
    const nextImage = images.find((image) => image.scrollId === nextSelectedScrollId);
    setSelectedImageId(nextImage?.id ?? "");
    setDataMessage(nextSelectedScrollId ? `画卷「${scroll.title}」已删除。` : "画卷已删除，当前没有画卷。");

    if (dataMode === "supabase") await loadRemoteData(false);
  }

  async function pollForGeneratedImage(previousImageCount: number) {
    if (!selectedScroll) return;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const response = await fetch("/api/bootstrap/data");
      if (!response.ok) continue;
      const payload = (await response.json()) as BootstrapResponse;
      writeBootstrapCache(payload);
      applyRemoteData(payload.scrolls, payload.images, payload.jobs, payload.logs, true);
      const currentCount = payload.images.filter((image) => image.scroll_id === selectedScroll.id).length;
      if (currentCount > previousImageCount) {
        setDataMessage("真实图片已生成并同步。");
        return;
      }
    }
    setDataMessage("后台生成仍未返回新图，可能是图片网关排队或失败；请查看生成日志后重试。");
  }

  async function regenerateImage(imageId: string) {
    if (!selectedScroll) return;
    const image = images.find((item) => item.id === imageId);
    if (!image) return;
    const isImmediateRegeneration = shouldRegenerateImmediately(selectedScroll, image);
    try {
      const response = await fetch("/api/images/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });
      if (!response.ok) throw new Error(await response.text());
      setDataMessage(isImmediateRegeneration ? "图片已重生成，正在同步最新数据。" : "中间图片已标记为需要复查。");
      await loadRemoteData();
    } catch (error) {
      setDataMessage(error instanceof Error ? `重生成失败：${error.message}` : "重生成失败。");
    }
  }

  async function deleteImage(imageId: string) {
    if (!selectedScroll) return;
    const image = images.find((item) => item.id === imageId);
    if (!image) return;
    const plan = planImageDeletion(selectedScroll, image);

    if (dataMode === "supabase") {
      try {
        const response = await fetch("/api/images/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId }),
        });
        if (!response.ok) throw new Error(await response.text());
      } catch (error) {
        setDataMessage(error instanceof Error ? `删除失败：${error.message}` : "删除失败。");
        return;
      }
    } else {
      setImages((current) => current.filter((item) => item.id !== imageId));
    }

    if (dataMode !== "supabase") {
      await addLog(`第 ${image.index} 张已删除`, plan.logDetail, "warning", image.scrollId);
    }
    await loadRemoteData();
  }

  async function insertImage(anchorId: string, side: "before" | "after") {
    const anchor = images.find((item) => item.id === anchorId);
    if (!anchor) return;
    if (dataMode === "supabase") {
      try {
        const response = await fetch("/api/images/insert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId: anchorId, side }),
        });
        if (!response.ok) throw new Error(await response.text());
      } catch (error) {
        setDataMessage(error instanceof Error ? `插入请求失败：${error.message}` : "插入请求失败。");
        return;
      }
    } else {
      await markFollowingImagesForReview(anchor);
      await addLog(`已请求在第 ${anchor.index} 张${side === "before" ? "前" : "后"}插入`, "插入会影响后续衔接，当前先标记为需要复查。", "warning", anchor.scrollId);
    }
    await loadRemoteData();
  }

  async function markFollowingImagesForReview(image: ScrollImage) {
    if (dataMode === "supabase" && supabase) {
      await supabase
        .from("scroll_images")
        .update({ status: "needs_review", has_stitch_warning: true })
        .eq("scroll_id", image.scrollId)
        .gt("image_index", image.index);
      await supabase.from("scrolls").update({ status: "paused", auto_generation_enabled: false }).eq("id", image.scrollId);
    } else {
      setImages((current) =>
        current.map((item) =>
          item.scrollId === image.scrollId && item.index > image.index ? { ...item, status: "needs_review", hasStitchWarning: true } : item,
        ),
      );
    }
  }

  return {
    scrolls,
    images: scrollImages,
    allImages: images,
    jobs: scrollJobs,
    allJobs: jobs,
    logs: scrollLogs,
    allLogs: logs,
    systemStatus,
    selectedScroll,
    selectedImage,
    selectedImageId,
    dataMode,
    dataMessage,
    isGenerating,
    setSelectedImageId,
    selectScroll,
    regenerateImage,
    deleteImage,
    insertImage,
    toggleAutoGeneration,
    createScroll,
    deleteScroll,
    generateNextImageNow,
    retryJob,
    updateScrollInfo,
    setSystemStatus,
    refresh: loadRemoteData,
  };
}

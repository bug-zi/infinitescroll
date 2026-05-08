import type { GenerationJob, Scroll, ScrollImage, SystemStatus } from "../types";

type ServiceStatusInput = {
  serviceRunning?: boolean;
  maxConcurrentJobs?: number;
  statusError?: string | null;
};

const STATUS_TIME_ZONE = "Asia/Shanghai";

export function getStatusDateKey(value: string | Date, timeZone = STATUS_TIME_ZONE) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getNextRunLabel(nextRunAt: string | undefined, now = new Date()) {
  if (!nextRunAt) return "无开启画卷";
  const target = new Date(nextRunAt).getTime();
  if (!Number.isFinite(target)) return "时间异常";

  const seconds = Math.ceil((target - now.getTime()) / 1000);
  if (seconds <= 0) return "待触发";
  if (seconds < 60) return `${seconds} 秒后`;

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes} 分 ${restSeconds} 秒后` : `${minutes} 分后`;

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: STATUS_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(target));
}

export function deriveSystemStatus(
  scrolls: Scroll[],
  images: ScrollImage[],
  jobs: GenerationJob[],
  service: ServiceStatusInput = {},
  now = new Date(),
): SystemStatus {
  const activeScrolls = scrolls.filter((scroll) => scroll.autoGenerationEnabled);
  const nextScroll = activeScrolls
    .filter((scroll) => Number.isFinite(new Date(scroll.nextRunAt).getTime()))
    .slice()
    .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())[0];
  const runningJobs = jobs.filter((job) => job.status === "running");
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const today = getStatusDateKey(now);
  const generatedToday = images.filter((image) => getStatusDateKey(image.generatedAt) === today).length;
  const statusError = service.statusError ?? null;

  return {
    cronRunning: Boolean(service.serviceRunning),
    serviceRunning: Boolean(service.serviceRunning),
    autoGenerationEnabled: activeScrolls.length > 0,
    nextGlobalRunLabel: getNextRunLabel(nextScroll?.nextRunAt, now),
    generatedToday,
    totalGenerated: images.length,
    apiHealthPercent: statusError ? 0 : failedJobs.length ? Math.max(20, 100 - failedJobs.length * 15) : 100,
    activeConcurrentJobs: runningJobs.length,
    maxConcurrentJobs: Number.isFinite(service.maxConcurrentJobs) ? Number(service.maxConcurrentJobs) : 2,
    failedJobs: failedJobs.length,
    activeScrolls: activeScrolls.length,
    statusError,
  };
}

const STATUS_TIME_ZONE = "Asia/Shanghai";

type Row = Record<string, any>;

type BuildStatusInput = {
  scrolls: Row[];
  images: Row[];
  jobs: Row[];
  now?: Date;
  maxConcurrentJobs?: number;
  statusError?: string | null;
  externalSchedulerGraceMinutes?: number;
};

export function buildSystemStatusFromRows(input: BuildStatusInput) {
  const now = input.now ?? new Date();
  const activeScrolls = input.scrolls.filter((scroll) => Boolean(scroll.auto_generation_enabled));
  const nextScroll = activeScrolls
    .filter((scroll) => Number.isFinite(Date.parse(String(scroll.next_run_at ?? ""))))
    .slice()
    .sort((left, right) => Date.parse(String(left.next_run_at)) - Date.parse(String(right.next_run_at)))[0];
  const runningJobs = input.jobs.filter((job) => job.status === "running");
  const failedJobs = input.jobs.filter((job) => job.status === "failed");
  const generatedToday = input.images.filter((image) => getStatusDateKey(String(image.generated_at ?? ""), STATUS_TIME_ZONE) === getStatusDateKey(now, STATUS_TIME_ZONE)).length;
  const overdue = nextScroll ? now.getTime() - Date.parse(String(nextScroll.next_run_at)) : 0;
  const graceMs = (input.externalSchedulerGraceMinutes ?? 7) * 60000;
  const schedulerLooksStopped = activeScrolls.length > 0 && runningJobs.length === 0 && overdue > graceMs;
  const statusError =
    input.statusError ??
    (schedulerLooksStopped ? "外部调度器可能未按 5 分钟触发 /api/cron/generate，请检查 cron-job.org 或同等调度服务。" : null);

  return {
    cronRunning: !schedulerLooksStopped,
    serviceRunning: !schedulerLooksStopped,
    autoGenerationEnabled: activeScrolls.length > 0,
    nextGlobalRunAt: nextScroll?.next_run_at ?? null,
    nextGlobalRunLabel: getNextRunLabel(nextScroll?.next_run_at, now),
    generatedToday,
    totalGenerated: input.images.length,
    apiHealthPercent: statusError ? 0 : failedJobs.length ? Math.max(20, 100 - failedJobs.length * 15) : 100,
    activeConcurrentJobs: runningJobs.length,
    maxConcurrentJobs: Number.isFinite(input.maxConcurrentJobs) ? Number(input.maxConcurrentJobs) : 2,
    failedJobs: failedJobs.length,
    activeScrolls: activeScrolls.length,
    statusError,
  };
}

function getStatusDateKey(value: string | Date, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getNextRunLabel(nextRunAt: string | undefined, now: Date) {
  if (!nextRunAt) return "无开启画卷";
  const target = Date.parse(nextRunAt);
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

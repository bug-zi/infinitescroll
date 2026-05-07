import type { GenerationJob, Scroll } from "../types";

export function formatClock(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatDateMinute(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function getCountdownParts(targetIso: string, now = new Date()) {
  const rawDelta = new Date(targetIso).getTime() - now.getTime();
  const delta = Math.max(0, rawDelta);
  const minutes = Math.floor(delta / 60000);
  const seconds = Math.floor((delta % 60000) / 1000);
  return {
    minutes,
    seconds,
    isDue: rawDelta <= 0,
    label: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
  };
}

export type CountdownTone = "counting" | "due" | "active" | "failed" | "done" | "neutral";

export function getGenerationCountdownLabel(job: GenerationJob, now = new Date()): { text: string; tone: CountdownTone } {
  if (job.status === "running") return { text: "生成中", tone: "active" };
  if (job.status === "failed") return { text: "失败", tone: "failed" };
  if (job.status === "succeeded") return { text: "已完成", tone: "done" };
  if (job.status === "cancelled") return { text: "已取消", tone: "neutral" };

  const countdown = getCountdownParts(job.scheduledFor, now);
  if (countdown.isDue) return { text: "待触发", tone: "due" };
  return { text: countdown.label, tone: "counting" };
}

export type GenerationPlanItem = {
  id: string;
  targetIndex: number;
  scheduledFor: string;
  label: { text: string; tone: CountdownTone };
  source: "job" | "scroll";
};

export function getGenerationPlanItems(jobs: GenerationJob[], scroll: Scroll | undefined, now = new Date()): GenerationPlanItem[] {
  if (jobs.length) {
    return jobs.slice(0, 5).map((job) => ({
      id: job.id,
      targetIndex: job.targetIndex,
      scheduledFor: job.scheduledFor,
      label: getGenerationCountdownLabel(job, now),
      source: "job",
    }));
  }

  if (!scroll?.autoGenerationEnabled) return [];

  const countdown = getCountdownParts(scroll.nextRunAt, now);
  return [
    {
      id: `${scroll.id}-next-run`,
      targetIndex: scroll.imageCount + 1,
      scheduledFor: scroll.nextRunAt,
      label: countdown.isDue ? { text: "待触发", tone: "due" } : { text: countdown.label, tone: "counting" },
      source: "scroll",
    },
  ];
}

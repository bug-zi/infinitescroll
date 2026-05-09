import type { GenerationJob, GenerationLog, Scroll, SystemStatus } from "../types";

export type UserProfile = {
  displayName: string;
  email: string;
  role: string;
  avatarUrl: string;
  notifications: {
    generationSuccess: boolean;
    generationFailure: boolean;
    queueReminder: boolean;
  };
};

export type NotificationItem = {
  id: string;
  level: "success" | "info" | "warning" | "error";
  title: string;
  detail: string;
  createdAt: string;
  action: "logs" | "console" | "workspace";
};

export const defaultUserProfile: UserProfile = {
  displayName: "Yuer",
  email: "yuer@example.com",
  role: "创作者",
  avatarUrl: "",
  notifications: {
    generationSuccess: true,
    generationFailure: true,
    queueReminder: true,
  },
};

export function normalizeUserProfile(value: unknown): UserProfile {
  if (!value || typeof value !== "object") return defaultUserProfile;
  const record = value as Partial<UserProfile>;
  const notifications =
    record.notifications && typeof record.notifications === "object"
      ? (record.notifications as Partial<UserProfile["notifications"]>)
      : {};

  return {
    displayName: cleanString(record.displayName, defaultUserProfile.displayName),
    email: cleanString(record.email, defaultUserProfile.email),
    role: cleanString(record.role, defaultUserProfile.role),
    avatarUrl: optionalString(record.avatarUrl),
    notifications: {
      generationSuccess: booleanValue(notifications.generationSuccess, defaultUserProfile.notifications.generationSuccess),
      generationFailure: booleanValue(notifications.generationFailure, defaultUserProfile.notifications.generationFailure),
      queueReminder: booleanValue(notifications.queueReminder, defaultUserProfile.notifications.queueReminder),
    },
  };
}

export function buildNotifications(input: {
  logs: GenerationLog[];
  jobs: GenerationJob[];
  selectedScroll?: Scroll;
  systemStatus: SystemStatus;
  preferences: UserProfile["notifications"];
  now?: Date;
}): NotificationItem[] {
  const items: NotificationItem[] = [];
  const recentLogs = [...input.logs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 8);

  for (const log of recentLogs) {
    if (log.level === "error" && !input.preferences.generationFailure) continue;
    if (log.level === "success" && !input.preferences.generationSuccess) continue;
    if (log.level !== "error" && log.level !== "success" && log.level !== "warning") continue;
    items.push({
      id: `log-${log.id}`,
      level: log.level,
      title: log.message,
      detail: log.detail || "暂无详情",
      createdAt: log.createdAt,
      action: "logs",
    });
  }

  if (input.preferences.queueReminder && input.selectedScroll?.autoGenerationEnabled) {
    const nextJob = input.jobs
      .filter((job) => job.scrollId === input.selectedScroll?.id && job.status === "queued")
      .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor))[0];
    if (nextJob) {
      items.unshift({
        id: `job-${nextJob.id}`,
        level: "info",
        title: `第 ${nextJob.targetIndex} 张等待触发`,
        detail: `${input.selectedScroll.title} 已排入自动生成队列。`,
        createdAt: nextJob.scheduledFor,
        action: "console",
      });
    }
  }

  if (input.systemStatus.failedJobs > 0) {
    items.unshift({
      id: "system-failed-jobs",
      level: "warning",
      title: `有 ${input.systemStatus.failedJobs} 个失败任务`,
      detail: "建议进入控制台查看失败原因并重试。",
      createdAt: input.now?.toISOString() ?? new Date().toISOString(),
      action: "console",
    });
  }

  return dedupeNotifications(items)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 8);
}

function dedupeNotifications(items: NotificationItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function cleanString(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

import type { GenerationLog, Scroll } from "../types";

export const DEFAULT_LOG_PREVIEW_LIMIT = 10;

export type ScrollLogGroup = {
  scrollId: string;
  title: string;
  scroll?: Scroll;
  logs: GenerationLog[];
};

export function getRecentLogs(logs: GenerationLog[], limit = DEFAULT_LOG_PREVIEW_LIMIT) {
  return logs.slice(0, Math.max(0, limit));
}

export function groupLogsByScroll(logs: GenerationLog[], scrolls: Scroll[]): ScrollLogGroup[] {
  const scrollById = new Map(scrolls.map((scroll) => [scroll.id, scroll]));
  const groupByScrollId = new Map<string, ScrollLogGroup>();

  for (const log of logs) {
    const scrollId = log.scrollId || "unknown";
    const scroll = scrollById.get(scrollId);
    const existingGroup = groupByScrollId.get(scrollId);

    if (existingGroup) {
      existingGroup.logs.push(log);
      continue;
    }

    groupByScrollId.set(scrollId, {
      scrollId,
      scroll,
      title: scroll?.title ?? "未关联画卷",
      logs: [log],
    });
  }

  return Array.from(groupByScrollId.values()).sort((left, right) => {
    const leftTime = Date.parse(left.logs[0]?.createdAt ?? "");
    const rightTime = Date.parse(right.logs[0]?.createdAt ?? "");
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}

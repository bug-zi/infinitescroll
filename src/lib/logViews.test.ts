import { describe, expect, it } from "vitest";
import { DEFAULT_LOG_PREVIEW_LIMIT, getRecentLogs, groupLogsByScroll } from "./logViews";
import type { GenerationLog, Scroll } from "../types";

function makeLog(id: string, scrollId: string, createdAt: string): GenerationLog {
  return {
    id,
    scrollId,
    level: "info",
    message: `message-${id}`,
    detail: `detail-${id}`,
    createdAt,
  };
}

function makeScroll(id: string, title: string): Scroll {
  return {
    id,
    title,
    status: "generating",
    originalTheme: title,
    optimizedPrompt: title,
    createdAt: "2026-05-08T00:00:00.000Z",
    lastGeneratedAt: "2026-05-08T00:00:00.000Z",
    nextRunAt: "2026-05-08T01:00:00.000Z",
    intervalMinutes: 60,
    overlapPreset: "strong",
    overlapRatio: 0.36,
    imageCount: 0,
    autoGenerationEnabled: true,
    thumbnail: "",
  };
}

describe("log view helpers", () => {
  it("keeps only the latest ten logs for the workspace preview", () => {
    const logs = Array.from({ length: 12 }, (_, index) =>
      makeLog(`log-${index + 1}`, "scroll-a", `2026-05-08T00:${String(59 - index).padStart(2, "0")}:00.000Z`),
    );

    const recent = getRecentLogs(logs);

    expect(recent).toHaveLength(DEFAULT_LOG_PREVIEW_LIMIT);
    expect(recent.map((log) => log.id)).toEqual(logs.slice(0, 10).map((log) => log.id));
  });

  it("groups full logs by scroll and sorts groups by each scroll's newest log", () => {
    const logs = [
      makeLog("latest-b", "scroll-b", "2026-05-08T03:00:00.000Z"),
      makeLog("latest-a", "scroll-a", "2026-05-08T02:00:00.000Z"),
      makeLog("older-b", "scroll-b", "2026-05-08T01:00:00.000Z"),
      makeLog("orphan", "missing-scroll", "2026-05-08T00:30:00.000Z"),
    ];
    const scrolls = [makeScroll("scroll-a", "A 画卷"), makeScroll("scroll-b", "B 画卷")];

    const groups = groupLogsByScroll(logs, scrolls);

    expect(groups.map((group) => group.title)).toEqual(["B 画卷", "A 画卷", "未关联画卷"]);
    expect(groups[0].logs.map((log) => log.id)).toEqual(["latest-b", "older-b"]);
    expect(groups[2].scrollId).toBe("missing-scroll");
  });
});

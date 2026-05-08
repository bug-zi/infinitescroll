import { describe, expect, test } from "vitest";
import { deriveSystemStatus, getNextRunLabel, getStatusDateKey } from "./systemStatus";
import type { GenerationJob, Scroll, ScrollImage } from "../types";

function scroll(overrides: Partial<Scroll> = {}): Scroll {
  return {
    id: "scroll-1",
    title: "测试画卷",
    status: "generating",
    originalTheme: "清明上河图",
    optimizedPrompt: "长卷",
    createdAt: "2026-05-07T12:00:00.000Z",
    lastGeneratedAt: "2026-05-07T12:00:00.000Z",
    nextRunAt: "2026-05-07T15:05:30.000Z",
    intervalMinutes: 5,
    overlapPreset: "maximum",
    overlapRatio: 0.25,
    imageCount: 2,
    autoGenerationEnabled: true,
    thumbnail: "/image.png",
    ...overrides,
  };
}

function image(id: string, generatedAt: string): ScrollImage {
  return {
    id,
    scrollId: "scroll-1",
    index: 1,
    title: "图片",
    src: "/image.png",
    generatedAt,
    prompt: "",
    model: "",
    status: "succeeded",
    fileSize: "1 MB",
    dimensions: { width: 1536, height: 1152, ratioLabel: "4:3" },
    visibleCrop: { x: 0, y: 0, width: 1536, height: 1152 },
    overlapCrop: { x: 0, y: 0, width: 384, height: 1152 },
    newContentCrop: { x: 384, y: 0, width: 1152, height: 1152 },
  };
}

function job(id: string, status: GenerationJob["status"]): GenerationJob {
  return {
    id,
    scrollId: "scroll-1",
    targetIndex: 3,
    type: "auto_next",
    status,
    scheduledFor: "2026-05-07T15:05:30.000Z",
  };
}

describe("system status derivation", () => {
  test("uses Shanghai calendar days for today's generated count", () => {
    expect(getStatusDateKey("2026-05-07T16:30:00.000Z")).toBe("2026-05-08");
  });

  test("derives displayed status from currently loaded scroll data", () => {
    const status = deriveSystemStatus(
      [scroll()],
      [image("today", "2026-05-07T16:30:00.000Z"), image("yesterday", "2026-05-06T16:00:00.000Z")],
      [job("running", "running"), job("failed", "failed")],
      { serviceRunning: true, maxConcurrentJobs: 3 },
      new Date("2026-05-08T00:00:00+08:00"),
    );

    expect(status).toMatchObject({
      cronRunning: true,
      serviceRunning: true,
      autoGenerationEnabled: true,
      generatedToday: 1,
      totalGenerated: 2,
      activeConcurrentJobs: 1,
      maxConcurrentJobs: 3,
      failedJobs: 1,
      activeScrolls: 1,
      apiHealthPercent: 85,
    });
  });

  test("separates scheduler service state from whether any scroll is enabled", () => {
    const status = deriveSystemStatus([scroll({ autoGenerationEnabled: false })], [], [], { serviceRunning: true }, new Date());

    expect(status.serviceRunning).toBe(true);
    expect(status.autoGenerationEnabled).toBe(false);
    expect(status.nextGlobalRunLabel).toBe("无开启画卷");
  });

  test("formats due and future next run labels", () => {
    expect(getNextRunLabel("2026-05-07T12:00:00.000Z", new Date("2026-05-07T12:00:01.000Z"))).toBe("待触发");
    expect(getNextRunLabel("2026-05-07T12:01:05.000Z", new Date("2026-05-07T12:00:00.000Z"))).toBe("1 分 5 秒后");
  });
});

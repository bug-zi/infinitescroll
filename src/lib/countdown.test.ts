import { describe, expect, test } from "vitest";
import { getCountdownParts, getGenerationCountdownLabel, getGenerationPlanItems } from "./time";
import type { GenerationJob, Scroll } from "../types";

function job(status: GenerationJob["status"], scheduledFor: string): GenerationJob {
  return {
    id: `job-${status}`,
    scrollId: "scroll-1",
    targetIndex: 13,
    type: "auto_next",
    status,
    scheduledFor,
  };
}

function scroll(overrides: Partial<Scroll> = {}): Scroll {
  return {
    id: "scroll-1",
    title: "测试画卷",
    status: "generating",
    originalTheme: "测试",
    optimizedPrompt: "测试",
    createdAt: "2026-05-07T12:00:00.000Z",
    lastGeneratedAt: "2026-05-07T12:00:00.000Z",
    nextRunAt: "2026-05-07T12:04:04.000Z",
    intervalMinutes: 5,
    overlapPreset: "maximum",
    overlapRatio: 0.25,
    imageCount: 12,
    autoGenerationEnabled: true,
    thumbnail: "/segment.svg",
    ...overrides,
  };
}

describe("countdown helpers", () => {
  test("formats remaining time as mm:ss", () => {
    const parts = getCountdownParts("2026-05-07T12:05:09.000Z", new Date("2026-05-07T12:03:04.000Z"));

    expect(parts.label).toBe("02:05");
    expect(parts.isDue).toBe(false);
  });

  test("marks a past target as due", () => {
    const parts = getCountdownParts("2026-05-07T12:03:00.000Z", new Date("2026-05-07T12:03:04.000Z"));

    expect(parts.label).toBe("00:00");
    expect(parts.isDue).toBe(true);
  });

  test("labels queued jobs by their scheduled time", () => {
    const label = getGenerationCountdownLabel(job("queued", "2026-05-07T12:04:04.000Z"), new Date("2026-05-07T12:03:04.000Z"));

    expect(label).toEqual({ text: "01:00", tone: "counting" });
  });

  test("labels due queued and running jobs with state text", () => {
    const now = new Date("2026-05-07T12:03:04.000Z");

    expect(getGenerationCountdownLabel(job("queued", "2026-05-07T12:03:00.000Z"), now)).toEqual({ text: "待触发", tone: "due" });
    expect(getGenerationCountdownLabel(job("running", "2026-05-07T12:03:00.000Z"), now)).toEqual({ text: "生成中", tone: "active" });
  });

  test("falls back to the scroll next run when no jobs exist", () => {
    const items = getGenerationPlanItems([], scroll(), new Date("2026-05-07T12:03:04.000Z"));

    expect(items).toEqual([
      {
        id: "scroll-1-next-run",
        targetIndex: 13,
        scheduledFor: "2026-05-07T12:04:04.000Z",
        label: { text: "01:00", tone: "counting" },
        source: "scroll",
      },
    ]);
  });
});

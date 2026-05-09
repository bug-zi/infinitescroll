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

    expect(items[0]).toMatchObject({
      id: "scroll-1-next-run",
      targetIndex: 13,
      scheduledFor: "2026-05-07T12:04:04.000Z",
      label: { text: "01:00", tone: "counting" },
      source: "scroll",
      creativePlan: {
        title: "第 13 张：测试主题空间延展",
        continuityAnchor: "锁定上一张右缘的道路、水线、建筑高度、地平线、光照方向和人群行进方向。",
      },
    });
  });

  test("uses the persisted job creative plan instead of inventing a different visible plan", () => {
    const items = getGenerationPlanItems(
      [
        {
          ...job("queued", "2026-05-07T12:04:04.000Z"),
          creativePlan: {
            title: "第 13 张：桥头税关",
            continuityAnchor: "承接上一张右侧桥头栏杆。",
            newScene: "展开税关、货担与排队商旅。",
            composition: "桥头在左，税关在中，街巷向右延伸。",
            forbidden: "不得换成山水空景。",
            promptFragment: "严格按桥头税关计划生成。",
          },
        },
      ],
      scroll(),
      new Date("2026-05-07T12:03:04.000Z"),
    );

    expect(items[0].creativePlan.title).toBe("第 13 张：桥头税关");
    expect(items[0].creativePlan.promptFragment).toBe("严格按桥头税关计划生成。");
  });

  test("hides failed job history from the visible generation plan", () => {
    const items = getGenerationPlanItems(
      [
        { ...job("failed", "2026-05-07T12:01:00.000Z"), id: "failed-1", errorMessage: "gateway failed" },
        { ...job("failed", "2026-05-07T12:02:00.000Z"), id: "failed-2", errorMessage: "timeout" },
        { ...job("queued", "2026-05-07T12:04:04.000Z"), id: "queued-1" },
      ],
      scroll(),
      new Date("2026-05-07T12:03:04.000Z"),
    );

    expect(items.map((item) => item.id)).toEqual(["queued-1"]);
  });

  test("still shows a creative plan for a paused scroll without queued jobs", () => {
    const items = getGenerationPlanItems(
      [],
      scroll({ autoGenerationEnabled: false, status: "paused" }),
      new Date("2026-05-07T12:03:04.000Z"),
    );

    expect(items[0]).toMatchObject({
      id: "scroll-1-next-run",
      targetIndex: 13,
      label: { text: "已暂停", tone: "neutral" },
      creativePlan: {
        title: "第 13 张：测试主题空间延展",
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import { mapImageRow, mapJobRow, mapLogRow, mapScrollRow } from "./supabaseMappers";

describe("mapScrollRow", () => {
  it("maps archive timestamps for archived scrolls", () => {
    const scroll = mapScrollRow({
      id: "scroll-1",
      title: "Archived",
      status: "paused",
      original_theme: "theme",
      optimized_prompt: "prompt",
      created_at: "2026-05-01T00:00:00.000Z",
      last_generated_at: "2026-05-02T00:00:00.000Z",
      next_run_at: "2026-05-03T00:00:00.000Z",
      interval_minutes: 10,
      overlap_preset: "standard",
      overlap_ratio: 0.25,
      image_count: 3,
      auto_generation_enabled: false,
      thumbnail_url: "/thumb.png",
      archived_at: "2026-05-08T00:00:00.000Z",
      purge_after: "2026-05-15T00:00:00.000Z",
    });

    expect(scroll.archivedAt).toBe("2026-05-08T00:00:00.000Z");
    expect(scroll.purgeAfter).toBe("2026-05-15T00:00:00.000Z");
  });

  it("maps story generation metadata with free defaults", () => {
    const storyScroll = mapScrollRow({
      id: "scroll-2",
      title: "西游记画卷",
      status: "paused",
      original_theme: "西游记连环画",
      optimized_prompt: "",
      created_at: "2026-05-01T00:00:00.000Z",
      next_run_at: "2026-05-03T00:00:00.000Z",
      interval_minutes: 5,
      overlap_preset: "maximum",
      overlap_ratio: 0.25,
      image_count: 0,
      auto_generation_enabled: false,
      generation_mode: "story",
      story_template: "journey_to_west",
      story_template_version: "v1",
      story_total_frames: 128,
    });
    const freeScroll = mapScrollRow({
      id: "scroll-3",
      title: "普通画卷",
      status: "paused",
      original_theme: "山海经",
      optimized_prompt: "",
      created_at: "2026-05-01T00:00:00.000Z",
      next_run_at: "2026-05-03T00:00:00.000Z",
      interval_minutes: 5,
      overlap_preset: "maximum",
      overlap_ratio: 0.25,
      image_count: 0,
      auto_generation_enabled: false,
    });

    expect(storyScroll.generationMode).toBe("story");
    expect(storyScroll.storyTemplate).toBe("journey_to_west");
    expect(storyScroll.storyTotalFrames).toBe(128);
    expect(freeScroll.generationMode).toBe("free");
    expect(freeScroll.storyTemplate).toBeNull();
  });
});

describe("mapLogRow", () => {
  it("replaces question-mark mojibake logs with readable fallback text", () => {
    const log = mapLogRow({
      id: "log-1",
      scroll_id: "scroll-1",
      level: "info",
      message: "???????",
      detail: "??? 1-3 ?????????????",
      created_at: "2026-05-07T07:46:22.497009+00:00",
    });

    expect(log.message).toBe("日志内容编码异常");
    expect(log.detail).toBe("原始日志包含不可恢复的问号乱码，请查看相邻日志或重新触发操作。");
  });
});

describe("mapImageRow", () => {
  it("normalizes legacy generated canvas ratios to the visible 4:3 image ratio", () => {
    const image = mapImageRow({
      id: "image-1",
      scroll_id: "scroll-1",
      image_index: 2,
      full_image_url: "https://example.com/image.png",
      generated_at: "2026-05-07T07:46:22.497009+00:00",
      prompt: "prompt",
      model: "GPT Image",
      status: "succeeded",
      file_size_bytes: 1234,
      width: 1152,
      height: 768,
      ratio_label: "4.5:3",
      visible_crop: { x: 230, y: 0, width: 922, height: 768 },
      overlap_crop: { x: 0, y: 0, width: 230, height: 768 },
      new_content_crop: { x: 230, y: 0, width: 922, height: 768 },
      has_stitch_warning: false,
    });

    expect(image.dimensions.ratioLabel).toBe("4:3");
  });
});

describe("mapJobRow", () => {
  it("maps persisted creative plan JSON for visible and generation use", () => {
    const job = mapJobRow({
      id: "job-1",
      scroll_id: "scroll-1",
      target_index: 13,
      type: "auto_next",
      status: "queued",
      scheduled_for: "2026-05-07T12:04:04.000Z",
      creative_plan: {
        mode: "story",
        storyFrameIndex: 13,
        storyTotalFrames: 128,
        chapter: "大闹天宫",
        title: "第 13 张：桥头税关",
        continuityAnchor: "承接上一张右侧桥头栏杆。",
        newScene: "展开税关、货担与排队商旅。",
        composition: "桥头在左，税关在中，街巷向右延伸。",
        forbidden: "不得换成山水空景。",
        characters: ["孙悟空"],
        location: "南天门",
        mood: "紧张",
        promptFragment: "严格按桥头税关计划生成。",
      },
    });

    expect(job.creativePlan).toMatchObject({
      title: "第 13 张：桥头税关",
      mode: "story",
      storyFrameIndex: 13,
      storyTotalFrames: 128,
      characters: ["孙悟空"],
      location: "南天门",
      promptFragment: "严格按桥头税关计划生成。",
    });
  });
});

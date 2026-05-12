import { describe, expect, it } from "vitest";
import {
  DREAM_OF_RED_MANSIONS_TOTAL_FRAMES,
  buildHonglouScrollPayload,
} from "./create-honglou-scroll.mjs";

describe("buildHonglouScrollPayload", () => {
  it("builds a paused ai_script Honglou scroll with 128 frames", () => {
    const payload = buildHonglouScrollPayload(new Date("2026-05-10T00:00:00.000Z"));

    expect(payload.scroll).toMatchObject({
      title: "红楼梦国风漫画画卷",
      original_theme: "红楼梦",
      generation_mode: "story",
      story_template: "ai_script",
      story_template_version: "v1",
      story_total_frames: 128,
      status: "paused",
      auto_generation_enabled: false,
      image_count: 0,
    });
    expect(payload.frames).toHaveLength(DREAM_OF_RED_MANSIONS_TOTAL_FRAMES);
    expect(payload.frames[0]).toMatchObject({
      frameIndex: 1,
      chapter: "仙缘与甄士隐",
      forbidden: expect.stringContaining("不得水墨化"),
      visualPromptHint: expect.stringContaining("国风漫画彩色分镜"),
    });
  });
});

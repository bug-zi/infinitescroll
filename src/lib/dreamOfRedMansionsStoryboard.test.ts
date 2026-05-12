import { describe, expect, it } from "vitest";
import { DREAM_OF_RED_MANSIONS_STORYBOARD, DREAM_OF_RED_MANSIONS_TOTAL_FRAMES } from "./dreamOfRedMansionsStoryboard";

describe("DREAM_OF_RED_MANSIONS_STORYBOARD", () => {
  it("contains exactly 128 continuous frames across the planned chapters", () => {
    expect(DREAM_OF_RED_MANSIONS_TOTAL_FRAMES).toBe(128);
    expect(DREAM_OF_RED_MANSIONS_STORYBOARD).toHaveLength(128);
    expect(DREAM_OF_RED_MANSIONS_STORYBOARD.map((frame) => frame.frameIndex)).toEqual(Array.from({ length: 128 }, (_, index) => index + 1));
    expect(new Set(DREAM_OF_RED_MANSIONS_STORYBOARD.map((frame) => frame.chapter)).size).toBe(16);
  });

  it("locks every frame to the current non-ink Chinese comic style", () => {
    const forbiddenPattern = /水墨|水墨画卷|墨色渲染|宣纸晕染|留白山水|工笔重彩|清明上河图式市井空景/;

    for (const frame of DREAM_OF_RED_MANSIONS_STORYBOARD) {
      expect(frame.forbidden).toContain("不得水墨化");
      expect(frame.forbidden).toContain("不得工笔重彩化");
      expect(frame.forbidden).toContain("不得提前画后续剧情");
      expect(frame.visualPromptHint).toContain("国风漫画");
      expect(frame.visualPromptHint).toContain("彩色分镜");
      expect(`${frame.title}\n${frame.scene}\n${frame.chapter}`).not.toMatch(forbiddenPattern);
    }
  });
});

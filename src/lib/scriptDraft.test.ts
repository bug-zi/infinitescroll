import { describe, expect, it } from "vitest";
import { buildAiScriptCreativePlan, normalizeScriptDraft, validateScriptFrameCount } from "./scriptDraft";

describe("script draft", () => {
  it("normalizes a DeepSeek script draft into editable storyboard frames", () => {
    const draft = normalizeScriptDraft(
      {
        title: "星海邮差",
        summary: "少年沿星际驿路递送最后一封信。",
        visualStyle: "复古科幻连环画，暖金与群青对比。",
        characterBible: "阿澈：红围巾少年；灯塔鸟：铜质机械鸟。",
        frames: [
          {
            frameIndex: 1,
            chapter: "启程",
            title: "收到星信",
            scene: "阿澈在海边邮局收到发光信件。",
            characters: ["阿澈", "灯塔鸟"],
            location: "海边邮局",
            mood: "神秘",
            continuityAnchor: "海风和星轨向右延展。",
            forbidden: "不得出现现代手机。",
            visualPromptHint: "邮局木纹与星光反射。",
          },
          {
            chapter: "启程",
            title: "穿过潮汐门",
            scene: "潮汐化为星门，阿澈踏上银色桥面。",
          },
        ],
      },
      { frameCount: 2, theme: "星海邮差" },
    );

    expect(draft.frames).toHaveLength(2);
    expect(draft.frames[0]).toMatchObject({
      frameIndex: 1,
      title: "收到星信",
      characters: ["阿澈", "灯塔鸟"],
      visualPromptHint: "邮局木纹与星光反射。",
    });
    expect(draft.frames[1]).toMatchObject({
      frameIndex: 2,
      title: "穿过潮汐门",
      characters: [],
      forbidden: "只画当前剧情帧，不得提前画后续剧情，不得跳过剧情，不得改编成无关场景。",
    });
  });

  it("rejects drafts whose frame count does not match the selected length", () => {
    expect(() => validateScriptFrameCount([{ frameIndex: 1 }], 2)).toThrow("Expected 2 script frames");
  });

  it("builds an ai_script creative plan from a persisted frame", () => {
    const plan = buildAiScriptCreativePlan({
      frame: {
        frameIndex: 3,
        chapter: "启程",
        title: "星桥初现",
        scene: "银色星桥从海面升起。",
        characters: ["阿澈"],
        location: "星海岸",
        mood: "惊奇",
        continuityAnchor: "用星轨和潮汐泡沫衔接上一帧。",
        forbidden: "不得画成城市夜景。",
        visualPromptHint: "银蓝色桥面，复古纸张纹理。",
      },
      totalFrames: 48,
      previousSummary: "上一帧：穿过潮汐门。",
    });

    expect(plan.mode).toBe("story");
    expect(plan.storyTemplate).toBe("ai_script");
    expect(plan.storyFrameIndex).toBe(3);
    expect(plan.storyTotalFrames).toBe(48);
    expect(plan.title).toContain("星桥初现");
    expect(plan.promptFragment).toContain("当前剧情帧：星桥初现");
    expect(plan.promptFragment).toContain("上一帧内容线索：上一帧：穿过潮汐门。");
  });
});

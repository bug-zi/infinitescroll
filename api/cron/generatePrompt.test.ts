import { describe, expect, it } from "vitest";
import { buildImagePrompt } from "./generate";
import { AI_SCRIPT_TEMPLATE, AI_SCRIPT_TEMPLATE_VERSION, type ScriptFrame, buildAiScriptCreativePlan } from "../../src/lib/scriptDraft";

describe("buildImagePrompt", () => {
  it("uses a generic ai_script story prompt instead of hard-coded Journey to the West guidance", () => {
    const frame: ScriptFrame = {
      frameIndex: 1,
      chapter: "黛玉进府",
      title: "黛玉初入荣国府",
      scene: "黛玉随轿入荣国府，丫鬟引路，贾母堂前灯影温暖。",
      characters: ["林黛玉", "贾母", "王熙凤"],
      location: "荣国府",
      mood: "拘谨、华贵",
      continuityAnchor: "用回廊、灯笼和人物行进方向向右承接。",
      forbidden: "不得水墨化，不得提前画后续剧情。",
      visualPromptHint: "国风漫画彩色分镜，清代贵族服饰。",
    };
    const prompt = buildImagePrompt(
      {
        original_theme: "红楼梦",
        optimized_prompt: "国风漫画风格，不要用水墨画卷风格。",
        generation_mode: "story",
        story_template: AI_SCRIPT_TEMPLATE,
        story_template_version: AI_SCRIPT_TEMPLATE_VERSION,
        story_total_frames: 128,
        script_summary: "《红楼梦》原著主线 128 帧。",
        character_bible: "宝玉、黛玉、宝钗等保持彩色漫画设定。",
      },
      1,
      false,
      buildAiScriptCreativePlan({ frame, totalFrames: 128 }),
    );

    expect(prompt).toContain("Create one full-bleed horizontal Chinese comic storyboard frame.");
    expect(prompt).toContain("红楼梦");
    expect(prompt).toContain("国风漫画");
    expect(prompt).not.toContain("Journey to the West");
    expect(prompt).not.toContain("Sun Wukong");
    expect(prompt).not.toContain("孙悟空");
    expect(prompt.toLowerCase()).not.toContain("handscroll");
  });

  it("keeps red chamber comic story prompts free of paper scroll border triggers", () => {
    const frame: ScriptFrame = {
      frameIndex: 43,
      chapter: "Poetry club",
      title: "Snow pavilion couplets",
      scene: "A snowy garden poetry gathering continues from the previous corridor without changing the visual medium.",
      characters: ["Lin Daiyu", "Xue Baochai", "Shi Xiangyun"],
      location: "Grand View Garden",
      mood: "bright comic drama",
      continuityAnchor: "Continue the previous right-edge corridor, figure scale, lantern light, and garden architecture.",
      forbidden: "No ink-wash, no xuan paper, no paper borders, no mounted scroll frame.",
      visualPromptHint: "Chinese comic storyboard, clean linework, soft cel shading, full-bleed canvas.",
    };
    const prompt = buildImagePrompt(
      {
        original_theme: "Dream of Red Mansions",
        optimized_prompt: "Chinese comic style, no ink-wash, no xuan paper, no paper texture, no antique scroll finish.",
        generation_mode: "story",
        story_template: AI_SCRIPT_TEMPLATE,
        story_template_version: AI_SCRIPT_TEMPLATE_VERSION,
        story_total_frames: 128,
        script_summary: "128-frame Dream of Red Mansions comic sequence.",
        character_bible: "Clean Chinese comic character designs with consistent Qing-era costumes.",
      },
      43,
      true,
      buildAiScriptCreativePlan({ frame, totalFrames: 128 }),
      true,
    );

    const lowerPrompt = prompt.toLowerCase();
    expect(lowerPrompt).not.toContain("handscroll");
    expect(lowerPrompt).not.toContain("paper texture");
    expect(lowerPrompt).not.toContain("antique scroll finish");
    expect(lowerPrompt).not.toContain("real antique panoramic scroll");
    expect(lowerPrompt).not.toContain("scroll transition");
    expect(prompt).not.toContain("卷轴纹理");
    expect(lowerPrompt).toContain("full-bleed");
    expect(lowerPrompt).toContain("no paper borders");
    expect(lowerPrompt).toContain("hard visual anchor");
  });
});

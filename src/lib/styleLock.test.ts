import { describe, expect, it } from "vitest";
import {
  buildFallbackStyleWarning,
  buildStyleLockPromptSection,
  isFallbackImageModel,
  summarizePreviousFrameForNextPrompt,
} from "./styleLock";

describe("buildStyleLockPromptSection", () => {
  it("creates a stable visual style lock from scroll theme fields", () => {
    const section = buildStyleLockPromptSection({
      theme: "西游记连环画",
      optimizedPrompt: "朱砂、石青、藤黄与赭石设色，古典连环画线描。",
      characterBible: "孙悟空保持猴相、行者衣装与金箍棒；唐僧保持僧衣。",
      generationMode: "story",
    });

    expect(section).toContain("Global Style Lock");
    expect(section).toContain("西游记连环画");
    expect(section).toContain("朱砂、石青、藤黄与赭石设色");
    expect(section).toContain("孙悟空保持猴相");
    expect(section).toContain("linework");
    expect(section).toContain("palette");
    expect(section).toContain("paper texture");
    expect(section).toContain("character proportions");
  });
});

describe("summarizePreviousFrameForNextPrompt", () => {
  it("summarizes creative plan fields without carrying the full generated prompt forward", () => {
    const summary = summarizePreviousFrameForNextPrompt(
      {
        mode: "free",
        title: "第 8 张：山门远路",
        continuityAnchor: "右缘道路、屋檐高度和人物行进方向继续向右。",
        newScene: "山路旁出现茶棚与挑担行人。",
        composition: "中景横向展开。",
        forbidden: "不得切换画风。",
        promptFragment: [
          "Create one segment of a continuous horizontal Chinese handscroll painting.",
          "Global Style Lock: keep linework and palette fixed.",
          "User theme: wrong text that should not be inherited as a full prompt.",
        ].join("\n"),
      },
      "Create one segment of a continuous horizontal Chinese handscroll painting.\nGlobal Style Lock: keep linework and palette fixed.\nCreative plan for this exact segment:\nUser theme: wrong text",
    );

    expect(summary).toContain("Previous frame: 第 8 张：山门远路");
    expect(summary).toContain("山路旁出现茶棚与挑担行人");
    expect(summary).not.toContain("Create one segment");
    expect(summary).not.toContain("Global Style Lock");
    expect(summary).not.toContain("User theme");
  });

  it("keeps useful previous scene lines when falling back from a stored full prompt", () => {
    const summary = summarizePreviousFrameForNextPrompt(
      undefined,
      [
        "Create one segment of a continuous horizontal Chinese handscroll painting.",
        "Global Style Lock: keep linework and palette fixed.",
        "User theme: 西游记连环画",
        "New scene: 山路旁出现茶棚与挑担行人。",
        "Continuity anchor: 右缘道路继续向右。",
        "No modern objects, no text labels.",
      ].join("\n"),
    );

    expect(summary).toContain("New scene: 山路旁出现茶棚与挑担行人。");
    expect(summary).toContain("Continuity anchor: 右缘道路继续向右。");
    expect(summary).not.toContain("Create one segment");
    expect(summary).not.toContain("Global Style Lock");
    expect(summary).not.toContain("User theme");
  });
});

describe("fallback style warning", () => {
  it("detects image model fallback that may alter visual style", () => {
    expect(isFallbackImageModel("gpt-image-1.5 edit-outpaint (key #1)")).toBe(true);
    expect(isFallbackImageModel("gpt-image-1 edit-outpaint (key #1)")).toBe(true);
    expect(isFallbackImageModel("gpt-image-2 edit-outpaint (key #1)")).toBe(false);
    expect(buildFallbackStyleWarning("gpt-image-1.5 edit-outpaint (key #1)")).toContain("style may drift");
  });
});

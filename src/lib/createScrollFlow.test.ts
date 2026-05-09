import { describe, expect, it } from "vitest";
import { buildCreateScrollPayload, canCreateBlankScroll, detectGenerationMode } from "./createScrollFlow";

describe("create scroll flow", () => {
  it("does not inject a default Qingming theme", () => {
    expect(buildCreateScrollPayload({ theme: "", optimizedPrompt: "" })).toEqual({ theme: "", optimizedPrompt: "" });
  });

  it("requires a user supplied theme", () => {
    expect(canCreateBlankScroll({ theme: "", optimizedPrompt: "prompt" })).toBe(false);
    expect(canCreateBlankScroll({ theme: "赛博敦煌夜市", optimizedPrompt: "" })).toBe(true);
  });

  it("keeps the user supplied prompt separate from the theme", () => {
    expect(buildCreateScrollPayload({ theme: " 海底丝绸之路 ", optimizedPrompt: " 蓝绿色深海长卷 " })).toEqual({
      theme: "海底丝绸之路",
      optimizedPrompt: "蓝绿色深海长卷",
    });
  });

  it("detects Journey to the West story mode from theme or prompt", () => {
    expect(detectGenerationMode("西游记连环画", "")).toEqual({
      generationMode: "story",
      storyTemplate: "journey_to_west",
      storyTemplateVersion: "v1",
      storyTotalFrames: 128,
    });
    expect(detectGenerationMode("取经长卷", "按《西游记》的剧情生成")).toMatchObject({
      generationMode: "story",
      storyTemplate: "journey_to_west",
    });
    expect(detectGenerationMode("赛博敦煌夜市", "")).toEqual({
      generationMode: "free",
      storyTemplate: null,
      storyTemplateVersion: null,
      storyTotalFrames: null,
    });
  });
});

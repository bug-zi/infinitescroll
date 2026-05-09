import { describe, expect, it } from "vitest";
import { buildCreativePlanPromptSection, createCreativePlan, JOURNEY_TO_WEST_STORYBOARD, normalizeCreativePlan } from "./creativePlan";

describe("createCreativePlan", () => {
  it("keeps the first segment anchored to the user's theme instead of a fixed river-market template", () => {
    const plan = createCreativePlan({
      theme: "山海经神话世界",
      optimizedPrompt: "古籍插画风格，异兽山川从左到右连续展开。",
      targetIndex: 1,
      hasReferenceImage: false,
    });

    expect(plan.title).toContain("山海经神话世界");
    expect(plan.newScene).toContain("山海经神话世界");
    expect(plan.promptFragment).toContain("山海经神话世界");
    expect(plan.newScene).not.toContain("河岸茶肆");
    expect(plan.promptFragment).not.toContain("清明上河图");
  });

  it("automatically uses the Journey to the West storyboard for matching themes", () => {
    const plan = createCreativePlan({
      theme: "西游记连环画",
      optimizedPrompt: "传统连环画风格，唐僧师徒取经。",
      targetIndex: 1,
      hasReferenceImage: false,
    });

    expect(JOURNEY_TO_WEST_STORYBOARD).toHaveLength(128);
    expect(plan.mode).toBe("story");
    expect(plan.storyTemplate).toBe("journey_to_west");
    expect(plan.storyFrameIndex).toBe(1);
    expect(plan.storyTotalFrames).toBe(128);
    expect(plan.chapter).toBe("花果山石猴");
    expect(plan.title).toContain("石猴出世");
    expect(plan.characters).toContain("石猴");
    expect(plan.location).toBe("东胜神洲傲来国花果山");
    expect(plan.promptFragment).toContain("只画当前剧情帧");
    expect(plan.promptFragment).toContain("不得提前画后续剧情");
  });

  it("advances through distinct Journey to the West frames by target index", () => {
    const first = createCreativePlan({ theme: "西游记", targetIndex: 1 });
    const second = createCreativePlan({ theme: "西游记", targetIndex: 2 });
    const last = createCreativePlan({ theme: "西游记", targetIndex: 128 });
    const overflow = createCreativePlan({ theme: "西游记", targetIndex: 129 });

    expect(first.title).toContain("石猴出世");
    expect(second.title).toContain("群猴拜王");
    expect(second.title).not.toBe(first.title);
    expect(last.title).toContain("功德圆满");
    expect(overflow.title).toContain("功德圆满");
    expect(overflow.forbidden).toContain("剧情模板已经到达末尾");
  });

  it("builds a concrete scroll continuation plan for the next segment", () => {
    const plan = createCreativePlan({
      theme: "参照《清明上河图》的风格，绘制北宋汴京城的繁华市井与自然风光",
      optimizedPrompt: "细密描绘河流桥梁、舟船往来、街道商铺、车马行人。",
      previousPrompt: "上一张描绘拱桥与河面船只，市民沿河岸聚集。",
      targetIndex: 13,
      hasReferenceImage: true,
    });

    expect(plan.title).toContain("清明上河图");
    expect(plan.continuityAnchor).toContain("上一张右缘");
    expect(plan.newScene).toContain("清明上河图");
    expect(plan.composition).toContain("左侧重叠区");
    expect(plan.forbidden).toContain("不得突然换");
    expect(plan.promptFragment).toContain("清明上河图");
    expect(plan.promptFragment).toContain("左侧重叠区");
  });

  it("normalizes missing or legacy plan data with a deterministic fallback", () => {
    const plan = normalizeCreativePlan(
      { title: "", newScene: "补画桥头人群" },
      {
        theme: "山海经神话世界",
        optimizedPrompt: "古籍插画风格",
        targetIndex: 2,
        hasReferenceImage: true,
      },
    );

    expect(plan.title).toContain("山海经神话世界");
    expect(plan.newScene).toBe("补画桥头人群");
    expect(plan.continuityAnchor).toContain("上一张右缘");
    expect(plan.promptFragment).toContain("补画桥头人群");
  });

  it("normalizes persisted story frame metadata for UI and prompt reuse", () => {
    const plan = normalizeCreativePlan(
      {
        mode: "story",
        storyTemplate: "journey_to_west",
        storyFrameIndex: 7,
        storyTotalFrames: 128,
        chapter: "求仙访道",
        title: "第 7 / 128 帧：漂洋过海",
        newScene: "石猴乘木筏远渡重洋。",
        characters: ["石猴"],
        location: "东海",
        mood: "孤勇辽阔",
      },
      { theme: "西游记", targetIndex: 7 },
    );

    expect(plan.mode).toBe("story");
    expect(plan.storyFrameIndex).toBe(7);
    expect(plan.characters).toEqual(["石猴"]);
    expect(plan.location).toBe("东海");
    expect(plan.promptFragment).toContain("石猴乘木筏远渡重洋");
  });
});

describe("buildCreativePlanPromptSection", () => {
  it("serializes the visible plan as the exact prompt section used for image generation", () => {
    const plan = createCreativePlan({
      theme: "清明上河图风格",
      optimizedPrompt: "连续横向长卷",
      targetIndex: 2,
      hasReferenceImage: true,
    });

    expect(buildCreativePlanPromptSection(plan)).toContain("Creative plan for this exact segment");
    expect(buildCreativePlanPromptSection(plan)).toContain(plan.continuityAnchor);
    expect(buildCreativePlanPromptSection(plan)).toContain("Follow this plan exactly");
  });
});

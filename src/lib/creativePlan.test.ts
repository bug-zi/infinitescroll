import { describe, expect, it } from "vitest";
import { buildCreativePlanPromptSection, createCreativePlan, normalizeCreativePlan } from "./creativePlan";

describe("createCreativePlan", () => {
  it("builds a concrete scroll continuation plan for the next segment", () => {
    const plan = createCreativePlan({
      theme: "参照《清明上河图》的风格，绘制北宋汴京城的繁华市井与自然风光",
      optimizedPrompt: "细密描绘河流桥梁、舟船往来、街道商铺、车马行人。",
      previousPrompt: "上一张描绘拱桥与河面船只，市民沿河岸聚集。",
      targetIndex: 13,
      hasReferenceImage: true,
    });

    expect(plan).toMatchObject({
      title: "第 13 张：河岸街市延展",
      continuityAnchor: "锁定上一张右缘的河道水线、桥梁弧线、岸边道路、屋檐高度和人群行进方向。",
      newScene: "向右展开河岸茶肆、卸货小船、挑担行人、临街摊铺与停靠车马，让市井活动从上一段自然延伸。",
      composition: "左侧重叠区只负责承接，主体事件放在中右部；河道、道路和屋檐线保持同一消失方向。",
      forbidden: "不得改动左侧重叠区；不得突然换时代、季节、视角或光照；不得用大面积空景打断画卷节奏。",
    });
    expect(plan.promptFragment).toContain("河岸茶肆");
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

    expect(plan.title).toBe("第 2 张：桥市人潮推进");
    expect(plan.newScene).toBe("补画桥头人群");
    expect(plan.continuityAnchor).toContain("上一张右缘");
    expect(plan.promptFragment).toContain("补画桥头人群");
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

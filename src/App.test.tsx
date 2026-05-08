import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationPlan } from "./App";
import { mockImages, mockJobs, mockScrolls } from "./data/mockData";

describe("GenerationPlan", () => {
  it("renders the same creative plan fields that feed image generation", () => {
    const html = renderToStaticMarkup(<GenerationPlan scroll={mockScrolls[0]} jobs={mockJobs.slice(0, 1)} images={mockImages} />);

    expect(html).toContain("衔接锚点");
    expect(html).toContain("新增画面");
    expect(html).toContain("构图节奏");
    expect(html).toContain("禁止偏移");
    expect(html).toContain(mockJobs[0].creativePlan?.newScene);
    expect(html).toContain("直接写入图片生成提示词");
  });
});

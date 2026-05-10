import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App, GenerationPlan } from "./App";
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

  it("renders story frame progress and metadata for Journey to the West plans", () => {
    const storyJob = {
      ...mockJobs[0],
      creativePlan: {
        mode: "story" as const,
        storyTemplate: "journey_to_west",
        storyFrameIndex: 1,
        storyTotalFrames: 128,
        chapter: "花果山石猴",
        title: "第 1 / 128 帧：石猴出世",
        newScene: "仙石崩裂，石猴诞生。",
        continuityAnchor: "以云气和卷轴纹理过渡。",
        composition: "石猴在中景，花果山瀑布在右侧延展。",
        forbidden: "只画当前剧情帧，不得提前画后续剧情。",
        promptFragment: "剧情帧：石猴出世",
        characters: ["石猴", "群猴"],
        location: "花果山",
        mood: "神异初生",
      },
    };
    const html = renderToStaticMarkup(<GenerationPlan scroll={mockScrolls[0]} jobs={[storyJob]} images={[]} />);

    expect(html).toContain("剧情进度");
    expect(html).toContain("第 1 / 128 帧");
    expect(html).toContain("花果山石猴");
    expect(html).toContain("石猴、群猴");
    expect(html).toContain("花果山");
  });

  it("renders the active plan summary as a full-width card header", () => {
    const html = renderToStaticMarkup(<GenerationPlan scroll={mockScrolls[0]} jobs={mockJobs.slice(0, 1)} images={[]} />);

    expect(html).toContain('class="plan-item next creative-plan-card full-width-plan-card"');
    expect(html).toContain('class="plan-card-head plan-card-head-full"');
  });
});

describe("App topbar", () => {
  it("renders interactive notification and account entries", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("notification-button");
    expect(html).toContain("account-trigger");
    expect(html).toContain("Yuer");
  });
});

describe("App create scroll entry", () => {
  it("starts with a clickable create entry before asking for a theme", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="create-button"');
    expect(html).not.toContain('class="create-button" disabled');
    expect(html).not.toContain('placeholder="输入画卷主题"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("renders a dedicated create wizard with DeepSeek prompt refinement when opened", () => {
    const html = renderToStaticMarkup(<App initialCreateScrollOpen />);

    expect(html).toContain("创建新画卷");
    expect(html).toContain("DeepSeek");
    expect(html).toContain("输入你想生成的画卷主题");
    expect(html).toContain("让 DeepSeek 丰富提示词");
    expect(html).toContain("确认创建画卷");
  });
});

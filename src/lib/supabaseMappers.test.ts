import { describe, expect, it } from "vitest";
import { mapImageRow, mapJobRow, mapLogRow } from "./supabaseMappers";

describe("mapLogRow", () => {
  it("replaces question-mark mojibake logs with readable fallback text", () => {
    const log = mapLogRow({
      id: "log-1",
      scroll_id: "scroll-1",
      level: "info",
      message: "???????",
      detail: "??? 1-3 ?????????????",
      created_at: "2026-05-07T07:46:22.497009+00:00",
    });

    expect(log.message).toBe("日志内容编码异常");
    expect(log.detail).toBe("原始日志包含不可恢复的问号乱码，请查看相邻日志或重新触发操作。");
  });
});

describe("mapImageRow", () => {
  it("normalizes legacy generated canvas ratios to the visible 4:3 image ratio", () => {
    const image = mapImageRow({
      id: "image-1",
      scroll_id: "scroll-1",
      image_index: 2,
      full_image_url: "https://example.com/image.png",
      generated_at: "2026-05-07T07:46:22.497009+00:00",
      prompt: "prompt",
      model: "GPT Image",
      status: "succeeded",
      file_size_bytes: 1234,
      width: 1152,
      height: 768,
      ratio_label: "4.5:3",
      visible_crop: { x: 230, y: 0, width: 922, height: 768 },
      overlap_crop: { x: 0, y: 0, width: 230, height: 768 },
      new_content_crop: { x: 230, y: 0, width: 922, height: 768 },
      has_stitch_warning: false,
    });

    expect(image.dimensions.ratioLabel).toBe("4:3");
  });
});

describe("mapJobRow", () => {
  it("maps persisted creative plan JSON for visible and generation use", () => {
    const job = mapJobRow({
      id: "job-1",
      scroll_id: "scroll-1",
      target_index: 13,
      type: "auto_next",
      status: "queued",
      scheduled_for: "2026-05-07T12:04:04.000Z",
      creative_plan: {
        title: "第 13 张：桥头税关",
        continuityAnchor: "承接上一张右侧桥头栏杆。",
        newScene: "展开税关、货担与排队商旅。",
        composition: "桥头在左，税关在中，街巷向右延伸。",
        forbidden: "不得换成山水空景。",
        promptFragment: "严格按桥头税关计划生成。",
      },
    });

    expect(job.creativePlan).toMatchObject({
      title: "第 13 张：桥头税关",
      promptFragment: "严格按桥头税关计划生成。",
    });
  });
});

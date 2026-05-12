import { describe, expect, test } from "vitest";
import { buildImageCaption } from "./imageCaption";
import type { ScrollImage } from "../types";

function image(input: Partial<ScrollImage> = {}): ScrollImage {
  return {
    id: "image-1",
    scrollId: "scroll-1",
    index: 1,
    title: "第 1 张",
    src: "/segment.svg",
    generatedAt: "2026-05-11T00:00:00.000Z",
    prompt: "",
    model: "test",
    status: "succeeded",
    fileSize: "1 MB",
    dimensions: { width: 1024, height: 768, ratioLabel: "4:3" },
    visibleCrop: { x: 0, y: 0, width: 1024, height: 768 },
    overlapCrop: { x: 0, y: 0, width: 0, height: 768 },
    newContentCrop: { x: 0, y: 0, width: 1024, height: 768 },
    ...input,
  };
}

describe("image captions", () => {
  test("extracts readable story fields from ai_script prompts", () => {
    const caption = buildImageCaption(
      image({
        title: "第 7 张",
        prompt: [
          "剧情模式：AI 编剧分镜长卷。",
          "剧情进度：第 7 / 128 帧。",
          "章节：黛玉进府",
          "当前剧情帧：初入荣府",
          "主要人物：林黛玉、贾母",
          "场景地点：荣国府",
          "情绪氛围：华贵、拘谨、初见",
          "当前画面：黛玉轿马进入荣国府，朱门、影壁、丫鬟队列层层展开。",
        ].join("\n"),
      }),
      6,
    );

    expect(caption.eyebrow).toBe("第 7 段");
    expect(caption.title).toBe("初入荣府");
    expect(caption.details).toBe("章节：黛玉进府 · 地点：荣国府 · 人物：林黛玉、贾母 · 氛围：华贵、拘谨、初见");
    expect(caption.body).toBe("黛玉轿马进入荣国府，朱门、影壁、丫鬟队列层层展开。");
  });

  test("falls back to image title and prompt summary when structured story fields are missing", () => {
    const caption = buildImageCaption(
      image({
        title: "第 2 张：桥头人潮",
        prompt: ["Theme: 清明上河图风格长卷", "New scene: 桥头人潮、货担队列、临水店铺逐步展开。"].join("\n"),
      }),
      1,
    );

    expect(caption.eyebrow).toBe("第 2 段");
    expect(caption.title).toBe("第 2 张：桥头人潮");
    expect(caption.details).toBe("");
    expect(caption.body).toBe("桥头人潮、货担队列、临水店铺逐步展开。");
  });

  test("returns a safe empty-state caption when no prompt or title exists", () => {
    const caption = buildImageCaption(image({ title: "", prompt: "   " }), 3);

    expect(caption.eyebrow).toBe("第 4 段");
    expect(caption.title).toBe("第 4 段");
    expect(caption.details).toBe("");
    expect(caption.body).toBe("第 4 段，暂无解说");
  });
});

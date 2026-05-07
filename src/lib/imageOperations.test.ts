import { describe, expect, it } from "vitest";
import { planImageDeletion, shouldRegenerateImmediately } from "./imageOperations";
import type { Scroll, ScrollImage } from "../types";

const scroll: Scroll = {
  id: "scroll-id",
  title: "测试画卷",
  status: "generating",
  originalTheme: "测试",
  optimizedPrompt: "测试",
  createdAt: "2026-05-07T00:00:00.000Z",
  lastGeneratedAt: "2026-05-07T00:00:00.000Z",
  nextRunAt: "2026-05-07T00:05:00.000Z",
  intervalMinutes: 5,
  overlapPreset: "maximum",
  overlapRatio: 0.25,
  imageCount: 3,
  autoGenerationEnabled: true,
  thumbnail: "/test.png",
};

function image(index: number): ScrollImage {
  return {
    id: `image-${index}`,
    scrollId: scroll.id,
    index,
    title: `第 ${index} 张`,
    src: "/test.png",
    generatedAt: "2026-05-07T00:00:00.000Z",
    prompt: "测试",
    model: "test",
    status: "succeeded",
    fileSize: "1 MB",
    dimensions: { width: 1024, height: 768, ratioLabel: "4:3" },
    visibleCrop: { x: 0, y: 0, width: 1024, height: 768 },
    overlapCrop: { x: 0, y: 0, width: 0, height: 768 },
    newContentCrop: { x: 0, y: 0, width: 1024, height: 768 },
  };
}

describe("image operation plans", () => {
  it("deletes a tail image without pausing the scroll", () => {
    expect(planImageDeletion(scroll, image(3))).toMatchObject({
      nextImageCount: 2,
      shouldPauseScroll: false,
      markFollowingForReview: false,
    });
  });

  it("pauses the scroll when deleting a middle image", () => {
    expect(planImageDeletion(scroll, image(2))).toMatchObject({
      nextImageCount: 2,
      shouldPauseScroll: true,
      markFollowingForReview: true,
    });
  });

  it("only regenerates tail images immediately", () => {
    expect(shouldRegenerateImmediately(scroll, image(3))).toBe(true);
    expect(shouldRegenerateImmediately(scroll, image(2))).toBe(false);
  });
});

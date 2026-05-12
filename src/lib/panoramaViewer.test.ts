import { describe, expect, test } from "vitest";
import {
  clampScale,
  computeImmersiveScrollHeight,
  computeActiveSegmentIndex,
  computeInitialPan,
  computePanForHeldDirection,
  computeSegmentLayout,
  computeVisibleImageLayout,
  computeZoomAroundPoint,
} from "./panoramaViewer";
import type { ScrollImage } from "../types";

function image(id: string, width: number, height = 768): ScrollImage {
  return {
    id,
    scrollId: "scroll-1",
    index: Number(id.replace("image-", "")),
    title: id,
    src: "/segment.svg",
    prompt: "",
    status: "succeeded",
    dimensions: { width, height, ratioLabel: `${width}:${height}` },
    visibleCrop: { x: 0, y: 0, width, height },
    overlapCrop: { x: 0, y: 0, width: 0, height },
    newContentCrop: { x: 0, y: 0, width, height },
    fileSize: "1 MB",
    model: "test",
    generatedAt: "2026-05-07T00:00:00.000Z",
  };
}

function overlappedImage(id: string): ScrollImage {
  return {
    ...image(id, 1152),
    visibleCrop: { x: 230, y: 0, width: 922, height: 768 },
    overlapCrop: { x: 0, y: 0, width: 230, height: 768 },
    newContentCrop: { x: 230, y: 0, width: 922, height: 768 },
  };
}

describe("panorama viewer math", () => {
  test("computes a continuous segment layout without gaps", () => {
    const layout = computeSegmentLayout([image("image-1", 1024), image("image-2", 896), image("image-3", 896)], 192);

    expect(layout.totalWidth).toBe(704);
    expect(layout.segments.map((segment) => segment.left)).toEqual([0, 256, 480]);
    expect(layout.segments.map((segment) => segment.width)).toEqual([256, 224, 224]);
  });

  test("uses each segment's visible crop so the panorama matches the preview stitching", () => {
    const layout = computeSegmentLayout([image("image-1", 1024), overlappedImage("image-2"), overlappedImage("image-3")], 192);

    expect(layout.segments.map((segment) => segment.left)).toEqual([0, 256, 487]);
    expect(layout.segments.map((segment) => segment.width)).toEqual([256, 231, 231]);
    expect(layout.segments.map((segment) => segment.imageWidth)).toEqual([256, 288, 288]);
    expect(layout.segments.map((segment) => segment.imageOffsetLeft)).toEqual([0, 58, 58]);
    expect(layout.totalWidth).toBe(718);
  });

  test("computes the visible crop layout so preview edges mark the true seam", () => {
    const crop = computeVisibleImageLayout(overlappedImage("image-2"), 192);

    expect(crop.width).toBe(231);
    expect(crop.imageWidth).toBe(288);
    expect(crop.imageOffsetLeft).toBe(58);
    expect(crop.overlapLeft).toBe(58);
  });

  test("centers the clicked segment in the viewport", () => {
    const layout = computeSegmentLayout([image("image-1", 1024), image("image-2", 896), image("image-3", 896)], 192);

    const pan = computeInitialPan(layout, "image-2", 800);

    expect(pan).toBe(-16);
  });

  test("detects the segment currently centered in the panorama viewport", () => {
    const layout = computeSegmentLayout([image("image-1", 1024), image("image-2", 896), image("image-3", 896)], 192);

    expect(computeActiveSegmentIndex(layout, computeInitialPan(layout, "image-2", 800), 1)).toBe(1);
    expect(computeActiveSegmentIndex(layout, computeInitialPan(layout, "image-3", 800) * 2, 2)).toBe(2);
    expect(computeActiveSegmentIndex(layout, 999, 1)).toBe(0);
    expect(computeActiveSegmentIndex(layout, -999, 1)).toBe(2);
  });

  test("held direction movement ramps with hold time and honors direction", () => {
    const shortMove = computePanForHeldDirection(0, "right", 100, 1);
    const longMove = computePanForHeldDirection(0, "right", 1600, 1);
    const leftMove = computePanForHeldDirection(0, "left", 1600, 1);

    expect(shortMove).toBeLessThan(0);
    expect(Math.abs(longMove)).toBeGreaterThan(Math.abs(shortMove));
    expect(leftMove).toBeGreaterThan(0);
  });

  test("zoom around point keeps the pointed content stable", () => {
    const result = computeZoomAroundPoint({
      pan: { x: -100, y: 20 },
      scale: 1,
      nextScale: 2,
      point: { x: 300, y: 200 },
      viewportCenter: { x: 400, y: 300 },
    });

    expect(result.x).toBe(-100);
    expect(result.y).toBe(140);
  });

  test("clamps scale to configured viewer bounds", () => {
    expect(clampScale(0.1)).toBe(0.6);
    expect(clampScale(2)).toBe(2);
    expect(clampScale(12)).toBe(6);
  });

  test("uses most of the viewer stage for immersive scroll viewing", () => {
    expect(computeImmersiveScrollHeight(834)).toBe(802);
    expect(computeImmersiveScrollHeight(954)).toBe(922);
    expect(computeImmersiveScrollHeight(360)).toBe(320);
    expect(computeImmersiveScrollHeight(220)).toBe(204);
  });
});

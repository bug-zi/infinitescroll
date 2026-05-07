import type { ScrollImage } from "../types";

export const MIN_PANORAMA_SCALE = 0.6;
export const MAX_PANORAMA_SCALE = 6;

export type PanoramaSegmentLayout = {
  id: string;
  left: number;
  width: number;
  height: number;
  overlapLeft: number;
  imageWidth: number;
  imageOffsetLeft: number;
};

export type PanoramaLayout = {
  segments: PanoramaSegmentLayout[];
  totalWidth: number;
  height: number;
};

export function clampScale(scale: number) {
  return Math.max(MIN_PANORAMA_SCALE, Math.min(MAX_PANORAMA_SCALE, scale));
}

export function computeSegmentLayout(images: ScrollImage[], targetHeight: number): PanoramaLayout {
  let left = 0;
  const segments = images.map((image) => {
    const imageWidth = Math.round((image.dimensions.width / image.dimensions.height) * targetHeight);
    const overlapLeft = Math.round((image.overlapCrop.width / image.dimensions.height) * targetHeight);
    const visibleWidth = Math.round((image.visibleCrop.width / image.dimensions.height) * targetHeight);
    const segment = {
      id: image.id,
      left,
      width: visibleWidth > 0 ? visibleWidth : imageWidth,
      height: targetHeight,
      overlapLeft,
      imageWidth,
      imageOffsetLeft: Math.round((image.visibleCrop.x / image.dimensions.height) * targetHeight),
    };
    left += segment.width;
    return segment;
  });

  return {
    segments,
    totalWidth: left,
    height: targetHeight,
  };
}

export function computeInitialPan(layout: PanoramaLayout, imageId: string, viewportWidth: number) {
  const segment = layout.segments.find((item) => item.id === imageId) ?? layout.segments[0];
  if (!segment) return 0;
  const segmentCenter = segment.left + segment.width / 2;
  return viewportWidth / 2 - segmentCenter;
}

export function computePanForHeldDirection(currentX: number, direction: "left" | "right", heldMs: number, scale: number) {
  const ramp = Math.min(1, Math.max(0, heldMs) / 1200);
  const speed = 2 + ramp * 18;
  const distance = speed / Math.max(scale, 0.1);
  return direction === "right" ? currentX - distance : currentX + distance;
}

export function computeZoomAroundPoint(input: {
  pan: { x: number; y: number };
  scale: number;
  nextScale: number;
  point: { x: number; y: number };
  viewportCenter: { x: number; y: number };
}) {
  const pointX = input.point.x - input.viewportCenter.x;
  const pointY = input.point.y - input.viewportCenter.y;
  const factor = input.nextScale / input.scale;

  return {
    x: pointX - factor * (pointX - input.pan.x),
    y: pointY - factor * (pointY - input.pan.y),
  };
}

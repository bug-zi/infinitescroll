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

export type VisibleImageLayout = {
  width: number;
  height: number;
  imageWidth: number;
  imageOffsetLeft: number;
  overlapLeft: number;
};

export function clampScale(scale: number) {
  return Math.max(MIN_PANORAMA_SCALE, Math.min(MAX_PANORAMA_SCALE, scale));
}

export function computeImmersiveScrollHeight(stageHeight: number) {
  const safeStageHeight = Math.max(0, stageHeight);
  const targetHeight = safeStageHeight >= 600 ? safeStageHeight - 32 : safeStageHeight - 40;
  return Math.round(Math.min(1080, Math.max(204, targetHeight)));
}

function scaleByHeight(value: number, sourceHeight: number, targetHeight: number) {
  return Math.round((value / sourceHeight) * targetHeight);
}

export function computeVisibleImageLayout(image: ScrollImage, targetHeight: number): VisibleImageLayout {
  const imageWidth = scaleByHeight(image.dimensions.width, image.dimensions.height, targetHeight);
  const visibleWidth = scaleByHeight(image.visibleCrop.width, image.dimensions.height, targetHeight);

  return {
    width: visibleWidth > 0 ? visibleWidth : imageWidth,
    height: targetHeight,
    imageWidth,
    imageOffsetLeft: scaleByHeight(image.visibleCrop.x, image.dimensions.height, targetHeight),
    overlapLeft: scaleByHeight(image.overlapCrop.width, image.dimensions.height, targetHeight),
  };
}

export function computeSegmentLayout(images: ScrollImage[], targetHeight: number): PanoramaLayout {
  let left = 0;
  const segments = images.map((image) => {
    const crop = computeVisibleImageLayout(image, targetHeight);
    const segment = {
      id: image.id,
      left,
      width: crop.width,
      height: crop.height,
      overlapLeft: crop.overlapLeft,
      imageWidth: crop.imageWidth,
      imageOffsetLeft: crop.imageOffsetLeft,
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
  return layout.totalWidth / 2 - segmentCenter;
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

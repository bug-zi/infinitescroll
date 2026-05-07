import type { CropRegion, OverlapPreset } from "../types";

export const FIXED_OVERLAP_RATIO = 0.25;
export const FIXED_OVERLAP_PRESET: OverlapPreset = "maximum";

export const OVERLAP_PRESETS: Record<OverlapPreset, { label: string; ratio: number; description: string }> = {
  standard: {
    label: "标准 12.5%",
    ratio: 0.125,
    description: "较少重叠，适合低成本试验。",
  },
  strong: {
    label: "强衔接 20%",
    ratio: 0.2,
    description: "更宽参考区，适合建筑、河流和街道。",
  },
  maximum: {
    label: "超强 25%",
    ratio: 0.25,
    description: "使用更宽参考区提升衔接稳定性。",
  },
};

export function getGeneratedWidthForVisibleSegment(visibleWidth: number, overlapRatio: number) {
  return Math.round(visibleWidth * (1 + overlapRatio));
}

export function getGeneratedRatioLabel(overlapRatio: number) {
  void overlapRatio;
  return "4:3";
}

export function normalizeImageRatioLabel(value: unknown) {
  const label = String(value ?? "").trim();
  return label === "4.5:3" || label === "4.5：3" || label === "4.8:3" || label === "5:3" ? "4:3" : label || "4:3";
}

export function createStitchCrops(width: number, height: number, overlapRatio: number) {
  const overlapWidth = Math.round(width * (overlapRatio / (1 + overlapRatio)));
  const visibleWidth = width - overlapWidth;

  const overlapCrop: CropRegion = {
    x: 0,
    y: 0,
    width: overlapWidth,
    height,
  };

  const newContentCrop: CropRegion = {
    x: overlapWidth,
    y: 0,
    width: visibleWidth,
    height,
  };

  const visibleCrop: CropRegion = {
    x: overlapWidth,
    y: 0,
    width: visibleWidth,
    height,
  };

  return { overlapCrop, newContentCrop, visibleCrop };
}

export function getStitchCrops(width: number, height: number) {
  return createStitchCrops(width, height, FIXED_OVERLAP_RATIO);
}

import { describe, expect, it } from "vitest";
import { createStitchCrops, FIXED_OVERLAP_RATIO, getGeneratedRatioLabel, getStitchCrops } from "./stitching";

describe("stitching ratios", () => {
  it("uses one fixed 25% overlap ratio everywhere", () => {
    expect(FIXED_OVERLAP_RATIO).toBe(0.25);
  });

  it("keeps the public image ratio label as 4:3 even when overlap is enabled", () => {
    expect(getGeneratedRatioLabel(0.25)).toBe("4:3");
    expect(getGeneratedRatioLabel(0.2)).toBe("4:3");
    expect(getGeneratedRatioLabel(0.125)).toBe("4:3");
  });

  it("creates non-overlapping visible and overlap crop regions", () => {
    const crops = getStitchCrops(1152, 768);

    expect(crops.overlapCrop).toEqual({
      x: 0,
      y: 0,
      width: 230,
      height: 768,
    });
    expect(crops.visibleCrop).toEqual({
      x: 230,
      y: 0,
      width: 922,
      height: 768,
    });
    expect(crops.newContentCrop).toEqual(crops.visibleCrop);
  });

  it("keeps the low-level crop helper available for explicit ratios", () => {
    expect(createStitchCrops(1152, 768, 0.125).overlapCrop.width).toBe(128);
  });
});

import { describe, expect, it } from "vitest";
import { formatStitchScore, hasStitchRisk, scoreMeanRgbDifference } from "./stitchQuality";

describe("stitch quality helpers", () => {
  it("maps identical pixels to a perfect score", () => {
    expect(scoreMeanRgbDifference(0)).toBe(100);
  });

  it("maps maximum difference to zero", () => {
    expect(scoreMeanRgbDifference(255)).toBe(0);
  });

  it("flags low scores as stitch risk", () => {
    expect(hasStitchRisk(70)).toBe(true);
    expect(hasStitchRisk(90)).toBe(false);
  });

  it("formats missing scores safely", () => {
    expect(formatStitchScore()).toBe("未评分");
    expect(formatStitchScore(88.4)).toBe("88 分");
  });
});

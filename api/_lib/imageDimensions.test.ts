import { describe, expect, it } from "vitest";
import { getScrollImageDimensions } from "./imageDimensions";

describe("getScrollImageDimensions", () => {
  it("uses a larger 4:3 visible segment and reserves overlap only after the first image", () => {
    expect(getScrollImageDimensions(true, 0.25)).toEqual({
      width: 1536,
      height: 1152,
      overlapWidth: 0,
      visibleWidth: 1536,
    });

    expect(getScrollImageDimensions(false, 0.25)).toEqual({
      width: 1920,
      height: 1152,
      overlapWidth: 384,
      visibleWidth: 1536,
    });
  });
});

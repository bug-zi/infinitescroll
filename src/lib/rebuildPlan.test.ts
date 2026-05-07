import { describe, expect, it } from "vitest";
import { getRebuildIterations, planRebuildFromIndex } from "./rebuildPlan";

describe("rebuild plan", () => {
  it("rebuilds from the changed index through the original tail", () => {
    const plan = planRebuildFromIndex(2, 5);

    expect(plan).toEqual({
      startIndex: 2,
      originalCount: 5,
      targetCount: 5,
      deleteFromIndex: 2,
    });
    expect(getRebuildIterations(plan)).toBe(4);
  });

  it("supports insert flows that increase the target count", () => {
    const plan = planRebuildFromIndex(3, 5, 6);

    expect(getRebuildIterations(plan)).toBe(4);
  });

  it("rejects impossible ranges", () => {
    expect(() => planRebuildFromIndex(0, 5)).toThrow();
    expect(() => planRebuildFromIndex(3, 5, 2)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { chooseScrollAfterDeletion } from "./scrollManagement";
import type { Scroll } from "../types";

function scroll(id: string): Scroll {
  return {
    id,
    title: id,
    status: "paused",
    originalTheme: id,
    optimizedPrompt: "",
    createdAt: "2026-05-07T00:00:00.000Z",
    lastGeneratedAt: "2026-05-07T00:00:00.000Z",
    nextRunAt: "2026-05-07T00:05:00.000Z",
    intervalMinutes: 5,
    overlapPreset: "maximum",
    overlapRatio: 0.25,
    imageCount: 0,
    autoGenerationEnabled: false,
    thumbnail: "/assets/scroll-segment.svg",
  };
}

describe("chooseScrollAfterDeletion", () => {
  it("keeps the current selection when deleting a different scroll", () => {
    expect(chooseScrollAfterDeletion([scroll("a"), scroll("b"), scroll("c")], "b", "a")).toBe("a");
  });

  it("selects the next scroll when deleting the selected scroll", () => {
    expect(chooseScrollAfterDeletion([scroll("a"), scroll("b"), scroll("c")], "b", "b")).toBe("c");
  });

  it("selects the previous scroll when deleting the selected tail scroll", () => {
    expect(chooseScrollAfterDeletion([scroll("a"), scroll("b"), scroll("c")], "c", "c")).toBe("b");
  });

  it("clears selection when deleting the last scroll", () => {
    expect(chooseScrollAfterDeletion([scroll("a")], "a", "a")).toBe("");
  });
});

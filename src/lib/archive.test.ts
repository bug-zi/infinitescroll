import { describe, expect, it } from "vitest";
import { calculatePurgeAfter, partitionArchivedImages, partitionArchivedScrolls } from "./archive";
import type { Scroll, ScrollImage } from "../types";

function scroll(id: string, archivedAt?: string | null): Scroll {
  return {
    id,
    title: id,
    status: "generating",
    originalTheme: "theme",
    optimizedPrompt: "prompt",
    createdAt: "2026-05-08T00:00:00.000Z",
    lastGeneratedAt: "2026-05-08T00:00:00.000Z",
    nextRunAt: "2026-05-08T00:05:00.000Z",
    intervalMinutes: 5,
    overlapPreset: "maximum",
    overlapRatio: 0.25,
    imageCount: 1,
    autoGenerationEnabled: true,
    thumbnail: "/assets/scroll-segment.svg",
    archivedAt: archivedAt ?? null,
    purgeAfter: archivedAt ? "2026-05-15T00:00:00.000Z" : null,
  };
}

function image(id: string, archivedAt?: string | null): ScrollImage {
  return {
    id,
    scrollId: "scroll-1",
    index: id === "first" ? 1 : 2,
    title: id,
    src: "/image.png",
    generatedAt: "2026-05-08T00:00:00.000Z",
    prompt: "prompt",
    model: "model",
    status: "succeeded",
    fileSize: "1 MB",
    dimensions: { width: 1536, height: 1152, ratioLabel: "4:3" },
    visibleCrop: { x: 0, y: 0, width: 1, height: 1 },
    overlapCrop: { x: 0, y: 0, width: 1, height: 1 },
    newContentCrop: { x: 0, y: 0, width: 1, height: 1 },
    archivedAt: archivedAt ?? null,
    purgeAfter: archivedAt ? "2026-05-15T00:00:00.000Z" : null,
  };
}

describe("archive helpers", () => {
  it("sets purge time seven days after archive time", () => {
    expect(calculatePurgeAfter("2026-05-08T12:30:00.000Z")).toBe("2026-05-15T12:30:00.000Z");
  });

  it("splits active and archived scrolls", () => {
    const result = partitionArchivedScrolls([scroll("active"), scroll("archived", "2026-05-08T00:00:00.000Z")]);

    expect(result.active.map((item) => item.id)).toEqual(["active"]);
    expect(result.archived.map((item) => item.id)).toEqual(["archived"]);
  });

  it("splits active and archived images without changing their original index", () => {
    const result = partitionArchivedImages([image("first"), image("second", "2026-05-08T00:00:00.000Z")]);

    expect(result.active.map((item) => item.id)).toEqual(["first"]);
    expect(result.archived.map((item) => `${item.id}:${item.index}`)).toEqual(["second:2"]);
  });
});

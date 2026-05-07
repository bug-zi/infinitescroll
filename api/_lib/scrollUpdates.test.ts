import { describe, expect, it } from "vitest";
import { buildScrollUpdatePatch } from "./scrollUpdates";

describe("buildScrollUpdatePatch", () => {
  it("maps enabling auto generation to a generating scroll patch", () => {
    expect(buildScrollUpdatePatch({ autoGenerationEnabled: true }, "2026-05-07T00:00:00.000Z")).toEqual({
      auto_generation_enabled: true,
      status: "generating",
      updated_at: "2026-05-07T00:00:00.000Z",
    });
  });

  it("maps disabling auto generation to a paused scroll patch", () => {
    expect(buildScrollUpdatePatch({ autoGenerationEnabled: false }, "2026-05-07T00:00:00.000Z")).toEqual({
      auto_generation_enabled: false,
      status: "paused",
      updated_at: "2026-05-07T00:00:00.000Z",
    });
  });
});

import { describe, expect, it } from "vitest";
import { getCandidateScrollFilters, isStaleRunningJob } from "./generationPlan";

describe("getCandidateScrollFilters", () => {
  it("allows manual generation for a selected paused scroll", () => {
    expect(getCandidateScrollFilters({ scrollId: "scroll-1", manual: true, nowIso: "2026-05-07T07:00:00.000Z" })).toEqual({
      scrollId: "scroll-1",
      requireAutoEnabled: false,
      dueBeforeIso: undefined,
    });
  });

  it("keeps cron generation limited to enabled due scrolls", () => {
    expect(getCandidateScrollFilters({ nowIso: "2026-05-07T07:00:00.000Z" })).toEqual({
      scrollId: undefined,
      requireAutoEnabled: true,
      dueBeforeIso: "2026-05-07T07:00:00.000Z",
    });
  });
});

describe("isStaleRunningJob", () => {
  it("treats old running jobs as stale", () => {
    expect(
      isStaleRunningJob({
        lockedAt: "2026-05-07T06:40:00.000Z",
        nowIso: "2026-05-07T07:00:00.000Z",
        staleAfterMinutes: 15,
      }),
    ).toBe(true);
  });

  it("keeps recent running jobs active", () => {
    expect(
      isStaleRunningJob({
        lockedAt: "2026-05-07T06:50:00.000Z",
        nowIso: "2026-05-07T07:00:00.000Z",
        staleAfterMinutes: 15,
      }),
    ).toBe(false);
  });
});

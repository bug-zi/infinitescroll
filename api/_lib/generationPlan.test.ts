import { afterEach, describe, expect, it } from "vitest";
import {
  canPersistGeneratedJobResult,
  getCandidateScrollFilters,
  isStaleRunningJob,
  isStoryTargetBeyondEnd,
  shouldCompleteStoryAfterFrame,
} from "./generationPlan";

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
  const originalStaleMinutes = process.env.STALE_RUNNING_JOB_MINUTES;

  afterEach(() => {
    process.env.STALE_RUNNING_JOB_MINUTES = originalStaleMinutes;
  });

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

  it("keeps slow gpt-image-2 edit jobs active during the default stale window", () => {
    delete process.env.STALE_RUNNING_JOB_MINUTES;

    expect(
      isStaleRunningJob({
        lockedAt: "2026-05-07T06:40:00.000Z",
        nowIso: "2026-05-07T07:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("canPersistGeneratedJobResult", () => {
  it("allows the current running job to save a new target image", () => {
    expect(canPersistGeneratedJobResult({ jobStatus: "running", existingImageId: null })).toBe(true);
  });

  it("discards results from jobs that were already released for retry", () => {
    expect(canPersistGeneratedJobResult({ jobStatus: "failed", existingImageId: null })).toBe(false);
  });

  it("discards duplicate frame results when the target image already exists", () => {
    expect(canPersistGeneratedJobResult({ jobStatus: "running", existingImageId: "image-45" })).toBe(false);
  });
});

describe("story completion", () => {
  it("marks the last planned story frame as the completion point", () => {
    expect(
      shouldCompleteStoryAfterFrame({
        generationMode: "story",
        storyTotalFrames: 128,
        targetIndex: 128,
      }),
    ).toBe(true);
  });

  it("keeps story generation active before the last planned frame", () => {
    expect(
      shouldCompleteStoryAfterFrame({
        generationMode: "story",
        storyTotalFrames: 128,
        targetIndex: 127,
      }),
    ).toBe(false);
  });

  it("prevents generating frames beyond the planned story length", () => {
    expect(
      isStoryTargetBeyondEnd({
        generationMode: "story",
        storyTotalFrames: 128,
        targetIndex: 129,
      }),
    ).toBe(true);
  });

  it("does not apply story completion rules to free scrolls", () => {
    expect(
      shouldCompleteStoryAfterFrame({
        generationMode: "free",
        storyTotalFrames: 128,
        targetIndex: 128,
      }),
    ).toBe(false);
    expect(
      isStoryTargetBeyondEnd({
        generationMode: "free",
        storyTotalFrames: 128,
        targetIndex: 129,
      }),
    ).toBe(false);
  });
});

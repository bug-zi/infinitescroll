import { describe, expect, it } from "vitest";
import { buildSystemStatusFromRows } from "./systemStatus";

describe("API system status", () => {
  it("summarizes live Supabase rows for enabled scrolls and jobs", () => {
    const status = buildSystemStatusFromRows({
      now: new Date("2026-05-08T08:00:00.000Z"),
      maxConcurrentJobs: 3,
      scrolls: [{ id: "scroll-1", auto_generation_enabled: true, next_run_at: "2026-05-08T08:05:30.000Z" }],
      images: [{ id: "today", generated_at: "2026-05-07T16:30:00.000Z" }],
      jobs: [{ id: "running", status: "running" }, { id: "failed", status: "failed" }],
    });

    expect(status).toMatchObject({
      cronRunning: true,
      serviceRunning: true,
      autoGenerationEnabled: true,
      activeScrolls: 1,
      activeConcurrentJobs: 1,
      failedJobs: 1,
      generatedToday: 1,
      totalGenerated: 1,
      maxConcurrentJobs: 3,
      statusError: null,
    });
    expect(status.nextGlobalRunLabel).toBe("5 分 30 秒后");
  });

  it("flags the external scheduler when due work is overdue and no job is running", () => {
    const status = buildSystemStatusFromRows({
      now: new Date("2026-05-08T08:00:00.000Z"),
      externalSchedulerGraceMinutes: 7,
      scrolls: [{ id: "scroll-1", auto_generation_enabled: true, next_run_at: "2026-05-08T07:50:00.000Z" }],
      images: [],
      jobs: [],
    });

    expect(status.cronRunning).toBe(false);
    expect(status.serviceRunning).toBe(false);
    expect(status.nextGlobalRunLabel).toBe("待触发");
    expect(status.statusError).toContain("/api/cron/generate");
  });
});

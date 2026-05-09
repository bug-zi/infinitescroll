import { describe, expect, it } from "vitest";
import { buildNotifications, normalizeUserProfile } from "./userAccount";
import { mockJobs, mockLogs, mockScrolls, mockSystemStatus } from "../data/mockData";

describe("user account helpers", () => {
  it("normalizes persisted profile data", () => {
    expect(normalizeUserProfile({ displayName: "  阿源  ", notifications: { generationFailure: false } })).toMatchObject({
      displayName: "阿源",
      email: "yuer@example.com",
      avatarUrl: "",
      notifications: {
        generationFailure: false,
        generationSuccess: true,
      },
    });
  });

  it("keeps a configured avatar URL", () => {
    expect(normalizeUserProfile({ avatarUrl: "  https://example.com/avatar.png  " }).avatarUrl).toBe("https://example.com/avatar.png");
  });

  it("builds notifications from queue, logs, and system status", () => {
    const notifications = buildNotifications({
      logs: mockLogs,
      jobs: mockJobs,
      selectedScroll: mockScrolls[0],
      systemStatus: { ...mockSystemStatus, failedJobs: 2 },
      preferences: {
        generationSuccess: true,
        generationFailure: true,
        queueReminder: true,
      },
      now: new Date("2026-05-08T08:00:00.000Z"),
    });

    expect(notifications.some((item) => item.id === "system-failed-jobs")).toBe(true);
    expect(notifications.some((item) => item.action === "logs")).toBe(true);
  });
});

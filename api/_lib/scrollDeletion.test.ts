import { describe, expect, it } from "vitest";
import { calculatePurgeAfter, getStoragePathFromPublicUrl } from "./scrollDeletion";

describe("getStoragePathFromPublicUrl", () => {
  it("extracts a Supabase public storage object path", () => {
    expect(
      getStoragePathFromPublicUrl(
        "https://example.supabase.co/storage/v1/object/public/scroll-images/scrolls/abc/1-123.png",
        "scroll-images",
      ),
    ).toBe("scrolls/abc/1-123.png");
  });

  it("ignores local placeholder assets", () => {
    expect(getStoragePathFromPublicUrl("/assets/scroll-segment.svg", "scroll-images")).toBeNull();
  });

  it("ignores urls from another bucket", () => {
    expect(
      getStoragePathFromPublicUrl(
        "https://example.supabase.co/storage/v1/object/public/avatars/user.png",
        "scroll-images",
      ),
    ).toBeNull();
  });
});

describe("calculatePurgeAfter", () => {
  it("keeps archived scrolls for seven days", () => {
    expect(calculatePurgeAfter("2026-05-08T12:30:00.000Z")).toBe("2026-05-15T12:30:00.000Z");
  });
});

import { describe, expect, it } from "vitest";
import { getStoragePathFromPublicUrl } from "./scrollDeletion";

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

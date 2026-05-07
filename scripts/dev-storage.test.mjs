import { describe, expect, it, vi } from "vitest";
import { persistGeneratedImageToSupabase } from "./dev-storage.mjs";

describe("persistGeneratedImageToSupabase", () => {
  it("returns a Supabase Storage public URL after upload", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const getPublicUrl = vi.fn((path) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/scroll-images/${path}` } }));
    const from = vi.fn(() => ({ upload, getPublicUrl }));

    const url = await persistGeneratedImageToSupabase({
      supabase: { storage: { from } },
      bucket: "scroll-images",
      scrollId: "scroll-1",
      targetIndex: 4,
      generated: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
      now: () => 123,
    });

    expect(url).toBe("https://example.supabase.co/storage/v1/object/public/scroll-images/scrolls/scroll-1/4-123.png");
    expect(upload).toHaveBeenCalledWith("scrolls/scroll-1/4-123.png", new Uint8Array([1, 2, 3]), {
      contentType: "image/png",
      upsert: true,
    });
  });

  it("throws when Supabase Storage upload fails instead of returning a local URL", async () => {
    const upload = vi.fn(async () => ({ error: { message: "bucket missing" } }));
    const getPublicUrl = vi.fn();
    const from = vi.fn(() => ({ upload, getPublicUrl }));

    await expect(
      persistGeneratedImageToSupabase({
        supabase: { storage: { from } },
        bucket: "scroll-images",
        scrollId: "scroll-1",
        targetIndex: 4,
        generated: { bytes: new Uint8Array([1, 2, 3]) },
        now: () => 123,
      }),
    ).rejects.toThrow("Supabase Storage 上传失败：bucket missing");

    expect(getPublicUrl).not.toHaveBeenCalled();
  });
});

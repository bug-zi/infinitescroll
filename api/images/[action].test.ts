import { afterEach, describe, expect, it, vi } from "vitest";

const regenerateImage = vi.fn(async () => ({ imageId: "image-id", regenerated: true }));
const requestInsertImage = vi.fn(async () => ({ imageId: "image-id", side: "after", queued: true }));

vi.mock("../_lib/supabaseAdmin.js", () => ({
  createSupabaseAdmin: () => ({ id: "supabase-admin" }),
}));

vi.mock("../_lib/imageArchive.js", () => ({
  archiveImage: vi.fn(async () => ({ archived: true })),
  restoreImage: vi.fn(async () => ({ restored: true })),
}));

vi.mock("../_lib/scrollPurge.js", () => ({
  purgeImage: vi.fn(async () => ({ purged: true })),
}));

vi.mock("../_lib/imageMutations.js", () => ({
  regenerateImage,
  requestInsertImage,
}));

describe("POST /api/images/[action]", () => {
  afterEach(() => {
    regenerateImage.mockClear();
    requestInsertImage.mockClear();
    vi.resetModules();
  });

  it("dispatches regenerate image requests", async () => {
    const { default: handler } = await import("./[action].js");
    const response = createResponse();
    const imageId = "11111111-1111-4111-8111-111111111111";

    await handler({ method: "POST", query: { action: "regenerate" }, body: { imageId } } as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, regenerated: true });
    expect(regenerateImage).toHaveBeenCalledWith({ id: "supabase-admin" }, imageId);
  });

  it("dispatches insert image requests", async () => {
    const { default: handler } = await import("./[action].js");
    const response = createResponse();
    const imageId = "22222222-2222-4222-8222-222222222222";

    await handler({ method: "POST", query: { action: "insert" }, body: { imageId, side: "before" } } as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, queued: true });
    expect(requestInsertImage).toHaveBeenCalledWith({ id: "supabase-admin" }, imageId, "before");
  });
});

function createResponse() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader: vi.fn(),
  };
}

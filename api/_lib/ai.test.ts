import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { generateImage, generateOutpaintedImage } from "./ai";

describe("generateImage", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  it("sends the previous image as an input image when a reference is provided", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output: [{ type: "image_generation_call", result: Buffer.from("png").toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateImage("continue the scroll", Buffer.from("previous-image").toString("base64"));

    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const body = JSON.parse(fetchCalls[0][1].body);
    expect(body.input[0].content).toContainEqual({
      type: "input_image",
      image_url: `data:image/png;base64,${Buffer.from("previous-image").toString("base64")}`,
      detail: "high",
    });
  });
});

describe("generateOutpaintedImage", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  it("sends both the edit canvas and the full previous image to image edits", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("png").toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const previousImage = await sharp({
      create: {
        width: 1024,
        height: 768,
        channels: 3,
        background: { r: 120, g: 120, b: 120 },
      },
    })
      .png()
      .toBuffer();

    await generateOutpaintedImage("continue strictly from the previous segment", previousImage, 0.125);

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, { body: FormData }];
    const form = firstCall[1].body;
    const imageEntries = Array.from(form.entries()).filter(([key]) => key === "image[]");

    expect(imageEntries).toHaveLength(2);
    expect(form.get("input_fidelity")).toBe("high");
  });

  it("uses the final saved dimensions for outpaint canvas when they are provided", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("png").toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const previousImage = await sharp({
      create: {
        width: 1536,
        height: 1152,
        channels: 3,
        background: { r: 120, g: 120, b: 120 },
      },
    })
      .png()
      .toBuffer();

    await generateOutpaintedImage("continue strictly from the previous segment", previousImage, 0.25, "edge", 384, 1152, 1920);

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, { body: FormData }];
    const form = firstCall[1].body;
    const imageEntries = Array.from(form.entries()).filter(([key]) => key === "image[]");
    const canvas = imageEntries[0][1] as Blob;
    const mask = form.get("mask") as Blob;
    const canvasMetadata = await sharp(Buffer.from(await canvas.arrayBuffer())).metadata();
    const maskMetadata = await sharp(Buffer.from(await mask.arrayBuffer())).metadata();

    expect(form.get("size")).toBe("auto");
    expect(canvasMetadata.width).toBe(1920);
    expect(canvasMetadata.height).toBe(1152);
    expect(maskMetadata.width).toBe(1920);
    expect(maskMetadata.height).toBe(1152);
  });

  it("does not fall back to plain image generation when outpaint editing fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => new Response("edit failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const previousImage = await sharp({
      create: {
        width: 1024,
        height: 768,
        channels: 3,
        background: { r: 120, g: 120, b: 120 },
      },
    })
      .png()
      .toBuffer();

    const result = await generateOutpaintedImage("continue strictly from the previous segment", previousImage, 0.25, "edge", 230, 768);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.imageBytes).toBeUndefined();
    expect(result.model).toContain("outpaint");
  });
});

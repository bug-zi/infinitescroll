import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { generateImage, generateOutpaintedImage, getOpenAIKeyPool, optimizeThemeWithDeepSeek } from "./ai";

describe("optimizeThemeWithDeepSeek", () => {
  const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  const originalDeepSeekTimeout = process.env.DEEPSEEK_TIMEOUT_MS;

  afterEach(() => {
    process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
    process.env.DEEPSEEK_TIMEOUT_MS = originalDeepSeekTimeout;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks DeepSeek to preserve and strengthen the user's theme", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "围绕赛博敦煌夜市展开的连续横向画卷。" } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const prompt = await optimizeThemeWithDeepSeek("赛博敦煌夜市");

    const firstCall = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const body = JSON.parse(firstCall[1].body as string);
    expect(body.temperature).toBe(0.35);
    expect(body.messages[0].content).toContain("必须严格围绕用户主题");
    expect(body.messages[1].content).toContain("赛博敦煌夜市");
    expect(prompt).toContain("赛博敦煌夜市");
  });

  it("passes user requirements as hard style constraints during prompt optimization", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "红楼梦国风漫画长卷，不使用水墨。" } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await optimizeThemeWithDeepSeek("红楼梦", "不要用水墨画卷风格，采用国风漫画风格");

    const firstCall = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const body = JSON.parse(firstCall[1].body as string);
    expect(body.messages[0].content).toContain("用户明确禁止的风格、媒介、题材或元素");
    expect(body.messages[1].content).toContain("补充要求：不要用水墨画卷风格，采用国风漫画风格");
    expect(body.messages[1].content).toContain("不得在输出中重新加入这些被禁止的词");
  });

  it("falls back instead of hanging when DeepSeek aborts", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    process.env.DEEPSEEK_TIMEOUT_MS = "1";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new DOMException("aborted", "AbortError")), 5);
          }),
      ),
    );

    const prompt = await optimizeThemeWithDeepSeek("海底唐人街");

    expect(prompt).toContain("海底唐人街");
    expect(prompt).toContain("唯一核心主题");
  });
});

describe("generateImage", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalApiKeys = process.env.OPENAI_API_KEYS;
  const originalOpenAIModel = process.env.OPENAI_MODEL;
  const originalOpenAIResponseModel = process.env.OPENAI_RESPONSE_MODEL;
  const originalOpenAIImageModel = process.env.OPENAI_IMAGE_MODEL;
  const originalOpenAIImageModelFallbacks = process.env.OPENAI_IMAGE_MODEL_FALLBACKS;
  const originalOpenAIImageApiModel = process.env.OPENAI_IMAGE_API_MODEL;
  const originalOpenAIImageApiModelFallbacks = process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS;
  const originalOpenAIImageTimeout = process.env.OPENAI_IMAGE_TIMEOUT_MS;
  const originalOpenAIBaseUrl = process.env.OPENAI_BASE_URL;
  const originalOpenAIPreferImageApi = process.env.OPENAI_PREFER_IMAGE_API;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_API_KEYS = originalApiKeys;
    process.env.OPENAI_MODEL = originalOpenAIModel;
    process.env.OPENAI_RESPONSE_MODEL = originalOpenAIResponseModel;
    process.env.OPENAI_IMAGE_MODEL = originalOpenAIImageModel;
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = originalOpenAIImageModelFallbacks;
    process.env.OPENAI_IMAGE_API_MODEL = originalOpenAIImageApiModel;
    process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS = originalOpenAIImageApiModelFallbacks;
    process.env.OPENAI_IMAGE_TIMEOUT_MS = originalOpenAIImageTimeout;
    process.env.OPENAI_BASE_URL = originalOpenAIBaseUrl;
    process.env.OPENAI_PREFER_IMAGE_API = originalOpenAIPreferImageApi;
    vi.restoreAllMocks();
  });

  it("uses gpt-image-2 as the default Responses image tool model", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_MODEL = "";
    process.env.OPENAI_RESPONSE_MODEL = "gpt-5.5";
    process.env.OPENAI_IMAGE_MODEL = "";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output: [{ type: "image_generation_call", result: Buffer.from("png").toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage("continue the scroll");

    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(fetchCalls[0][1].body as string);
    expect(body.model).toBe("gpt-5.5");
    expect(body.tools[0].model).toBe("gpt-image-2");
    expect(result.model).toContain("gpt-5.5 + gpt-image-2");
  });

  it("falls back through gpt-image-1.5 and gpt-image-1 when the Responses image2 tool fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_IMAGE_MODEL = "";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "";
    process.env.OPENAI_IMAGE_API_MODEL = "";
    process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS = "";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("image2 failed", { status: 502 }))
      .mockResolvedValueOnce(new Response("image1.5 failed", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [{ type: "image_generation_call", result: Buffer.from("png").toString("base64") }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage("continue the scroll");

    const toolModels = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string).tools[0].model);
    expect(toolModels).toEqual(["gpt-image-2", "gpt-image-1.5", "gpt-image-1"]);
    expect(result.model).toContain("gpt-image-1");
  });

  it("uses the Image API with gpt-image-2 when all Responses image tools fail", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_IMAGE_MODEL = "";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "";
    process.env.OPENAI_IMAGE_API_MODEL = "";
    process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS = "";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("image2 failed", { status: 502 }))
      .mockResolvedValueOnce(new Response("image1.5 failed", { status: 502 }))
      .mockResolvedValueOnce(new Response("image1 failed", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("png").toString("base64") }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage("continue the scroll");

    const imageApiCall = fetchMock.mock.calls[3] as unknown as [string, RequestInit];
    expect(imageApiCall[0]).toContain("/images/generations");
    expect(JSON.parse(imageApiCall[1].body as string).model).toBe("gpt-image-2");
    expect(result.model).toContain("gpt-image-2");
  });

  it("prefers the Image API before Responses for custom OpenAI-compatible base URLs", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_BASE_URL = "https://token.example.test/v1";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "";
    process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS = "";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("png").toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage("continue the scroll", Buffer.from("reference").toString("base64"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(firstCall[0])).toBe("https://token.example.test/v1/images/generations");
    expect(JSON.parse(firstCall[1].body as string).model).toBe("gpt-image-2");
    expect(result.imageBytes).toBeDefined();
    expect(result.model).toContain("gpt-image-2");
  });

  it("compacts long storyboard prompts before sending them to custom gateway Image API", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_BASE_URL = "https://token.example.test/v1";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "";
    process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS = "";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("png").toString("base64") }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const prompt = [
      "Create one frame of a sequential story handscroll.",
      "A reference image is attached. Use it only for palette, paper texture, and scroll transition.",
      "User theme: 红楼梦",
      "Long-term scroll direction: 国风漫画彩色分镜，禁止水墨画卷风格。",
      "This is story frame 36 of 128. Depict only this storyboard frame.",
      "Title: 湘云醉卧",
      "Characters: 贾宝玉, 林黛玉, 薛宝钗, 史湘云, 袭人",
      "Location: 大观园各处",
      "New scene: 史湘云醉卧芍药裀，花瓣落满衣裙，丫鬟含笑相扶。",
      "Forbidden drift: 不得水墨化，不得工笔重彩化，不得提前画后续剧情。",
      "No modern objects, no text labels, no UI, no frame, no watermark.",
      "Unneeded continuity prose: " + "x".repeat(3000),
    ].join("\n");

    await generateImage(prompt, Buffer.from("reference").toString("base64"));

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(firstCall[1].body as string);
    expect(body.prompt.length).toBeLessThanOrEqual(700);
    expect(body.prompt).toContain("湘云醉卧");
    expect(body.prompt).toContain("史湘云醉卧");
    expect(body.prompt).toContain("国风漫画彩色分镜");
    expect(body.prompt).not.toContain("A reference image is attached");
    expect(body.prompt).not.toContain("Long-term scroll direction");
    expect(body.prompt).not.toContain("Unneeded continuity prose");
  });

  it("returns a local fallback image when every remote provider fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "gpt-image-2";
    process.env.OPENAI_IMAGE_API_MODEL = "gpt-image-2";
    process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS = "gpt-image-2";
    const fetchMock = vi.fn(async () => new Response("all providers failed", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage("continue the scroll");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.imageBytes).toBeDefined();
    expect(result.mimeType).toBe("image/png");
    expect(result.model).toContain("local fallback");
  });

  it("falls back to the Image API when the Responses image tool times out", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_IMAGE_TIMEOUT_MS = "1";
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("png").toString("base64") }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage("continue the scroll");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/responses");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/images/generations");
    expect(result.imageBytes).toBeDefined();
    expect(result.model).toContain("gpt-image-2");
  });

  it("treats SDK abort errors as timeouts before Image API fallback", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    const sdkAbortError = Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(sdkAbortError)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("png").toString("base64") }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage("continue the scroll");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/images/generations");
    expect(result.imageBytes).toBeDefined();
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

  it("rotates to the next key when the first image generation key fails", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.OPENAI_API_KEYS = "first-key,second-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [{ type: "image_generation_call", result: Buffer.from("png").toString("base64") }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage("continue the scroll");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer first-key" });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer second-key" });
    expect(result.imageBytes).toBeDefined();
    expect(result.model).toContain("key #2");
  });

  it("deduplicates the key pool", () => {
    process.env.OPENAI_API_KEY = "primary";
    process.env.OPENAI_API_KEYS = "primary,backup";
    expect(getOpenAIKeyPool()).toEqual(["primary", "backup"]);
  });
});

describe("generateOutpaintedImage", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalApiKeys = process.env.OPENAI_API_KEYS;
  const originalOpenAIImageModel = process.env.OPENAI_IMAGE_MODEL;
  const originalOpenAIImageModelFallbacks = process.env.OPENAI_IMAGE_MODEL_FALLBACKS;
  const originalOpenAIImageApiModel = process.env.OPENAI_IMAGE_API_MODEL;
  const originalOpenAIImageApiModelFallbacks = process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS;
  const originalOpenAIImageTimeout = process.env.OPENAI_IMAGE_TIMEOUT_MS;
  const originalOpenAIImageEditTimeout = process.env.OPENAI_IMAGE_EDIT_TIMEOUT_MS;
  const originalOpenAIBaseUrl = process.env.OPENAI_BASE_URL;
  const originalOpenAIPreferImageApi = process.env.OPENAI_PREFER_IMAGE_API;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_API_KEYS = originalApiKeys;
    process.env.OPENAI_IMAGE_MODEL = originalOpenAIImageModel;
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = originalOpenAIImageModelFallbacks;
    process.env.OPENAI_IMAGE_API_MODEL = originalOpenAIImageApiModel;
    process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS = originalOpenAIImageApiModelFallbacks;
    process.env.OPENAI_IMAGE_TIMEOUT_MS = originalOpenAIImageTimeout;
    process.env.OPENAI_IMAGE_EDIT_TIMEOUT_MS = originalOpenAIImageEditTimeout;
    process.env.OPENAI_BASE_URL = originalOpenAIBaseUrl;
    process.env.OPENAI_PREFER_IMAGE_API = originalOpenAIPreferImageApi;
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
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("input_fidelity")).toBeNull();
  });

  it("sends the first frame as an additional style reference during outpaint edits", async () => {
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
    const styleReferenceImage = await sharp({
      create: {
        width: 1024,
        height: 768,
        channels: 3,
        background: { r: 180, g: 140, b: 90 },
      },
    })
      .png()
      .toBuffer();

    await generateOutpaintedImage(
      "continue strictly from the previous segment",
      previousImage,
      0.125,
      undefined,
      undefined,
      undefined,
      undefined,
      styleReferenceImage.toString("base64"),
    );

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, { body: FormData }];
    const imageEntries = Array.from(firstCall[1].body.entries()).filter(([key]) => key === "image[]");

    expect(imageEntries).toHaveLength(3);
  });

  it("keeps input_fidelity for older edit model fallbacks", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_IMAGE_API_MODEL = "";
    process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS = "";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("image2 edit failed", { status: 502 }))
      .mockResolvedValueOnce(
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

    const result = await generateOutpaintedImage("continue strictly from the previous segment", previousImage, 0.125);

    const firstForm = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    const secondForm = (fetchMock.mock.calls[1][1] as RequestInit).body as FormData;
    expect(firstForm.get("model")).toBe("gpt-image-2");
    expect(firstForm.get("input_fidelity")).toBeNull();
    expect(secondForm.get("model")).toBe("gpt-image-1.5");
    expect(secondForm.get("input_fidelity")).toBe("high");
    expect(result.model).toContain("gpt-image-1.5");
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

  it("does not fall back to stitched reference generation when outpaint editing is unavailable", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("edit image2 failed", { status: 503 }))
      .mockResolvedValueOnce(new Response("edit image1.5 failed", { status: 503 }))
      .mockResolvedValueOnce(new Response("edit image1 failed", { status: 503 }));
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

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(fetchCalls.every((call) => String(call[0]).includes("/images/edits"))).toBe(true);
    expect(result.imageBytes).toBeUndefined();
    expect(result.model).toContain("edit-outpaint failed");
  });

  it("still tries outpaint editing for custom OpenAI-compatible gateways", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_BASE_URL = "https://token.example.test/v1";
    process.env.OPENAI_IMAGE_MODEL_FALLBACKS = "";
    process.env.OPENAI_IMAGE_API_MODEL_FALLBACKS = "";
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

    const result = await generateOutpaintedImage("Title: 湘云醉卧\nNew scene: 史湘云醉卧芍药裀。", previousImage, 0.25, "edge", 230, 768);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(firstCall[0])).toBe("https://token.example.test/v1/images/edits");
    expect(result.imageBytes).toBeDefined();
    expect(result.model).toContain("edit-outpaint");
  });

  it("does not try every edit fallback when outpaint editing times out", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_API_KEYS = "";
    process.env.OPENAI_IMAGE_EDIT_TIMEOUT_MS = "1";
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      });
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
    expect(String(fetchMock.mock.calls[0][0])).toContain("/images/edits");
    expect(result.imageBytes).toBeUndefined();
    expect(result.model).toContain("edit-outpaint failed");
  });

  it("rotates to the next key when image edit fails", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.OPENAI_API_KEYS = "first-key,second-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(
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

    const result = await generateOutpaintedImage("continue strictly from the previous segment", previousImage, 0.25, "edge", 230, 768);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer first-key" });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer second-key" });
    expect(result.imageBytes).toBeDefined();
    expect(result.model).toContain("key #2");
  });
});

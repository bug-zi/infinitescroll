import { afterEach, describe, expect, it, vi } from "vitest";

describe("POST /api/scripts/draft", () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;

  afterEach(() => {
    process.env.DEEPSEEK_API_KEY = originalKey;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns a normalized editable script draft with the requested frame count", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    const content = JSON.stringify({
      title: "星海邮差",
      summary: "少年递送星信。",
      visualStyle: "复古科幻连环画。",
      characterBible: "阿澈：红围巾少年。",
      frames: Array.from({ length: 24 }, (_, index) => ({
        chapter: index < 12 ? "启程" : "远航",
        title: `第${index + 1}幕`,
        scene: `第${index + 1}个画面。`,
        characters: ["阿澈"],
        location: "星海岸",
        mood: "明亮",
      })),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })),
    );

    const { default: handler } = await import("./draft.js");
    const response = createResponse();
    await handler({ method: "POST", body: { theme: "星海邮差", frameCount: 24, requirements: "少年冒险" } } as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      draft: {
        title: "星海邮差",
        frames: expect.any(Array),
      },
    });
    expect((response.body as any).draft.frames).toHaveLength(24);
    expect((response.body as any).draft.frames[0]).toMatchObject({ frameIndex: 1, title: "第1幕" });
  });

  it("passes style requirements as hard constraints to DeepSeek script drafting", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    const content = JSON.stringify({
      title: "红楼梦",
      summary: "原著主线国风漫画分镜。",
      visualStyle: "国风漫画彩色分镜。",
      characterBible: "宝玉、黛玉、宝钗保持彩色漫画设定。",
      frames: Array.from({ length: 24 }, (_, index) => ({
        frameIndex: index + 1,
        chapter: "黛玉进府",
        title: `第${index + 1}幕`,
        scene: `第${index + 1}个红楼梦画面。`,
        characters: ["林黛玉"],
        location: "荣国府",
        mood: "华贵",
        forbidden: "不得水墨化，不得提前画后续剧情。",
        visualPromptHint: "国风漫画彩色分镜。",
      })),
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { default: handler } = await import("./draft.js");
    const response = createResponse();
    await handler(
      {
        method: "POST",
        body: {
          theme: "红楼梦",
          frameCount: 24,
          requirements: "不要用水墨画卷风格，采用国风漫画风格",
          stylePrompt: "国风漫画彩色分镜",
        },
      } as never,
      response as never,
    );

    const firstCall = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const body = JSON.parse(firstCall[1].body as string);
    expect(body.messages[0].content).toContain("用户明确禁止的风格、媒介、题材或元素");
    expect(body.messages[1].content).toContain("补充要求：不要用水墨画卷风格，采用国风漫画风格");
    expect(body.messages[1].content).toContain("forbidden 必须逐帧写入这些禁止项");
  });

  it("rejects invalid DeepSeek JSON instead of silently creating a weak script", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "{\"frames\":[]}" } }] }), { status: 200 })),
    );

    const { default: handler } = await import("./draft.js");
    const response = createResponse();
    await handler({ method: "POST", body: { theme: "星海邮差", frameCount: 24 } } as never, response as never);

    expect(response.statusCode).toBe(500);
    expect((response.body as any).error).toContain("Expected 24 script frames");
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

import { afterEach, describe, expect, it, vi } from "vitest";

const insertPayloads: unknown[] = [];

vi.mock("../_lib/supabaseAdmin.js", () => ({
  createSupabaseAdmin: () => ({
    from: (table: string) => ({
      insert: (payload: unknown) => {
        insertPayloads.push({ table, payload });
        return {
          select: () => ({
            single: async () => ({ data: { id: "scroll-1", ...(payload as Record<string, unknown>) }, error: null }),
          }),
          then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
        };
      },
    }),
  }),
}));

describe("POST /api/scrolls/create", () => {
  afterEach(() => {
    insertPayloads.length = 0;
    vi.resetModules();
  });

  it("creates a blank paused scroll without queuing a template image", async () => {
    const { default: handler } = await import("./create.js");
    const response = {
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

    await handler(
      { method: "POST", body: { theme: "赛博敦煌夜市", optimizedPrompt: "霓虹与飞天壁画融合" } } as never,
      response as never,
    );

    const scrollInsert = insertPayloads.find((entry) => (entry as { table: string }).table === "scrolls") as { payload: Record<string, unknown> };
    const jobInsert = insertPayloads.find((entry) => (entry as { table: string }).table === "generation_jobs");

    expect(response.statusCode).toBe(200);
    expect(scrollInsert.payload).toMatchObject({
      original_theme: "赛博敦煌夜市",
      optimized_prompt: "霓虹与飞天壁画融合",
      generation_mode: "free",
      story_template: null,
      status: "paused",
      auto_generation_enabled: false,
      image_count: 0,
      last_generated_at: null,
    });
    expect(jobInsert).toBeUndefined();
  });

  it("marks Journey to the West scrolls as story mode while staying blank", async () => {
    const { default: handler } = await import("./create.js");
    const response = {
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

    await handler({ method: "POST", body: { theme: "西游记连环画", optimizedPrompt: "经典取经主线" } } as never, response as never);

    const scrollInsert = insertPayloads.find((entry) => (entry as { table: string }).table === "scrolls") as { payload: Record<string, unknown> };
    const jobInsert = insertPayloads.find((entry) => (entry as { table: string }).table === "generation_jobs");

    expect(response.statusCode).toBe(200);
    expect(scrollInsert.payload).toMatchObject({
      generation_mode: "story",
      story_template: "journey_to_west",
      story_template_version: "v1",
      story_total_frames: 128,
      auto_generation_enabled: false,
      image_count: 0,
    });
    expect(jobInsert).toBeUndefined();
  });

  it("creates an ai_script scroll and persists its storyboard frames", async () => {
    const { default: handler } = await import("./create.js");
    const response = {
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

    await handler(
      {
        method: "POST",
        body: {
          theme: "星海邮差",
          optimizedPrompt: "复古科幻连环画。",
          generationMode: "story",
          storyTemplate: "ai_script",
          storyTemplateVersion: "v1",
          storyTotalFrames: 2,
          storyFrames: [
            { frameIndex: 1, chapter: "启程", title: "收到星信", scene: "阿澈收到发光信件。" },
            { frameIndex: 2, chapter: "启程", title: "潮汐星门", scene: "潮汐升起为星门。" },
          ],
        },
      } as never,
      response as never,
    );

    const scrollInsert = insertPayloads.find((entry) => (entry as { table: string }).table === "scrolls") as { payload: Record<string, unknown> };
    const frameInsert = insertPayloads.find((entry) => (entry as { table: string }).table === "scroll_story_frames") as { payload: Array<Record<string, unknown>> };

    expect(response.statusCode).toBe(200);
    expect(scrollInsert.payload).toMatchObject({
      generation_mode: "story",
      story_template: "ai_script",
      story_template_version: "v1",
      story_total_frames: 2,
      status: "paused",
      image_count: 0,
    });
    expect(frameInsert.payload).toHaveLength(2);
    expect(frameInsert.payload[0]).toMatchObject({
      scroll_id: "scroll-1",
      frame_index: 1,
      title: "收到星信",
      scene: "阿澈收到发光信件。",
    });
  });
});

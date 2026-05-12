import { describe, expect, it } from "vitest";
import { regenerateImage, requestInsertImage } from "./imageMutations";

describe("imageMutations", () => {
  it("queues regeneration from the selected frame", async () => {
    const supabase = createSupabaseMock({ anchorIndex: 33, imageCount: 37 });

    const result = await regenerateImage(supabase as never, "11111111-1111-4111-8111-111111111111");

    expect(result).toMatchObject({ regenerated: true, rebuild: { startIndex: 33, targetCount: 37, queued: true } });
    expect(supabase.operations).toContainEqual({ table: "scroll_images", action: "delete", filters: [["eq", "scroll_id", "scroll-1"], ["gte", "image_index", 33]] });
    expect(supabase.operations).toContainEqual({
      table: "generation_jobs",
      action: "update",
      payload: expect.objectContaining({ status: "cancelled" }),
      filters: [["eq", "scroll_id", "scroll-1"], ["eq", "status", "queued"], ["gte", "target_index", 33]],
    });
    expect(supabase.operations).toContainEqual({
      table: "scrolls",
      action: "update",
      payload: expect.objectContaining({ image_count: 32, status: "generating", auto_generation_enabled: true }),
      filters: [["eq", "id", "scroll-1"]],
    });
    expect(supabase.operations).toContainEqual({
      table: "generation_jobs",
      action: "insert",
      payload: expect.objectContaining({ scroll_id: "scroll-1", target_index: 33, type: "regenerate", status: "queued" }),
    });
  });

  it("queues insertion after the selected frame", async () => {
    const supabase = createSupabaseMock({ anchorIndex: 37, imageCount: 37 });

    const result = await requestInsertImage(supabase as never, "22222222-2222-4222-8222-222222222222", "after");

    expect(result).toMatchObject({ side: "after", targetIndex: 38, rebuild: { startIndex: 38, targetCount: 38 } });
    expect(supabase.operations).toContainEqual({
      table: "generation_jobs",
      action: "insert",
      payload: expect.objectContaining({ target_index: 38, type: "insert_after", status: "queued" }),
    });
  });
});

function createSupabaseMock(input: { anchorIndex: number; imageCount: number }) {
  const operations: Array<Record<string, unknown>> = [];
  return {
    operations,
    from(table: string) {
      return createBuilder({ table, operations, input });
    },
  };
}

function createBuilder({
  table,
  operations,
  input,
}: {
  table: string;
  operations: Array<Record<string, unknown>>;
  input: { anchorIndex: number; imageCount: number };
}) {
  const filters: Array<[string, string, unknown]> = [];
  let action = "select";
  let payload: unknown;
  const builder = {
    select() {
      action = "select";
      return builder;
    },
    delete() {
      action = "delete";
      return builder;
    },
    update(nextPayload: unknown) {
      action = "update";
      payload = nextPayload;
      return builder;
    },
    insert(nextPayload: unknown) {
      action = "insert";
      payload = nextPayload;
      operations.push({ table, action, payload });
      return Promise.resolve({ error: null });
    },
    eq(column: string, value: unknown) {
      filters.push(["eq", column, value]);
      return builder;
    },
    gte(column: string, value: unknown) {
      filters.push(["gte", column, value]);
      return builder;
    },
    single() {
      if (table === "scroll_images") {
        return Promise.resolve({ data: { id: "image-id", scroll_id: "scroll-1", image_index: input.anchorIndex }, error: null });
      }
      if (table === "scrolls") {
        return Promise.resolve({ data: { id: "scroll-1", image_count: input.imageCount }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (value: { error: null }) => void) {
      operations.push({ table, action, payload, filters: [...filters] });
      resolve({ error: null });
    },
  };
  return builder;
}

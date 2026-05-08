import { describe, expect, it } from "vitest";
import { formatUnknownError } from "./errorFormatting";

describe("formatUnknownError", () => {
  it("keeps Supabase error codes and messages visible", () => {
    expect(
      formatUnknownError({
        code: "PGRST204",
        message: "Could not find the 'creative_plan' column of 'generation_jobs' in the schema cache",
      }),
    ).toBe("PGRST204: Could not find the 'creative_plan' column of 'generation_jobs' in the schema cache");
  });

  it("falls back to JSON for non-Error objects", () => {
    expect(formatUnknownError({ reason: "schema cache stale", retryable: true })).toBe(
      '{"reason":"schema cache stale","retryable":true}',
    );
  });
});

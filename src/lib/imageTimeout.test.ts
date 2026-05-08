import { describe, expect, it } from "vitest";
import { getImageRequestTimeoutMs } from "./imageTimeout";

describe("getImageRequestTimeoutMs", () => {
  it("defaults image edit requests to the full generation timeout", () => {
    expect(getImageRequestTimeoutMs({ GENERATION_TIMEOUT_MS: String(12 * 60 * 1000) })).toBe(12 * 60 * 1000);
  });

  it("does not let the image request timeout be shorter than the generation timeout", () => {
    expect(
      getImageRequestTimeoutMs({
        GENERATION_TIMEOUT_MS: String(12 * 60 * 1000),
        OPENAI_IMAGE_TIMEOUT_MS: String(5 * 60 * 1000),
      }),
    ).toBe(12 * 60 * 1000);
  });
});

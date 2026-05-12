import { describe, expect, it } from "vitest";
import { getImageEditRequestTimeoutMs, getImageRequestTimeoutMs } from "./imageTimeout";

describe("getImageRequestTimeoutMs", () => {
  it("defaults image requests to a shorter per-request timeout", () => {
    expect(getImageRequestTimeoutMs({ GENERATION_TIMEOUT_MS: String(12 * 60 * 1000) })).toBe(4 * 60 * 1000);
  });

  it("allows custom OpenAI-compatible gateways to wait almost the full generation window", () => {
    expect(
      getImageRequestTimeoutMs({
        GENERATION_TIMEOUT_MS: String(12 * 60 * 1000),
        OPENAI_BASE_URL: "https://token.aiedulab.cn/v1",
      }),
    ).toBe(11 * 60 * 1000);
  });

  it("allows the image request timeout to be shorter than the generation timeout", () => {
    expect(
      getImageRequestTimeoutMs({
        GENERATION_TIMEOUT_MS: String(12 * 60 * 1000),
        OPENAI_IMAGE_TIMEOUT_MS: String(5 * 60 * 1000),
      }),
    ).toBe(5 * 60 * 1000);
  });

  it("caps image request timeout at the full generation timeout", () => {
    expect(
      getImageRequestTimeoutMs({
        GENERATION_TIMEOUT_MS: String(60 * 1000),
        OPENAI_IMAGE_TIMEOUT_MS: String(5 * 60 * 1000),
      }),
    ).toBe(60 * 1000);
  });

  it("uses a shorter default timeout for image edit outpainting", () => {
    expect(getImageEditRequestTimeoutMs({ GENERATION_TIMEOUT_MS: String(12 * 60 * 1000) })).toBe(45 * 1000);
  });

  it("allows custom OpenAI-compatible gateways to wait longer for image edit outpainting", () => {
    expect(
      getImageEditRequestTimeoutMs({
        GENERATION_TIMEOUT_MS: String(12 * 60 * 1000),
        OPENAI_BASE_URL: "https://token.aiedulab.cn/v1",
      }),
    ).toBe(11 * 60 * 1000);
  });

  it("does not let image edit timeout exceed the image request timeout", () => {
    expect(
      getImageEditRequestTimeoutMs({
        GENERATION_TIMEOUT_MS: String(12 * 60 * 1000),
        OPENAI_IMAGE_TIMEOUT_MS: String(60 * 1000),
        OPENAI_IMAGE_EDIT_TIMEOUT_MS: String(5 * 60 * 1000),
      }),
    ).toBe(60 * 1000);
  });
});

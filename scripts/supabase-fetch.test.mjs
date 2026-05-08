import { describe, expect, it, vi } from "vitest";
import { createTimeoutFetch } from "./supabase-fetch.mjs";

describe("createTimeoutFetch", () => {
  it("aborts a slow request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    vi.stubGlobal("fetch", fetchMock);

    const expectation = expect(createTimeoutFetch(25)("https://example.test")).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

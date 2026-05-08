import { describe, expect, it } from "vitest";
import { isCronRequestAuthorized } from "./cronAuth";

describe("isCronRequestAuthorized", () => {
  it("allows requests when no cron secret is configured", () => {
    expect(isCronRequestAuthorized(undefined, "")).toBe(true);
  });

  it("requires a matching bearer token when a cron secret exists", () => {
    expect(isCronRequestAuthorized("Bearer secret-value", "secret-value")).toBe(true);
    expect(isCronRequestAuthorized("Bearer wrong", "secret-value")).toBe(false);
    expect(isCronRequestAuthorized(undefined, "secret-value")).toBe(false);
  });
});

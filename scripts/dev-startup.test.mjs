import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local dev startup", () => {
  it("serves the local API from Vite instead of proxying to port 5180", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const viteConfig = readFileSync("vite.config.ts", "utf8");

    expect(packageJson.scripts.dev).toBe("vite --host 127.0.0.1");
    expect(viteConfig).toContain("loadDevApiModule");
    expect(viteConfig).toContain("startLocalScheduler");
    expect(viteConfig).toContain("process.env.VITEST");
    expect(viteConfig).not.toContain("127.0.0.1");
    expect(viteConfig).not.toContain("5180");
    expect(viteConfig).not.toContain("http.request");
  });
});

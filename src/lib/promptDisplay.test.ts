import { describe, expect, test } from "vitest";
import { summarizePrompt } from "./promptDisplay";

describe("prompt display helpers", () => {
  test("prefers the visible creative plan line over the full technical prompt", () => {
    const prompt = [
      "Theme: 清明上河图风格长卷",
      "Creative plan for this exact segment:",
      "Continuity anchor: 锁定上一张右缘的河道水线。",
      "本张计划：展开桥头人潮、货担队列、临水店铺、船工与看客。",
      "No modern objects, no text labels, no UI.",
    ].join("\n");

    expect(summarizePrompt(prompt)).toBe("本张计划：展开桥头人潮、货担队列、临水店铺、船工与看客。");
  });

  test("truncates long prompts for the inspector", () => {
    const summary = summarizePrompt("A".repeat(200), 20);

    expect(summary).toBe(`${"A".repeat(19)}…`);
  });

  test("shows an empty state when no prompt exists", () => {
    expect(summarizePrompt("   ")).toBe("暂无提示词");
  });
});

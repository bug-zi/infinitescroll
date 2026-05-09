import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./App";

describe("App script mode create wizard", () => {
  it("offers script mode controls in the create wizard", () => {
    const html = renderToStaticMarkup(<App initialCreateScrollOpen />);

    expect(html).toContain("开启编剧模式");
    expect(html).toContain("剧本长度");
    expect(html).toContain("生成长剧本分镜");
  });
});

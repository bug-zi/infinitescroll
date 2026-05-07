import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const title = "清明上河图风格画卷";
const originalTheme = "参照《清明上河图》的风格，绘制北宋汴京城的繁华市井与自然风光";
const optimizedPrompt =
  "以《清明上河图》为风格蓝本，采用北宋时期的细密线描与淡雅设色。画面从左至右连续展开汴河两岸、虹桥、舟船、街市、茶楼酒肆、城门车马与往来行人，保持道路、水系、建筑和人群方向自然衔接。";

const { data: scrolls, error } = await supabase.from("scrolls").select("id").order("created_at", { ascending: false }).limit(1);
if (error) throw error;
const id = scrolls?.[0]?.id;
if (!id) throw new Error("No scroll found");

await supabase
  .from("scrolls")
  .update({
    title,
    original_theme: originalTheme,
    optimized_prompt: optimizedPrompt,
    updated_at: new Date().toISOString(),
  })
  .eq("id", id);

await supabase
  .from("scroll_images")
  .update({
    model: "历史占位图",
    prompt: "历史占位图片，用于界面和衔接流程预览；不是正式清明上河图生成结果。",
  })
  .eq("scroll_id", id)
  .eq("full_image_url", "/assets/scroll-segment.svg");

console.log(JSON.stringify({ fixed: id, title, originalTheme }, null, 2));

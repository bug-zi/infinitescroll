import type { VercelRequest, VercelResponse } from "@vercel/node";
import { optimizeThemeWithDeepSeek } from "../_lib/ai";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin";

const FIXED_OVERLAP_PRESET = "maximum";
const FIXED_OVERLAP_RATIO = 0.25;

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const theme = typeof request.body?.theme === "string" ? request.body.theme.trim() : "";
  if (!theme) {
    response.status(400).json({ error: "theme is required" });
    return;
  }

  try {
    const supabase = createSupabaseAdmin();
    const optimizedPrompt = await optimizeThemeWithDeepSeek(theme);
    const nextRunAt = new Date(Date.now() + 300000).toISOString();

    const { data: scroll, error: scrollError } = await supabase
      .from("scrolls")
      .insert({
        title: `${theme.slice(0, 12)}画卷`,
        original_theme: theme,
        optimized_prompt: optimizedPrompt,
        status: "generating",
        auto_generation_enabled: true,
        interval_minutes: 5,
        overlap_preset: FIXED_OVERLAP_PRESET,
        overlap_ratio: FIXED_OVERLAP_RATIO,
        image_count: 0,
        next_run_at: nextRunAt,
        last_generated_at: new Date().toISOString(),
        thumbnail_url: "/assets/scroll-segment.svg",
      })
      .select()
      .single();

    if (scrollError) throw scrollError;

    const { error: jobError } = await supabase.from("generation_jobs").insert({
      scroll_id: scroll.id,
      target_index: 1,
      type: "auto_next",
      status: "queued",
      scheduled_for: nextRunAt,
    });

    if (jobError) throw jobError;

    await supabase.from("generation_logs").insert({
      scroll_id: scroll.id,
      level: "success",
      message: "画卷已创建",
      detail: "第一张图片任务已进入队列",
    });

    response.status(200).json({ ok: true, scroll });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Create scroll failed",
    });
  }
}

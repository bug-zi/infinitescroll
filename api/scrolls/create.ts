import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { detectStoryMode } from "../../src/lib/storyMode";
import {
  AI_SCRIPT_TEMPLATE,
  AI_SCRIPT_TEMPLATE_VERSION,
  normalizeScriptFrame,
  scriptFrameToInsert,
  type ScriptFrame,
} from "../../src/lib/scriptDraft";

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
    const optimizedPrompt = typeof request.body?.optimizedPrompt === "string" ? request.body.optimizedPrompt.trim() : "";
    const scriptFramesInput = Array.isArray(request.body?.storyFrames) ? request.body.storyFrames : [];
    const wantsAiScript = request.body?.generationMode === "story" && request.body?.storyTemplate === AI_SCRIPT_TEMPLATE;
    const storyFrames: ScriptFrame[] = wantsAiScript ? scriptFramesInput.map((frame: unknown, index: number) => normalizeScriptFrame(frame, index + 1)) : [];
    const detectedStoryMode = detectStoryMode(theme, optimizedPrompt);
    const storyMode = wantsAiScript
      ? {
          generationMode: "story" as const,
          storyTemplate: AI_SCRIPT_TEMPLATE,
          storyTemplateVersion: AI_SCRIPT_TEMPLATE_VERSION,
          storyTotalFrames: storyFrames.length,
        }
      : detectedStoryMode;

    const { data: scroll, error: scrollError } = await supabase
      .from("scrolls")
      .insert({
        title: `${theme.slice(0, 12)}画卷`,
        original_theme: theme,
        optimized_prompt: optimizedPrompt,
        generation_mode: storyMode.generationMode,
        story_template: storyMode.storyTemplate,
        story_template_version: storyMode.storyTemplateVersion,
        story_total_frames: storyMode.storyTotalFrames,
        script_summary: typeof request.body?.scriptSummary === "string" ? request.body.scriptSummary.trim() : null,
        character_bible: typeof request.body?.characterBible === "string" ? request.body.characterBible.trim() : null,
        status: "paused",
        auto_generation_enabled: false,
        interval_minutes: 5,
        overlap_preset: FIXED_OVERLAP_PRESET,
        overlap_ratio: FIXED_OVERLAP_RATIO,
        image_count: 0,
        next_run_at: new Date(Date.now() + 300000).toISOString(),
        last_generated_at: null,
        thumbnail_url: "/assets/scroll-segment.svg",
      })
      .select()
      .single();

    if (scrollError) throw scrollError;

    if (storyFrames.length) {
      const { error: frameError } = await supabase.from("scroll_story_frames").insert(storyFrames.map((frame: ScriptFrame) => scriptFrameToInsert(scroll.id, frame)));
      if (frameError) throw frameError;
    }

    await supabase.from("generation_logs").insert({
      scroll_id: scroll.id,
      level: "success",
      message: "空白画卷已创建",
      detail: "尚未生成图片。点击立即生成或开启自动生成后开始绘制。",
    });

    response.status(200).json({ ok: true, scroll });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Create scroll failed",
    });
  }
}

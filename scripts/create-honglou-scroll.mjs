import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const AI_SCRIPT_TEMPLATE = "ai_script";
const AI_SCRIPT_TEMPLATE_VERSION = "v1";
const FIXED_OVERLAP_PRESET = "maximum";
const FIXED_OVERLAP_RATIO = 0.25;

export const DREAM_OF_RED_MANSIONS_TOTAL_FRAMES = 128;
export const DREAM_OF_RED_MANSIONS_TITLE = "红楼梦国风漫画画卷";
export const DREAM_OF_RED_MANSIONS_THEME = "红楼梦";
export const DREAM_OF_RED_MANSIONS_VISUAL_STYLE =
  "《红楼梦》原著主线 128 帧横向长卷，采用国风漫画风格和彩色分镜语言：细净勾线、柔和赛璐璐上色、清代贵族服饰、大观园建筑与人物群像统一设定；禁止水墨画卷风格、墨色渲染、宣纸晕染、留白山水、工笔重彩和清明上河图式市井空景。";
export const DREAM_OF_RED_MANSIONS_SUMMARY =
  "以通行 120 回《红楼梦》主线为叙事骨架，从仙缘与甄士隐、黛玉进府、大观园青春盛景，推进到抄检、病逝、婚变、贾府败落与宝玉出家，用 128 帧国风漫画长卷表现家族兴衰与人物命运。";
export const DREAM_OF_RED_MANSIONS_CHARACTER_BIBLE =
  "贾宝玉：清代贵族少年，通灵宝玉、温润多情，彩色漫画造型稳定；林黛玉：纤秀敏感，浅雅衣裙与书卷花枝意象稳定；薛宝钗：端庄温和，金锁与素雅华服稳定；王熙凤：明艳锋利，凤眼笑意与华丽旗装稳定；贾母：尊贵慈和；元春、探春、湘云、妙玉、晴雯、袭人等保持各自服饰、发饰和气质识别。";

const FRAME_FORBIDDEN =
  "不得水墨化，不得工笔重彩化，不得改成泛泛古风山水，不得出现清明上河图式市井空景，不得提前画后续剧情，不得改变人物身份或主要关系。";
const FRAME_VISUAL_BASE = "国风漫画彩色分镜，细净勾线，柔和赛璐璐上色，清代服饰，大观园与贾府空间设定一致。";


export const DREAM_OF_RED_MANSIONS_STORYBOARD = loadStoryboardFromSource();

if (DREAM_OF_RED_MANSIONS_STORYBOARD.length !== DREAM_OF_RED_MANSIONS_TOTAL_FRAMES) {
  throw new Error(`Dream of Red Mansions storyboard must contain ${DREAM_OF_RED_MANSIONS_TOTAL_FRAMES} frames`);
}

export function buildHonglouScrollPayload(now = new Date()) {
  return {
    scroll: {
      title: DREAM_OF_RED_MANSIONS_TITLE,
      original_theme: DREAM_OF_RED_MANSIONS_THEME,
      optimized_prompt: DREAM_OF_RED_MANSIONS_VISUAL_STYLE,
      generation_mode: "story",
      story_template: AI_SCRIPT_TEMPLATE,
      story_template_version: AI_SCRIPT_TEMPLATE_VERSION,
      story_total_frames: DREAM_OF_RED_MANSIONS_TOTAL_FRAMES,
      script_summary: DREAM_OF_RED_MANSIONS_SUMMARY,
      character_bible: DREAM_OF_RED_MANSIONS_CHARACTER_BIBLE,
      status: "paused",
      auto_generation_enabled: false,
      interval_minutes: 5,
      overlap_preset: FIXED_OVERLAP_PRESET,
      overlap_ratio: FIXED_OVERLAP_RATIO,
      image_count: 0,
      next_run_at: new Date(now.getTime() + 300000).toISOString(),
      last_generated_at: null,
      thumbnail_url: "/assets/scroll-segment.svg",
    },
    frames: DREAM_OF_RED_MANSIONS_STORYBOARD,
  };
}

export function readEnvFile(path = ".env.local") {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

function loadStoryboardFromSource() {
  const sourcePath = fileURLToPath(new URL("../src/lib/dreamOfRedMansionsStoryboard.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  const match = source.match(/const STORY_ARCS: StoryArc\[] = (\[[\s\S]*?\n\]);/);
  if (!match) throw new Error("Unable to read Dream of Red Mansions storyboard arcs");
  const arcs = Function(`"use strict"; return (${match[1].replace(/;$/, "")});`)();
  return arcs
    .flatMap((arc) =>
      arc.beats.map((beat) => ({
        frameIndex: 0,
        chapter: arc.chapter,
        title: beat.title,
        scene: beat.scene,
        characters: beat.characters ?? arc.characters,
        location: beat.location ?? arc.location,
        mood: beat.mood ?? arc.mood,
        continuityAnchor:
          beat.continuityAnchor ?? `用${arc.location}的回廊、道路、灯影、花木或人物行进方向承接上一帧，并在右缘保留下一个场景入口。`,
        forbidden: FRAME_FORBIDDEN,
        visualPromptHint: beat.visualPromptHint ?? `${FRAME_VISUAL_BASE} 本帧突出“${beat.title}”的情绪与人物关系。`,
      })),
    )
    .map((frame, index) => ({ ...frame, frameIndex: index + 1 }));
}

export async function createHonglouScroll({ supabase, now = new Date() }) {
  const payload = buildHonglouScrollPayload(now);
  const { data: existing, error: existingError } = await supabase
    .from("scrolls")
    .select("id")
    .eq("title", DREAM_OF_RED_MANSIONS_TITLE)
    .maybeSingle();
  if (existingError) throw existingError;

  const scrollId = existing?.id;
  const scrollResult = scrollId
    ? await supabase.from("scrolls").update({ ...payload.scroll, updated_at: now.toISOString() }).eq("id", scrollId).select().single()
    : await supabase.from("scrolls").insert(payload.scroll).select().single();
  if (scrollResult.error) throw scrollResult.error;
  const id = scrollResult.data.id;

  const { error: deleteFramesError } = await supabase.from("scroll_story_frames").delete().eq("scroll_id", id);
  if (deleteFramesError) throw deleteFramesError;

  const frameRows = payload.frames.map((frame) => ({
    scroll_id: id,
    frame_index: frame.frameIndex,
    chapter: frame.chapter,
    title: frame.title,
    scene: frame.scene,
    characters: frame.characters,
    location: frame.location,
    mood: frame.mood,
    continuity_anchor: frame.continuityAnchor,
    forbidden: frame.forbidden,
    visual_prompt_hint: frame.visualPromptHint,
  }));
  const { error: insertFramesError } = await supabase.from("scroll_story_frames").insert(frameRows);
  if (insertFramesError) throw insertFramesError;

  await supabase.from("generation_logs").insert({
    scroll_id: id,
    level: "success",
    message: "红楼梦 128 帧国风漫画画卷已创建",
    detail: "已写入 128 帧可编辑分镜；尚未自动生成图片。",
  });

  return { scrollId: id, frameCount: payload.frames.length, updated: Boolean(scrollId) };
}

async function main() {
  const env = { ...process.env, ...readEnvFile() };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const result = await createHonglouScroll({ supabase });
  console.log(JSON.stringify(result, null, 2));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

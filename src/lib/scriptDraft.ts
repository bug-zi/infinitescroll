import type { CreativePlan } from "../types";

export const AI_SCRIPT_TEMPLATE = "ai_script";
export const AI_SCRIPT_TEMPLATE_VERSION = "v1";
export const SCRIPT_FRAME_COUNTS = [24, 48, 96, 128] as const;
export const DEFAULT_SCRIPT_FRAME_COUNT = 48;

export type ScriptFrame = {
  frameIndex: number;
  chapter: string;
  title: string;
  scene: string;
  characters: string[];
  location: string;
  mood: string;
  continuityAnchor: string;
  forbidden: string;
  visualPromptHint: string;
};

export type ScriptDraft = {
  title: string;
  summary: string;
  visualStyle: string;
  characterBible: string;
  frames: ScriptFrame[];
};

type NormalizeOptions = {
  frameCount: number;
  theme: string;
};

const DEFAULT_FORBIDDEN = "只画当前剧情帧，不得提前画后续剧情，不得跳过剧情，不得改编成无关场景。";
const DEFAULT_CONTINUITY = "采用分镜长卷衔接：用道路、云气、光色、卷轴纹理和运动方向承接上一帧。";

export function normalizeFrameCount(value: unknown) {
  const count = Number(value);
  return SCRIPT_FRAME_COUNTS.includes(count as (typeof SCRIPT_FRAME_COUNTS)[number]) ? count : DEFAULT_SCRIPT_FRAME_COUNT;
}

export function validateScriptFrameCount(frames: unknown[], frameCount: number) {
  if (frames.length !== frameCount) throw new Error(`Expected ${frameCount} script frames, got ${frames.length}`);
}

export function normalizeScriptDraft(value: unknown, options: NormalizeOptions): ScriptDraft {
  if (!value || typeof value !== "object") throw new Error("Script draft must be an object");
  const record = value as Record<string, unknown>;
  const rawFrames = Array.isArray(record.frames) ? record.frames : [];
  validateScriptFrameCount(rawFrames, options.frameCount);

  return {
    title: cleanText(record.title) || `${options.theme}画卷剧本`,
    summary: cleanText(record.summary),
    visualStyle: cleanText(record.visualStyle),
    characterBible: cleanText(record.characterBible),
    frames: rawFrames.map((frame, index) => normalizeScriptFrame(frame, index + 1)),
  };
}

export function normalizeScriptFrame(value: unknown, fallbackIndex: number): ScriptFrame {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    frameIndex: positiveInteger(record.frameIndex, fallbackIndex),
    chapter: cleanText(record.chapter) || "未分章",
    title: cleanText(record.title) || `第 ${fallbackIndex} 帧`,
    scene: cleanText(record.scene),
    characters: normalizeCharacters(record.characters),
    location: cleanText(record.location),
    mood: cleanText(record.mood),
    continuityAnchor: cleanText(record.continuityAnchor) || DEFAULT_CONTINUITY,
    forbidden: cleanText(record.forbidden) || DEFAULT_FORBIDDEN,
    visualPromptHint: cleanText(record.visualPromptHint),
  };
}

export function buildAiScriptCreativePlan({
  frame,
  totalFrames,
  previousSummary = "",
}: {
  frame: ScriptFrame;
  totalFrames: number;
  previousSummary?: string;
}): CreativePlan {
  const title = `第 ${frame.frameIndex} / ${totalFrames} 帧：${frame.title}`;
  const composition = [
    `以分镜连环画构图表现“${frame.title}”，主体剧情置于中景，画面从左到右形成阅读动线。`,
    frame.visualPromptHint ? `视觉提示：${frame.visualPromptHint}` : "",
    "允许通过卷轴纹理、道路方向、云气、色调和光线完成分镜长卷过渡。",
  ]
    .filter(Boolean)
    .join("");

  return {
    mode: "story",
    storyTemplate: AI_SCRIPT_TEMPLATE,
    storyTemplateVersion: AI_SCRIPT_TEMPLATE_VERSION,
    storyFrameIndex: frame.frameIndex,
    storyTotalFrames: totalFrames,
    chapter: frame.chapter,
    title,
    continuityAnchor: frame.continuityAnchor,
    newScene: frame.scene,
    composition,
    forbidden: frame.forbidden,
    characters: frame.characters,
    location: frame.location,
    mood: frame.mood,
    promptFragment: [
      "剧情模式：AI 编剧分镜长卷。",
      `剧情进度：第 ${frame.frameIndex} / ${totalFrames} 帧。`,
      `章节：${frame.chapter}`,
      `当前剧情帧：${frame.title}`,
      frame.characters.length ? `主要人物：${frame.characters.join("、")}` : "",
      frame.location ? `场景地点：${frame.location}` : "",
      frame.mood ? `情绪氛围：${frame.mood}` : "",
      `当前画面：${frame.scene}`,
      previousSummary ? `上一帧内容线索：${previousSummary}` : "",
      `分镜衔接：${frame.continuityAnchor}`,
      `构图要求：${composition}`,
      `禁止偏移：${frame.forbidden}`,
      "只画当前剧情帧，不得提前画后续剧情，不得跳过剧情，不得把画面改成无关古风、泛泛山水或其他题材。",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function mapScriptFrameRow(row: Record<string, any>): ScriptFrame {
  return normalizeScriptFrame(
    {
      frameIndex: row.frame_index,
      chapter: row.chapter,
      title: row.title,
      scene: row.scene,
      characters: row.characters,
      location: row.location,
      mood: row.mood,
      continuityAnchor: row.continuity_anchor,
      forbidden: row.forbidden,
      visualPromptHint: row.visual_prompt_hint,
    },
    Number(row.frame_index ?? 1),
  );
}

export function scriptFrameToInsert(scrollId: string, frame: ScriptFrame) {
  return {
    scroll_id: scrollId,
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
  };
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeCharacters(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item)).filter(Boolean);
  const text = cleanText(value);
  return text ? text.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) : [];
}

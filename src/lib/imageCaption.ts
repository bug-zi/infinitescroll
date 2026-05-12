import type { ScrollImage } from "../types";
import { normalizePromptText, summarizePrompt } from "./promptDisplay";

export type ImageCaption = {
  eyebrow: string;
  title: string;
  details: string;
  body: string;
};

const FIELD_LABELS = [
  "剧情进度",
  "章节",
  "当前剧情帧",
  "主要人物",
  "场景地点",
  "情绪氛围",
  "当前画面",
  "本张计划",
  "New scene",
  "Continuity anchor",
  "Theme",
];

export function buildImageCaption(image: ScrollImage, segmentIndex: number): ImageCaption {
  const segmentNumber = Math.max(0, segmentIndex) + 1;
  const segmentLabel = `第 ${segmentNumber} 段`;
  const fields = extractPromptFields(image.prompt);
  const title = fields.currentFrame || cleanCaptionText(image.title) || segmentLabel;
  const body =
    fields.currentScene ||
    stripKnownFieldLabel(summarizePrompt(image.prompt, 150)) ||
    `${segmentLabel}，暂无解说`;

  return {
    eyebrow: segmentLabel,
    title,
    details: buildDetails(fields),
    body: body === "暂无提示词" ? `${segmentLabel}，暂无解说` : body,
  };
}

function extractPromptFields(prompt: string) {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    progress: findField(lines, "剧情进度"),
    chapter: findField(lines, "章节"),
    currentFrame: findField(lines, "当前剧情帧"),
    characters: findField(lines, "主要人物"),
    location: findField(lines, "场景地点"),
    mood: findField(lines, "情绪氛围"),
    currentScene: findField(lines, "当前画面") || findField(lines, "本张计划") || findField(lines, "New scene"),
  };
}

function findField(lines: string[], label: string) {
  const prefixPattern = new RegExp(`^${escapeRegExp(label)}\\s*[:：]\\s*(.+)$`);
  for (const line of lines) {
    const match = line.match(prefixPattern);
    if (match?.[1]) return cleanCaptionText(match[1]);
  }
  return "";
}

function buildDetails(fields: ReturnType<typeof extractPromptFields>) {
  return [
    fields.chapter ? `章节：${fields.chapter}` : "",
    fields.location ? `地点：${fields.location}` : "",
    fields.characters ? `人物：${fields.characters}` : "",
    fields.mood ? `氛围：${fields.mood}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function stripKnownFieldLabel(value: string) {
  const normalized = cleanCaptionText(value);
  for (const label of FIELD_LABELS) {
    const pattern = new RegExp(`^${escapeRegExp(label)}\\s*[:：]\\s*`);
    if (pattern.test(normalized)) return cleanCaptionText(normalized.replace(pattern, ""));
  }
  return normalized;
}

function cleanCaptionText(value: string) {
  return normalizePromptText(value).replace(/^["“”']+|["“”']+$/g, "").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

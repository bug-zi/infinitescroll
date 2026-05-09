import type { GenerationJob, GenerationLog, OverlapPreset, Scroll, ScrollImage } from "../types";
import { normalizeCreativePlan } from "./creativePlan";
import { detectStoryMode } from "./storyMode";
import { normalizeImageRatioLabel } from "./stitching";

type JsonCrop = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

function crop(value: JsonCrop | null | undefined) {
  return {
    x: Number(value?.x ?? 0),
    y: Number(value?.y ?? 0),
    width: Number(value?.width ?? 0),
    height: Number(value?.height ?? 0),
  };
}

function numericMeta(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  const numberValue = Number(candidate);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

export function mapScrollRow(row: Record<string, any>): Scroll {
  const detected = detectStoryMode(row.original_theme, row.optimized_prompt);
  const generationMode = row.generation_mode === "story" || row.generation_mode === "free" ? row.generation_mode : detected.generationMode;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    originalTheme: row.original_theme,
    optimizedPrompt: row.optimized_prompt,
    generationMode,
    storyTemplate: row.story_template ?? (generationMode === "story" ? detected.storyTemplate : null),
    storyTemplateVersion: row.story_template_version ?? (generationMode === "story" ? detected.storyTemplateVersion : null),
    storyTotalFrames: row.story_total_frames ?? (generationMode === "story" ? detected.storyTotalFrames : null),
    scriptSummary: row.script_summary ?? null,
    characterBible: row.character_bible ?? null,
    createdAt: row.created_at,
    lastGeneratedAt: row.last_generated_at ?? row.created_at,
    nextRunAt: row.next_run_at,
    intervalMinutes: row.interval_minutes,
    overlapPreset: row.overlap_preset as OverlapPreset,
    overlapRatio: Number(row.overlap_ratio),
    imageCount: row.image_count,
    autoGenerationEnabled: row.auto_generation_enabled,
    thumbnail: row.thumbnail_url ?? "/assets/scroll-segment.svg",
    archivedAt: row.archived_at ?? null,
    purgeAfter: row.purge_after ?? null,
  };
}

export function mapImageRow(row: Record<string, any>): ScrollImage {
  return {
    id: row.id,
    scrollId: row.scroll_id,
    index: row.image_index,
    title: `第 ${row.image_index} 张`,
    src: row.full_image_url,
    generatedAt: row.generated_at,
    prompt: row.prompt,
    model: row.model,
    status: row.status,
    fileSize: row.file_size_bytes ? `${(row.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : "未知",
    dimensions: {
      width: row.width,
      height: row.height,
      ratioLabel: normalizeImageRatioLabel(row.ratio_label),
    },
    visibleCrop: crop(row.visible_crop),
    overlapCrop: crop(row.overlap_crop),
    newContentCrop: crop(row.new_content_crop),
    hasStitchWarning: row.has_stitch_warning,
    stitchQualityScore: numericMeta(row.overlap_crop, "stitchQualityScore"),
    archivedAt: row.archived_at ?? null,
    purgeAfter: row.purge_after ?? null,
  };
}

export function mapJobRow(row: Record<string, any>): GenerationJob {
  return {
    id: row.id,
    scrollId: row.scroll_id,
    targetIndex: row.target_index,
    type: row.type,
    status: row.status,
    scheduledFor: row.scheduled_for,
    creativePlan: row.creative_plan
      ? normalizeCreativePlan(row.creative_plan, {
          targetIndex: Number(row.target_index ?? 1),
          hasReferenceImage: Number(row.target_index ?? 1) > 1,
        })
      : undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

function cleanLogText(value: unknown, fallback: string) {
  const text = String(value ?? "");
  const compact = text.replace(/\s/g, "");
  if (compact.length > 0 && /^[?？]+$/.test(compact)) return fallback;
  const questionMarks = (compact.match(/[?？]/g) ?? []).length;
  if (compact.length >= 6 && questionMarks / compact.length > 0.4) return fallback;
  return text;
}

export function mapLogRow(row: Record<string, any>): GenerationLog {
  return {
    id: row.id,
    scrollId: row.scroll_id,
    level: row.level,
    message: cleanLogText(row.message, "日志内容编码异常"),
    detail: cleanLogText(row.detail, "原始日志包含不可恢复的问号乱码，请查看相邻日志或重新触发操作。"),
    createdAt: row.created_at,
  };
}

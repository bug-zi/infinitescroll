const SUMMARY_MAX_LENGTH = 120;

export function normalizePromptText(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim();
}

export function summarizePrompt(prompt: string, maxLength = SUMMARY_MAX_LENGTH) {
  const trimmed = prompt.trim();
  if (!trimmed) return "暂无提示词";

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const preferredLine =
    lines.find((line) => line.startsWith("本张计划：")) ??
    lines.find((line) => line.startsWith("New scene:")) ??
    lines.find((line) => line.startsWith("Continuity anchor:")) ??
    lines.find((line) => line.startsWith("Theme:")) ??
    normalizePromptText(trimmed);

  return truncatePromptSummary(preferredLine, maxLength);
}

function truncatePromptSummary(value: string, maxLength: number) {
  const normalized = normalizePromptText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

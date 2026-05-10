import type { CreativePlan, GenerationMode } from "../types";

export type StyleLockInput = {
  theme?: unknown;
  optimizedPrompt?: unknown;
  characterBible?: unknown;
  scriptSummary?: unknown;
  generationMode?: GenerationMode | string | null;
};

export function buildStyleLockPromptSection(input: StyleLockInput) {
  const theme = cleanText(input.theme) || "continuous horizontal handscroll";
  const optimizedPrompt = cleanText(input.optimizedPrompt);
  const characterBible = cleanText(input.characterBible);
  const scriptSummary = cleanText(input.scriptSummary);
  const mode = input.generationMode === "story" ? "story storyboard" : "free continuous scroll";

  return [
    "Global Style Lock (highest priority; apply unchanged to every frame):",
    `Theme anchor: ${theme}`,
    `Generation mode: ${mode}`,
    optimizedPrompt ? `Confirmed long-term visual direction: ${optimizedPrompt}` : "",
    scriptSummary ? `Story summary anchor: ${scriptSummary}` : "",
    characterBible ? `Character design bible: ${characterBible}` : "",
    "Keep identical linework across frames: same ink thickness, contour style, hatch density, and brush-edge behavior.",
    "Keep identical palette across frames: same dominant pigments, saturation, contrast, shadow color, and highlight temperature.",
    "Keep identical paper texture across frames: same aged paper grain, fiber noise, wash transparency, and scroll patina.",
    "Keep character proportions and costume silhouettes unchanged; recurring characters must keep the same face shape, clothing, props, and posture language.",
    "Keep composition density consistent: similar figure scale, architectural detail density, horizon height, atmospheric depth, and left-to-right reading rhythm.",
    "Do not change painting medium, era, lighting direction, camera distance, brush density, or overall visual language between frames.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function summarizePreviousFrameForNextPrompt(plan: Partial<CreativePlan> | null | undefined, fallbackPrompt?: unknown, maxLength = 320) {
  const characters = Array.isArray(plan?.characters) && plan.characters.length ? `Characters: ${plan.characters.join(", ")}` : "";
  const planSummary = [
    plan?.title ? `Previous frame: ${plan.title}` : "",
    plan?.chapter ? `Chapter: ${plan.chapter}` : "",
    characters,
    plan?.location ? `Location: ${plan.location}` : "",
    plan?.newScene ? `Scene: ${plan.newScene}` : "",
    plan?.continuityAnchor ? `Continuity: ${plan.continuityAnchor}` : "",
  ]
    .filter(Boolean)
    .join("; ");

  if (planSummary) return truncate(planSummary, maxLength);
  return summarizePromptFallback(fallbackPrompt, maxLength);
}

export function summarizePromptFallback(value: unknown, maxLength = 280) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const usefulLines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isUsefulPreviousFrameLine);
  const cleaned =
    usefulLines.length > 0
      ? usefulLines.join(" ")
      : text
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => !isGeneratedPromptInstruction(line))
          .join(" ");
  return truncate(cleanText(cleaned) || "Previous frame exists; continue only its visible story, composition, and edge direction.", maxLength);
}

export function isFallbackImageModel(model: unknown, preferredModel = "gpt-image-2") {
  const text = cleanText(model).toLowerCase();
  if (!text) return false;
  if (!text.includes("gpt-image-")) return false;
  return !text.includes(preferredModel.toLowerCase());
}

export function buildFallbackStyleWarning(model: unknown, preferredModel = "gpt-image-2") {
  if (!isFallbackImageModel(model, preferredModel)) return "";
  return `Image model fallback used (${cleanText(model)}); style may drift from the locked reference. Consider regenerating this frame with ${preferredModel} when available.`;
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function isGeneratedPromptInstruction(line: string) {
  return /^(create one frame|create one segment|visual style must|user theme:|long-term scroll direction:|global style lock|generation mode:|creative plan for this exact segment:|follow this plan exactly|no modern objects|this is story frame|this is segment|a reference image is attached|use the supplied|keep character designs consistent)/i.test(
    line,
  );
}

function isUsefulPreviousFrameLine(line: string) {
  return /^(previous frame|title|chapter|characters|location|mood|continuity anchor|new scene|scene|composition):/i.test(line);
}

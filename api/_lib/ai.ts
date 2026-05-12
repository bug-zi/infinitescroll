import { createOutpaintCanvas, createOutpaintMask } from "./stitchImages.js";
import { getImageEditRequestTimeoutMs, getImageRequestTimeoutMs } from "../../src/lib/imageTimeout.js";
import { normalizeFrameCount, normalizeScriptDraft, type ScriptDraft } from "../../src/lib/scriptDraft.js";
import { readFileSync } from "node:fs";
import sharp from "sharp";

const deepSeekUrl = "https://api.deepseek.com/chat/completions";
const DEFAULT_RESPONSE_MODEL = "gpt-5.5";
const DEFAULT_IMAGE_TOOL_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_TOOL_FALLBACKS = "gpt-image-1.5,gpt-image-1";
const DEFAULT_IMAGE_API_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_API_FALLBACKS = "gpt-image-1.5,gpt-image-1";
let localFallbackImageBytesPromise: Promise<Buffer> | null = null;

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type ResponsesApiOutput = {
  output?: Array<{
    type?: string;
    result?: string;
  }>;
};

export type GeneratedImage = {
  imageUrl: string;
  model: string;
  prompt: string;
  imageBytes?: Uint8Array;
  mimeType?: string;
};

export async function optimizeThemeWithDeepSeek(theme: string, requirements = "") {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return fallbackOptimizedPrompt(theme, requirements);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 20000));

  try {
    const response = await fetch(deepSeekUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "你是《无限画卷》的画卷提示词工程师。必须严格围绕用户主题优化提示词，不得替换成无关题材，不得泛化成普通山水或古风模板。用户补充要求优先级高于默认画卷审美；用户明确禁止的风格、媒介、题材或元素必须作为硬约束执行。输出必须是中文提示词正文，不要标题、解释、编号或 Markdown。提示词要适合横向连续长卷：说明核心题材、时代或世界观、视觉风格、色彩与光照、左到右叙事推进、相邻画面衔接、可持续生成的空间线索。",
          },
          {
            role: "user",
            content: [
              `用户主题：${theme}`,
              requirements ? `补充要求：${requirements}` : "",
              "请把这个主题优化成一段可直接交给图像模型生成连续横向画卷的提示词。必须保留并强化主题中的关键名词和气质。",
              "如果补充要求里出现“不要、不得、禁止、不使用、不用、避免、no、without、avoid”等禁止性表达，不得在输出中重新加入这些被禁止的词、媒介或风格，也不得用同义描述把它们带回。",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        temperature: 0.35,
      }),
    });

    if (!response.ok) return fallbackOptimizedPrompt(theme, requirements);

    const data = (await response.json()) as DeepSeekResponse;
    return data.choices?.[0]?.message?.content?.trim() || fallbackOptimizedPrompt(theme, requirements);
  } catch {
    return fallbackOptimizedPrompt(theme, requirements);
  } finally {
    clearTimeout(timeout);
  }
}

export async function draftScriptWithDeepSeek({
  theme,
  frameCount,
  requirements = "",
  stylePrompt = "",
}: {
  theme: string;
  frameCount: number;
  requirements?: string;
  stylePrompt?: string;
}): Promise<ScriptDraft> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is required for script drafting");
  const safeFrameCount = normalizeFrameCount(frameCount);
  const raw = await requestScriptDraft(key, buildScriptDraftMessages({ theme, frameCount: safeFrameCount, requirements, stylePrompt }));
  try {
    return normalizeScriptDraft(parseJsonObject(raw), { frameCount: safeFrameCount, theme });
  } catch (firstError) {
    const repaired = await requestScriptDraft(key, buildScriptRepairMessages(raw, safeFrameCount));
    try {
      return normalizeScriptDraft(parseJsonObject(repaired), { frameCount: safeFrameCount, theme });
    } catch (secondError) {
      throw secondError instanceof Error ? secondError : firstError;
    }
  }
}

async function requestScriptDraft(key: string, messages: Array<{ role: "system" | "user"; content: string }>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 60000));
  try {
    const response = await fetch(deepSeekUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        temperature: 0.45,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek script draft failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as DeepSeekResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("DeepSeek returned empty script draft");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function buildScriptDraftMessages(input: { theme: string; frameCount: number; requirements: string; stylePrompt: string }) {
  return [
    {
      role: "system" as const,
      content:
        "你是《无限画卷》的专业编剧和分镜导演。必须输出严格 JSON，不要 Markdown。你要为横向连环画长卷规划完整剧本，剧情必须逐帧推进，角色和视觉风格保持一致。用户补充要求优先级高于默认画卷审美；用户明确禁止的风格、媒介、题材或元素必须作为硬约束执行，并写入 visualStyle、每帧 forbidden 与 visualPromptHint。",
    },
    {
      role: "user" as const,
      content: [
        `主题：${input.theme}`,
        `总帧数：${input.frameCount}`,
        input.requirements ? `补充要求：${input.requirements}` : "",
        input.stylePrompt ? `视觉风格提示：${input.stylePrompt}` : "",
        "请输出 JSON 对象，字段必须包含：title, summary, visualStyle, characterBible, frames。",
        "frames 必须是数组，长度必须等于总帧数。每一帧必须包含：frameIndex, chapter, title, scene, characters, location, mood, continuityAnchor, forbidden, visualPromptHint。",
        "frameIndex 从 1 连续递增。scene 只描述当前帧，不得提前描述后续剧情。forbidden 要明确禁止跳剧情、改题材和提前画后续。",
        "如果补充要求或视觉风格提示中包含禁止性表达，forbidden 必须逐帧写入这些禁止项；visualStyle 和 visualPromptHint 必须采用用户指定的正向风格，不得把被禁止的媒介或风格带回。",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

function buildScriptRepairMessages(raw: string, frameCount: number) {
  return [
    {
      role: "system" as const,
      content: "你是 JSON 修复器。只输出可解析 JSON，不要解释，不要 Markdown。",
    },
    {
      role: "user" as const,
      content: `下面内容不是合格剧本 JSON，或 frames 数量不是 ${frameCount}。请修复为严格 JSON，并确保 frames 长度正好是 ${frameCount}：\n${raw}`,
    },
  ];
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  return JSON.parse(fenced || trimmed);
}

export function fallbackOptimizedPrompt(theme: string, requirements = "") {
  const requirementText = requirements.trim() ? `严格遵守补充要求：${requirements.trim()}。` : "";
  return `以「${theme}」为唯一核心主题生成连续横向画卷，保留主题中的关键人物、地点、时代、材质与气质。${requirementText}画面保持统一的视觉风格、色彩温度、笔触密度、光照方向和空间透视，从左到右自然推进叙事；每一段都延续上一段右侧边缘的道路、水系、建筑、人群、地平线和远景层次，避免突然切换场景。`;
}

export async function generateImage(prompt: string, referenceImageBase64?: string): Promise<GeneratedImage> {
  const keys = getOpenAIKeyPool();
  if (!keys.length) return fallbackImage(prompt, "Mock GPT Image");

  const baseUrl = (getEnvValue("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const preferImageApi = shouldPreferImageApi(baseUrl);
  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [{ type: "input_text", text: prompt }];

  if (referenceImageBase64) {
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${referenceImageBase64}`,
      detail: "high",
    });
  }

  if (preferImageApi) {
    const imageApiResult = await tryImageApi({ baseUrl, keys, prompt: compactPromptForImageApi(prompt) });
    if (imageApiResult) return imageApiResult;
  }

  const responsesResult = await tryResponsesImageTool({ baseUrl, keys, content, prompt });
  if (responsesResult) return responsesResult;

  if (!preferImageApi) {
    const imageApiResult = await tryImageApi({ baseUrl, keys, prompt });
    if (imageApiResult) return imageApiResult;
  }

  return fallbackImage(prompt, getImageToolModelCandidates()[0]);
}

async function tryResponsesImageTool({
  baseUrl,
  keys,
  content,
  prompt,
}: {
  baseUrl: string;
  keys: string[];
  content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" }>;
  prompt: string;
}): Promise<GeneratedImage | null> {
  const responseModel = getEnvValue("OPENAI_RESPONSE_MODEL") || getEnvValue("OPENAI_MODEL") || DEFAULT_RESPONSE_MODEL;
  const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/responses` : `${baseUrl}/v1/responses`;

  for (const imageModel of getImageToolModelCandidates()) {
    for (const key of keys) {
    const keyLabel = getOpenAIKeyLabel(key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getImageRequestTimeoutMs());
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: responseModel,
          input: [
            {
              role: "user",
              content,
            },
          ],
          tools: [{ type: "image_generation", model: imageModel, quality: "high", size: "1536x1024", action: "generate" }],
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        console.warn(`Image provider ${keyLabel} failed for ${imageModel}: ${response.status} ${detail}`);
        continue;
      }

      const data = (await response.json()) as ResponsesApiOutput;
      const base64 = data.output?.find((item) => item.type === "image_generation_call")?.result;
      if (!base64) continue;

      return {
        imageUrl: `data:image/png;base64,${base64}`,
        imageBytes: Uint8Array.from(Buffer.from(base64, "base64")),
        mimeType: "image/png",
        model: `${responseModel} + ${imageModel} (${keyLabel})`,
        prompt,
      };
    } catch (error) {
      if (isAbortError(error)) {
        console.warn(`Image provider ${keyLabel} timed out for ${imageModel}; falling back to Image API generation`, error);
        return null;
      }
      console.warn(`Image provider ${keyLabel} threw for ${imageModel}`, error);
    } finally {
      clearTimeout(timeout);
    }
    }
  }
  return null;
}

async function tryImageApi({ baseUrl, keys, prompt }: { baseUrl: string; keys: string[]; prompt: string }): Promise<GeneratedImage | null> {
  const v1 = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const endpoint = `${v1}/images/generations`;

  for (const model of getImageApiModelCandidates()) {
    for (const key of keys) {
      const keyLabel = getOpenAIKeyLabel(key);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), getImageRequestTimeoutMs());
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            prompt,
            size: "1536x1024",
            quality: "high",
            n: 1,
          }),
        });

        if (!response.ok) {
          const detail = await response.text();
          console.warn(`Image API provider ${keyLabel} failed for ${model}: ${response.status} ${detail}`);
          continue;
        }

        const data = (await response.json()) as { data?: Array<{ b64_json?: string }> };
        const base64 = data.data?.[0]?.b64_json;
        if (!base64) continue;

        return {
          imageUrl: `data:image/png;base64,${base64}`,
          imageBytes: Uint8Array.from(Buffer.from(base64, "base64")),
          mimeType: "image/png",
          model: `${model} (${keyLabel})`,
          prompt,
        };
      } catch (error) {
        console.warn(`Image API provider ${keyLabel} threw for ${model}`, error);
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  return null;
}

export async function generateOutpaintedImage(
  prompt: string,
  previousImageBuffer: Buffer | Uint8Array,
  overlapRatio: number,
  referenceImageBase64?: string,
  overlapWidth?: number,
  height = 768,
  width?: number,
  styleReferenceImageBase64?: string,
): Promise<GeneratedImage> {
  void referenceImageBase64;
  const edited = await tryImageEditOutpaint(prompt, previousImageBuffer, overlapRatio, overlapWidth, height, width, styleReferenceImageBase64);
  if (edited) return edited;
  return {
    imageUrl: "",
    model: `${getImageApiModelCandidates()[0]} edit-outpaint failed`,
    prompt,
  };
}

async function tryImageEditOutpaint(
  prompt: string,
  previousImageBuffer: Buffer | Uint8Array,
  overlapRatio: number,
  sourceOverlapWidth?: number,
  sourceHeight = 768,
  sourceWidth?: number,
  styleReferenceImageBase64?: string,
): Promise<GeneratedImage | null> {
  const keys = getOpenAIKeyPool();
  if (!keys.length) return null;

  const baseUrl = (getEnvValue("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const v1 = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const endpoint = `${v1}/images/edits`;
  const editWidth = sourceWidth ?? 1536;
  const editHeight = sourceWidth ? sourceHeight : 1024;
  const overlapWidth = sourceOverlapWidth ?? Math.max(1, Math.round((editWidth / (1 + overlapRatio)) * overlapRatio));
  const canvas = await createOutpaintCanvas(previousImageBuffer, editWidth, editHeight, overlapWidth, sourceOverlapWidth ?? overlapWidth, sourceHeight);
  const mask = await createOutpaintMask(editWidth, editHeight, overlapWidth);
  for (const model of getImageApiModelCandidates()) {
    for (const key of keys) {
    const keyLabel = getOpenAIKeyLabel(key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getImageEditRequestTimeoutMs());
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", sourceWidth ? "auto" : "1536x1024");
    form.append("quality", "high");
    if (model !== "gpt-image-2") form.append("input_fidelity", "high");
    form.append("n", "1");
    form.append("image[]", new Blob([new Uint8Array(canvas)], { type: "image/png" }), "canvas.png");
    form.append("image[]", new Blob([new Uint8Array(previousImageBuffer)], { type: "image/png" }), "previous.png");
    if (styleReferenceImageBase64) {
      form.append("image[]", new Blob([new Uint8Array(Buffer.from(styleReferenceImageBase64, "base64"))], { type: "image/png" }), "style-reference.png");
    }
    form.append("mask", new Blob([new Uint8Array(mask)], { type: "image/png" }), "mask.png");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
        },
        body: form,
      });

      if (!response.ok) {
        const detail = await response.text();
        console.warn(`Image edit provider ${keyLabel} failed for ${model}: ${response.status} ${detail}`);
        continue;
      }

      const data = (await response.json()) as { data?: Array<{ b64_json?: string }> };
      const base64 = data.data?.[0]?.b64_json;
      if (!base64) continue;

      return {
        imageUrl: `data:image/png;base64,${base64}`,
        imageBytes: Uint8Array.from(Buffer.from(base64, "base64")),
        mimeType: "image/png",
        model: `${model} edit-outpaint (${keyLabel})`,
        prompt,
      };
    } catch (error) {
      if (isAbortError(error)) {
        console.warn(`Image edit provider ${keyLabel} timed out for ${model}; falling back to stitched reference generation`, error);
        return null;
      }
      console.warn(`Image edit provider ${keyLabel} threw for ${model}`, error);
    } finally {
      clearTimeout(timeout);
    }
    }
  }
  return null;
}

async function fallbackImage(prompt: string, model: string): Promise<GeneratedImage> {
  const imageBytes = await getLocalFallbackImageBytes();
  return {
    imageUrl: "/assets/scroll-segment.svg",
    imageBytes,
    mimeType: "image/png",
    model: `${model} local fallback`,
    prompt,
  };
}

function getLocalFallbackImageBytes() {
  if (!localFallbackImageBytesPromise) {
    localFallbackImageBytesPromise = sharp(readFileSync(new URL("../../public/assets/scroll-segment.svg", import.meta.url)))
      .png()
      .toBuffer();
  }
  return localFallbackImageBytesPromise;
}

export function getOpenAIKeyPool() {
  const keys = [
    ...(process.env.OPENAI_API_KEYS ?? "").split(","),
    process.env.OPENAI_API_KEY ?? "",
  ]
    .map((key) => key.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

function getOpenAIKeyLabel(apiKey: string) {
  const index = getOpenAIKeyPool().indexOf(apiKey);
  return `key #${index + 1}`;
}

function getImageToolModelCandidates() {
  return buildModelCandidates(getEnvValue("OPENAI_IMAGE_MODEL") || DEFAULT_IMAGE_TOOL_MODEL, getEnvValue("OPENAI_IMAGE_MODEL_FALLBACKS") || DEFAULT_IMAGE_TOOL_FALLBACKS);
}

function getImageApiModelCandidates() {
  return buildModelCandidates(getEnvValue("OPENAI_IMAGE_API_MODEL") || DEFAULT_IMAGE_API_MODEL, getEnvValue("OPENAI_IMAGE_API_MODEL_FALLBACKS") || DEFAULT_IMAGE_API_FALLBACKS);
}

function shouldPreferImageApi(baseUrl: string): boolean {
  const configured = getEnvValue("OPENAI_PREFER_IMAGE_API").toLowerCase();
  if (["1", "true", "yes", "on"].includes(configured)) return true;
  if (["0", "false", "no", "off"].includes(configured)) return false;
  return !isOfficialOpenAIBaseUrl(baseUrl);
}

function isOfficialOpenAIBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function compactPromptForImageApi(prompt: string): string {
  const maxChars = 700;
  const getValue = (prefix: string) => {
    const line = prompt
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.startsWith(prefix));
    return line?.slice(prefix.length).trim() ?? "";
  };
  const theme = getValue("User theme:") || "连续画卷";
  const direction = getValue("Long-term scroll direction:");
  const frameMatch = prompt.match(/This is story frame\s+(\d+)/i);
  const frameLabel = frameMatch ? `第${frameMatch[1]}帧` : "";
  const title = getValue("Title:").replace(/^第\s*\d+\s*\/\s*\d+\s*帧[:：]\s*/, "").trim();
  const characters = getValue("Characters:");
  const location = getValue("Location:");
  const mood = getValue("Mood:");
  const scene = getValue("New scene:");
  const forbidden = getValue("Forbidden drift:");
  const style = direction.includes("国风漫画") || direction.includes("彩色分镜")
    ? "国风漫画彩色分镜，细净勾线，柔和赛璐璐上色，清代服饰，场景设定一致"
    : (direction.slice(0, 120) || "保持用户指定视觉风格");
  const forbiddenSummary = forbidden || "现代物品、文字、水印、无关场景";
  const compact = [
    `${theme}${style ? `，${style}` : ""}${frameLabel ? `，${frameLabel}` : ""}${title ? `：${title}` : ""}。`,
    scene ? `${scene}。` : "",
    characters ? `人物：${characters}。` : "",
    location ? `地点：${location}。` : "",
    mood ? `氛围：${mood}。` : "",
    `禁止：${forbiddenSummary}。只画当前剧情，不提前画后续。`,
  ].join("");

  return compact.length > 80 ? compact.slice(0, maxChars) : prompt.slice(0, maxChars);
}

function buildModelCandidates(primary: string, fallbacks: string) {
  return [...new Set([primary, ...fallbacks.split(",")].map((model) => model.trim()).filter(Boolean))];
}

function isAbortError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "APIUserAbortError" || /aborted|abort/i.test(error.message);
}

function getEnvValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value !== "undefined" && value !== "null" ? value : "";
}

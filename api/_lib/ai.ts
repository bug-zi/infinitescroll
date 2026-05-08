import { createOutpaintCanvas, createOutpaintMask } from "./stitchImages.js";
import { getImageRequestTimeoutMs } from "../../src/lib/imageTimeout.js";

const deepSeekUrl = "https://api.deepseek.com/chat/completions";

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

export async function optimizeThemeWithDeepSeek(theme: string) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return fallbackOptimizedPrompt(theme);

  const response = await fetch(deepSeekUrl, {
    method: "POST",
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
            "你是画卷提示词工程师。把用户主题优化成适合横向连续长卷生成的中文提示词，强调风格一致、空间连续、左到右叙事、相邻画面衔接。只输出提示词正文。",
        },
        {
          role: "user",
          content: theme,
        },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) return fallbackOptimizedPrompt(theme);

  const data = (await response.json()) as DeepSeekResponse;
  return data.choices?.[0]?.message?.content?.trim() || fallbackOptimizedPrompt(theme);
}

export function fallbackOptimizedPrompt(theme: string) {
  return `以「${theme}」为主题生成连续横向画卷，保持统一的时代质感、色彩温度、笔触密度、光照方向和空间透视。画面从左至右自然推进，每一段都延续上一段右侧边缘的道路、水系、建筑、人群和远景层次。`;
}

export async function generateImage(prompt: string, referenceImageBase64?: string): Promise<GeneratedImage> {
  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-5";
  const keys = getOpenAIKeyPool();
  if (!keys.length) return fallbackImage(prompt, "Mock GPT Image");

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const endpoint = baseUrl.endsWith("/v1") ? `${baseUrl}/responses` : `${baseUrl}/v1/responses`;
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

  for (const key of keys) {
    const keyLabel = getOpenAIKeyLabel(key);
    try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content,
          },
        ],
        tools: [{ type: "image_generation" }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn(`Image provider ${keyLabel} failed: ${response.status} ${detail}`);
      continue;
    }

    const data = (await response.json()) as ResponsesApiOutput;
    const base64 = data.output?.find((item) => item.type === "image_generation_call")?.result;
    if (!base64) continue;

    return {
      imageUrl: `data:image/png;base64,${base64}`,
      imageBytes: Uint8Array.from(Buffer.from(base64, "base64")),
      mimeType: "image/png",
      model: `${model} (${keyLabel})`,
      prompt,
    };
    } catch (error) {
      console.warn(`Image provider ${keyLabel} threw`, error);
    }
  }
  return fallbackImage(prompt, model);
}

export async function generateOutpaintedImage(
  prompt: string,
  previousImageBuffer: Buffer | Uint8Array,
  overlapRatio: number,
  referenceImageBase64?: string,
  overlapWidth?: number,
  height = 768,
  width?: number,
): Promise<GeneratedImage> {
  const edited = await tryImageEditOutpaint(prompt, previousImageBuffer, overlapRatio, overlapWidth, height, width);
  if (edited) return edited;
  void referenceImageBase64;
  return {
    imageUrl: "",
    model: `${process.env.OPENAI_IMAGE_API_MODEL ?? "gpt-image-1"} edit-outpaint failed`,
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
): Promise<GeneratedImage | null> {
  const keys = getOpenAIKeyPool();
  if (!keys.length) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const v1 = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const endpoint = `${v1}/images/edits`;
  const model = process.env.OPENAI_IMAGE_API_MODEL ?? "gpt-image-1";
  const editWidth = sourceWidth ?? 1536;
  const editHeight = sourceWidth ? sourceHeight : 1024;
  const overlapWidth = sourceOverlapWidth ?? Math.max(1, Math.round((editWidth / (1 + overlapRatio)) * overlapRatio));
  const canvas = await createOutpaintCanvas(previousImageBuffer, editWidth, editHeight, overlapWidth, sourceOverlapWidth ?? overlapWidth, sourceHeight);
  const mask = await createOutpaintMask(editWidth, editHeight, overlapWidth);
  for (const key of keys) {
    const keyLabel = getOpenAIKeyLabel(key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getImageRequestTimeoutMs());
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", sourceWidth ? "auto" : "1536x1024");
    form.append("quality", "high");
    form.append("input_fidelity", "high");
    form.append("n", "1");
    form.append("image[]", new Blob([new Uint8Array(canvas)], { type: "image/png" }), "canvas.png");
    form.append("image[]", new Blob([new Uint8Array(previousImageBuffer)], { type: "image/png" }), "previous.png");
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
        console.warn(`Image edit provider ${keyLabel} failed: ${response.status} ${detail}`);
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
      console.warn(`Image edit provider ${keyLabel} threw`, error);
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function fallbackImage(prompt: string, model: string): GeneratedImage {
  return {
    imageUrl: "/assets/scroll-segment.svg",
    model,
    prompt,
  };
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

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import sharp from "sharp";
import { createTimeoutFetch } from "./supabase-fetch.mjs";

loadEnv(".env.local");

const SCROLL_ID = "9800dbc5-ab83-4ca5-b216-f12858a39ad6";
const TARGET_INDEX = 11;
const IMAGE_HEIGHT = 1152;
const VISIBLE_WIDTH = 1536;
const OVERLAP_WIDTH = 384;
const FULL_WIDTH = VISIBLE_WIDTH + OVERLAP_WIDTH;
const BUCKET = "scroll-images";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch: createRetryingFetch(Number(process.env.SUPABASE_FETCH_TIMEOUT_MS ?? 180000)) },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: normalizeOpenAIBaseUrl(process.env.OPENAI_BASE_URL),
});

const prompt = [
  "Create segment 11 of a continuous horizontal Northern Song dynasty Chinese handscroll in the style of Along the River During the Qingming Festival.",
  "This is an edit/outpaint task. The left 384 pixels are locked continuity pixels from segment 10 and must not be changed; generate only the new content to the right.",
  "Hard continuity anchors from segment 10 right edge: preserve the river waterline height, the curve of any bridge or bank arc, the shoreline road trajectory, roof-eave height, building scale, brush density, ink-line thickness, pale mineral colors, and the walking direction of the crowd.",
  "Continue the exact right-edge scene into the new right side: riverbank market life, narrow shoreline road, low Song-dynasty roofs and eaves, vendors, pedestrians, porters, carts, and small boats should follow the same perspective and horizon.",
  "Do not jump to a new place. Do not introduce a new bridge unless it grows naturally from the edge geometry. Do not change season, lighting, viewpoint, river level, road angle, roof height, or crowd flow.",
  "The visible seam at x=384 must be visually quiet: lines crossing the seam should continue with the same angle and thickness; water, road, eaves, and figures must not kink or shift.",
  "No modern objects, no text labels, no UI, no frame, no watermark. Antique handscroll texture, fine ink linework, pale restrained colors.",
].join("\n");

async function main() {
  const { data: scroll, error: scrollError } = await supabase
    .from("scrolls")
    .select("id,image_count,optimized_prompt,original_theme")
    .eq("id", SCROLL_ID)
    .single();
  if (scrollError) throw scrollError;
  if (Number(scroll.image_count) !== 10) throw new Error(`Expected image_count=10 before regenerating segment 11, got ${scroll.image_count}`);

  const { data: existing11, error: existingError } = await supabase
    .from("scroll_images")
    .select("id")
    .eq("scroll_id", SCROLL_ID)
    .eq("image_index", TARGET_INDEX);
  if (existingError) throw existingError;
  if (existing11?.length) throw new Error("Segment 11 already exists; refusing to overwrite it.");

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({
      scroll_id: SCROLL_ID,
      target_index: TARGET_INDEX,
      type: "auto_next",
      status: "running",
      scheduled_for: new Date().toISOString(),
      locked_at: new Date().toISOString(),
      locked_by: "manual-segment-11-regenerator",
    })
    .select()
    .single();
  if (jobError) throw jobError;

  try {
    const previousBuffer = await readPreviousImage();
    const generated = await generateOutpaintedImage(previousBuffer);
    const stitched = await copyPreviousOverlapIntoNewImage(generated.bytes, previousBuffer, Math.round(OVERLAP_WIDTH * 0.25));
    const stitchQualityScore = await calculateVisibleSeamQualityScore(stitched, OVERLAP_WIDTH, IMAGE_HEIGHT, Math.round(OVERLAP_WIDTH * 0.125));
    const imageUrl = await persistImage(stitched);
    const now = new Date().toISOString();

    const { data: image, error: imageError } = await supabase
      .from("scroll_images")
      .insert({
        scroll_id: SCROLL_ID,
        image_index: TARGET_INDEX,
        status: "succeeded",
        full_image_url: imageUrl,
        prompt,
        model: generated.model,
        file_size_bytes: stitched.byteLength,
        width: FULL_WIDTH,
        height: IMAGE_HEIGHT,
        ratio_label: "4:3",
        visible_crop: { x: OVERLAP_WIDTH, y: 0, width: VISIBLE_WIDTH, height: IMAGE_HEIGHT },
        overlap_crop: { x: 0, y: 0, width: OVERLAP_WIDTH, height: IMAGE_HEIGHT, stitchQualityScore },
        new_content_crop: { x: OVERLAP_WIDTH, y: 0, width: VISIBLE_WIDTH, height: IMAGE_HEIGHT },
        has_stitch_warning: stitchQualityScore < 82,
        generated_at: now,
      })
      .select()
      .single();
    if (imageError) throw imageError;

    const nextRunAt = new Date(Date.now() + 5 * 60000).toISOString();
    await supabase
      .from("scrolls")
      .update({
        image_count: TARGET_INDEX,
        last_generated_at: now,
        next_run_at: nextRunAt,
        thumbnail_url: imageUrl,
        updated_at: now,
      })
      .eq("id", SCROLL_ID);

    await supabase.from("generation_jobs").insert({
      scroll_id: SCROLL_ID,
      target_index: TARGET_INDEX + 1,
      type: "auto_next",
      status: "queued",
      scheduled_for: nextRunAt,
    });

    await finishJob(job.id, "succeeded");
    await supabase.from("generation_logs").insert({
      scroll_id: SCROLL_ID,
      level: stitchQualityScore < 82 ? "warning" : "success",
      message: `第 ${TARGET_INDEX} 张生成成功`,
      detail: `已按第 10 张右缘硬锚点重新生成；真实接缝评分 ${stitchQualityScore} 分。`,
    });

    console.log(JSON.stringify({ ok: true, imageId: image.id, imageUrl, stitchQualityScore }, null, 2));
  } catch (error) {
    await finishJob(job.id, "failed", formatUnknownError(error));
    await supabase.from("generation_logs").insert({
      scroll_id: SCROLL_ID,
      level: "error",
      message: `第 ${TARGET_INDEX} 张生成失败`,
      detail: formatUnknownError(error).slice(0, 1000),
    });
    throw error;
  }
}

async function readPreviousImage() {
  const { data, error } = await supabase
    .from("scroll_images")
    .select("full_image_url")
    .eq("scroll_id", SCROLL_ID)
    .eq("image_index", TARGET_INDEX - 1)
    .single();
  if (error) throw error;
  const response = await fetch(data.full_image_url);
  if (!response.ok) throw new Error(`Failed to download segment 10: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function generateOutpaintedImage(previousBuffer) {
  const editResult = await tryImageEditOutpaint(previousBuffer);
  if (editResult) return editResult;
  const reference = (await extractRightOverlapByWidth(previousBuffer, OVERLAP_WIDTH, IMAGE_HEIGHT)).toString("base64");
  const responseResult = await tryResponsesImageTool(reference);
  if (responseResult) return responseResult;
  throw new Error("Image model did not return valid image bytes");
}

async function tryImageEditOutpaint(previousBuffer) {
  const endpoint = `${normalizeOpenAIBaseUrl(process.env.OPENAI_BASE_URL)}/images/edits`;
  const model = process.env.OPENAI_IMAGE_API_MODEL ?? "gpt-image-1";
  const canvas = await createOutpaintCanvas(previousBuffer);
  const mask = await createOutpaintMask();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.IMAGE_REQUEST_TIMEOUT_MS ?? 900000));
  try {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", "auto");
    form.append("quality", "high");
    form.append("input_fidelity", "high");
    form.append("n", "1");
    form.append("image[]", new Blob([new Uint8Array(canvas)], { type: "image/png" }), "canvas.png");
    form.append("image[]", new Blob([new Uint8Array(previousBuffer)], { type: "image/png" }), "segment-10.png");
    form.append("mask", new Blob([mask], { type: "image/png" }), "mask.png");

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    const text = await response.text();
    console.log(`Image Edit response ${response.status}, length ${text.length}`);
    if (!response.ok) return null;
    const data = JSON.parse(text);
    const base64 = data.data?.[0]?.b64_json;
    if (typeof base64 !== "string" || base64.length < 100) return null;
    return { model: `${model} edit-outpaint-manual`, bytes: Buffer.from(base64, "base64") };
  } catch (error) {
    console.log(`Image Edit threw ${formatUnknownError(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryResponsesImageTool(referenceImageBase64) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.IMAGE_REQUEST_TIMEOUT_MS ?? 900000));
  try {
    const response = await openai.responses.create(
      {
        model: process.env.OPENAI_RESPONSE_MODEL || process.env.OPENAI_MODEL || "gpt-5.5",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: `data:image/png;base64,${referenceImageBase64}`, detail: "high" },
            ],
          },
        ],
        tools: [{ type: "image_generation", model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5", quality: "high", size: "1536x1024" }],
        reasoning: { effort: "medium" },
      },
      { signal: controller.signal },
    );
    const imageCall = response.output?.find((item) => item.type === "image_generation_call");
    const base64 = imageCall?.result;
    console.log(`Responses image tool status=${imageCall?.status ?? "missing"}, base64=${typeof base64 === "string" ? base64.length : 0}`);
    if (typeof base64 !== "string" || base64.length < 100) return null;
    return { model: `${process.env.OPENAI_RESPONSE_MODEL || process.env.OPENAI_MODEL} + ${process.env.OPENAI_IMAGE_MODEL}`, bytes: Buffer.from(base64, "base64") };
  } catch (error) {
    console.log(`Responses image tool threw ${formatUnknownError(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function persistImage(bytes) {
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => undefined);
  const storagePath = `scrolls/${SCROLL_ID}/${TARGET_INDEX}-${Date.now()}.png`;
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Supabase Storage 上传失败：${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

async function copyPreviousOverlapIntoNewImage(newImageBuffer, previousImageBuffer, featherWidth) {
  const normalizedNew = await sharp(newImageBuffer).resize(FULL_WIDTH, IMAGE_HEIGHT, { fit: "fill" }).png().toBuffer();
  const previousOverlap = await extractRightOverlapByWidth(previousImageBuffer, OVERLAP_WIDTH, IMAGE_HEIGHT);
  const composite = [{ input: previousOverlap, left: 0, top: 0, blend: "over" }];
  const safeFeatherWidth = Math.max(0, Math.min(Math.floor(featherWidth), OVERLAP_WIDTH));
  if (safeFeatherWidth > 0) {
    const featherRgb = await sharp(previousOverlap)
      .extract({ left: OVERLAP_WIDTH - safeFeatherWidth, top: 0, width: safeFeatherWidth, height: IMAGE_HEIGHT })
      .removeAlpha()
      .raw()
      .toBuffer();
    const featherRgba = Buffer.alloc(safeFeatherWidth * IMAGE_HEIGHT * 4);
    for (let y = 0; y < IMAGE_HEIGHT; y += 1) {
      for (let x = 0; x < safeFeatherWidth; x += 1) {
        const rgbOffset = (y * safeFeatherWidth + x) * 3;
        const rgbaOffset = (y * safeFeatherWidth + x) * 4;
        const alpha = Math.round(150 * (1 - x / Math.max(1, safeFeatherWidth - 1)));
        featherRgba[rgbaOffset] = featherRgb[rgbOffset];
        featherRgba[rgbaOffset + 1] = featherRgb[rgbOffset + 1];
        featherRgba[rgbaOffset + 2] = featherRgb[rgbOffset + 2];
        featherRgba[rgbaOffset + 3] = alpha;
      }
    }
    composite.push({
      input: await sharp(featherRgba, { raw: { width: safeFeatherWidth, height: IMAGE_HEIGHT, channels: 4 } }).png().toBuffer(),
      left: OVERLAP_WIDTH,
      top: 0,
      blend: "over",
    });
  }
  return sharp(normalizedNew).composite(composite).png().toBuffer();
}

async function calculateVisibleSeamQualityScore(imageBuffer, seamX, height, bandWidth) {
  const normalized = await sharp(imageBuffer).resize(FULL_WIDTH, height, { fit: "fill" }).png().toBuffer();
  const safeBandWidth = Math.max(1, Math.min(Math.floor(bandWidth), seamX, FULL_WIDTH - seamX));
  const leftBand = await sharp(normalized).extract({ left: seamX - safeBandWidth, top: 0, width: safeBandWidth, height }).removeAlpha().raw().toBuffer();
  const rightBand = await sharp(normalized).extract({ left: seamX, top: 0, width: safeBandWidth, height }).removeAlpha().raw().toBuffer();
  const length = Math.min(leftBand.length, rightBand.length);
  if (!length) return 0;
  let totalDifference = 0;
  for (let index = 0; index < length; index += 1) totalDifference += Math.abs(leftBand[index] - rightBand[index]);
  const meanDifference = totalDifference / length;
  return Math.max(0, Math.min(100, Math.round(100 - (meanDifference / 255) * 100)));
}

async function extractRightOverlapByWidth(imageBuffer, overlapWidth, height) {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? VISIBLE_WIDTH;
  const normalized = await sharp(imageBuffer).resize(width, height, { fit: "fill" }).png().toBuffer();
  return sharp(normalized).extract({ left: width - overlapWidth, top: 0, width: overlapWidth, height }).png().toBuffer();
}

async function createOutpaintCanvas(previousBuffer) {
  const previousOverlap = await extractRightOverlapByWidth(previousBuffer, OVERLAP_WIDTH, IMAGE_HEIGHT);
  const transparentCanvas = await sharp({
    create: { width: FULL_WIDTH, height: IMAGE_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  return sharp(transparentCanvas).composite([{ input: previousOverlap, left: 0, top: 0 }]).png().toBuffer();
}

async function createOutpaintMask() {
  const transparentMask = await sharp({
    create: { width: FULL_WIDTH, height: IMAGE_HEIGHT, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const lockedArea = await sharp({
    create: { width: OVERLAP_WIDTH, height: IMAGE_HEIGHT, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } },
  })
    .png()
    .toBuffer();
  return sharp(transparentMask).composite([{ input: lockedArea, left: 0, top: 0 }]).png().toBuffer();
}

async function finishJob(jobId, status, errorMessage = null) {
  const { error } = await supabase
    .from("generation_jobs")
    .update({ status, error_message: errorMessage, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw error;
}

function normalizeOpenAIBaseUrl(value) {
  if (!value) return undefined;
  const normalized = value.replace(/\/$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function formatUnknownError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function loadEnv(path) {
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    process.env[line.slice(0, index)] ??= line.slice(index + 1);
  }
}

function createRetryingFetch(timeoutMs) {
  const timeoutFetch = createTimeoutFetch(timeoutMs);
  return async function retryingFetch(input, init = {}) {
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await timeoutFetch(input, init);
      } catch (error) {
        lastError = error;
        const delayMs = attempt * 2000;
        console.log(`Supabase fetch attempt ${attempt} failed: ${formatUnknownError(error)}; retrying in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

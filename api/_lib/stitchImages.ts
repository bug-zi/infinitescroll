import sharp from "sharp";

export type StitchOptions = {
  overlapWidth: number;
  height: number;
  overlapRatio: number;
  width?: number;
};

export async function normalizeImageBuffer(imageBuffer: Buffer | Uint8Array, targetWidth: number, targetHeight: number) {
  return sharp(imageBuffer)
    .resize(targetWidth, targetHeight, { fit: "fill" })
    .png()
    .toBuffer();
}

export async function extractRightOverlap(imageBuffer: Buffer | Uint8Array, overlapRatio: number) {
  const normalized = await normalizeImageBuffer(imageBuffer, 1024, 768);
  const overlapWidth = Math.max(1, Math.round(1024 * overlapRatio));
  return extractRightOverlapByWidth(normalized, overlapWidth, 768);
}

export async function extractRightOverlapByWidth(imageBuffer: Buffer | Uint8Array, overlapWidth: number, height = 768) {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 1024;
  const normalized = await normalizeImageBuffer(imageBuffer, width, height);
  const safeOverlapWidth = Math.max(1, Math.min(overlapWidth, width));
  return sharp(normalized)
    .extract({ left: width - safeOverlapWidth, top: 0, width: safeOverlapWidth, height })
    .png()
    .toBuffer();
}

export async function copyPreviousOverlapIntoNewImage(
  newImageBuffer: Buffer | Uint8Array,
  previousImageBuffer: Buffer | Uint8Array,
  options: StitchOptions,
) {
  const normalizedNew = await normalizeImageBuffer(newImageBuffer, options.width ?? 1152, options.height);
  const resizedPrevOverlap = await extractRightOverlapByWidth(previousImageBuffer, options.overlapWidth, options.height);
  return sharp(normalizedNew)
    .composite([{ input: resizedPrevOverlap, left: 0, top: 0, blend: "over" }])
    .png()
    .toBuffer();
}

export async function createOutpaintCanvas(
  previousImageBuffer: Buffer | Uint8Array,
  width: number,
  height: number,
  overlapWidth: number,
  sourceOverlapWidth = overlapWidth,
  sourceHeight = height,
) {
  const previousOverlap = await extractRightOverlapByWidth(previousImageBuffer, sourceOverlapWidth, sourceHeight);
  const canvasOverlap = await sharp(previousOverlap)
    .resize(overlapWidth, height, { fit: "fill" })
    .png()
    .toBuffer();
  const transparentCanvas = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  return sharp(transparentCanvas).composite([{ input: canvasOverlap, left: 0, top: 0 }]).png().toBuffer();
}

export async function createOutpaintMask(width: number, height: number, overlapWidth: number) {
  const transparentMask = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const lockedArea = await sharp({
    create: {
      width: overlapWidth,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    },
  })
    .png()
    .toBuffer();
  return sharp(transparentMask).composite([{ input: lockedArea, left: 0, top: 0 }]).png().toBuffer();
}

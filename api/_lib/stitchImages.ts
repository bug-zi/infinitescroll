import sharp from "sharp";

export type StitchOptions = {
  overlapWidth: number;
  height: number;
  overlapRatio: number;
  width?: number;
  featherWidth?: number;
};

export type VisibleSeamScoreOptions = {
  seamX: number;
  height: number;
  bandWidth?: number;
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
  const composite: sharp.OverlayOptions[] = [{ input: resizedPrevOverlap, left: 0, top: 0, blend: "over" }];
  const featherWidth = Math.max(0, Math.min(Math.floor(options.featherWidth ?? 0), options.overlapWidth));
  if (featherWidth > 0) {
    const featherRgb = await sharp(resizedPrevOverlap)
      .extract({ left: Math.max(0, options.overlapWidth - featherWidth), top: 0, width: featherWidth, height: options.height })
      .resize(featherWidth, options.height, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();
    const featherRgba = Buffer.alloc(featherWidth * options.height * 4);
    for (let y = 0; y < options.height; y += 1) {
      for (let x = 0; x < featherWidth; x += 1) {
        const rgbOffset = (y * featherWidth + x) * 3;
        const rgbaOffset = (y * featherWidth + x) * 4;
        const alpha = Math.round(150 * (1 - x / Math.max(1, featherWidth - 1)));
        featherRgba[rgbaOffset] = featherRgb[rgbOffset];
        featherRgba[rgbaOffset + 1] = featherRgb[rgbOffset + 1];
        featherRgba[rgbaOffset + 2] = featherRgb[rgbOffset + 2];
        featherRgba[rgbaOffset + 3] = alpha;
      }
    }
    const featherSource = await sharp(featherRgba, { raw: { width: featherWidth, height: options.height, channels: 4 } })
      .png()
      .toBuffer();
    composite.push({ input: featherSource, left: options.overlapWidth, top: 0, blend: "over" });
  }
  return sharp(normalizedNew)
    .composite(composite)
    .png()
    .toBuffer();
}

export async function calculateVisibleSeamQualityScore(imageBuffer: Buffer | Uint8Array, options: VisibleSeamScoreOptions) {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? options.seamX * 2;
  const height = metadata.height ?? options.height;
  const normalized = await normalizeImageBuffer(imageBuffer, width, options.height);
  const seamX = Math.max(1, Math.min(Math.round(options.seamX), width - 1));
  const bandWidth = Math.max(1, Math.min(Math.floor(options.bandWidth ?? 48), seamX, width - seamX));

  const leftBand = await sharp(normalized)
    .extract({ left: seamX - bandWidth, top: 0, width: bandWidth, height: options.height })
    .removeAlpha()
    .raw()
    .toBuffer();
  const rightBand = await sharp(normalized)
    .extract({ left: seamX, top: 0, width: bandWidth, height: options.height })
    .removeAlpha()
    .raw()
    .toBuffer();
  const length = Math.min(leftBand.length, rightBand.length);
  if (!length || !height) return 0;

  let totalDifference = 0;
  for (let index = 0; index < length; index += 1) totalDifference += Math.abs(leftBand[index] - rightBand[index]);
  const meanDifference = totalDifference / length;
  return Math.max(0, Math.min(100, Math.round(100 - (meanDifference / 255) * 100)));
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

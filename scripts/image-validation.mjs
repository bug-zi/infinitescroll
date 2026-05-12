import sharp from "sharp";

export async function detectPaperBorderDrift(imageBytes) {
  const normalized = await sharp(imageBytes).resize(320, 200, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = normalized;
  const bandHeight = Math.max(12, Math.round(info.height * 0.11));
  const top = getBandStats(data, info.width, info.height, 0, bandHeight);
  const bottom = getBandStats(data, info.width, info.height, info.height - bandHeight, bandHeight);
  const middle = getBandStats(data, info.width, info.height, Math.round(info.height * 0.35), Math.round(info.height * 0.3));
  if (isPalePaperLike(top, middle) && isPalePaperLike(bottom, middle)) {
    return {
      hasPaperBorderDrift: true,
      reason: "Generated image appears to contain top and bottom paper border drift",
    };
  }
  return { hasPaperBorderDrift: false };
}

function getBandStats(data, width, height, top, bandHeight) {
  const startY = Math.max(0, Math.min(height - 1, top));
  const endY = Math.max(startY + 1, Math.min(height, startY + bandHeight));
  let red = 0;
  let green = 0;
  let blue = 0;
  let saturation = 0;
  let detail = 0;
  let detailSamples = 0;
  let count = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      red += r;
      green += g;
      blue += b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      saturation += max === 0 ? 0 : (max - min) / max;
      count += 1;

      if (x > 0) {
        const prevOffset = offset - 3;
        detail += Math.abs(r - (data[prevOffset] ?? 0)) + Math.abs(g - (data[prevOffset + 1] ?? 0)) + Math.abs(b - (data[prevOffset + 2] ?? 0));
        detailSamples += 3;
      }
      if (y > startY) {
        const prevRowOffset = ((y - 1) * width + x) * 3;
        detail += Math.abs(r - (data[prevRowOffset] ?? 0)) + Math.abs(g - (data[prevRowOffset + 1] ?? 0)) + Math.abs(b - (data[prevRowOffset + 2] ?? 0));
        detailSamples += 3;
      }
    }
  }

  const safeCount = Math.max(1, count);
  const meanRed = red / safeCount;
  const meanGreen = green / safeCount;
  const meanBlue = blue / safeCount;
  return {
    luma: 0.2126 * meanRed + 0.7152 * meanGreen + 0.0722 * meanBlue,
    saturation: saturation / safeCount,
    redBlueGap: meanRed - meanBlue,
    greenBlueGap: meanGreen - meanBlue,
    detail: detail / Math.max(1, detailSamples),
  };
}

function isPalePaperLike(band, middle) {
  const beigeHue = band.redBlueGap > 18 && band.greenBlueGap > 8;
  const pale = band.luma > 145 && band.luma < 235;
  const muted = band.saturation < 0.34;
  const flatterThanScene = band.detail < 16 && band.detail < middle.detail * 0.85 + 3;
  const brighterThanScene = band.luma > middle.luma + 18;
  return beigeHue && pale && muted && (flatterThanScene || brighterThanScene);
}

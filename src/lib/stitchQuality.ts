export const STITCH_WARNING_THRESHOLD = 82;

export function scoreMeanRgbDifference(meanDifference: number) {
  if (!Number.isFinite(meanDifference)) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - (meanDifference / 255) * 100)));
}

export function hasStitchRisk(score: number, threshold = STITCH_WARNING_THRESHOLD) {
  return Number.isFinite(score) && score > 0 && score < threshold;
}

export function formatStitchScore(score?: number) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "未评分";
  return `${Math.round(score)} 分`;
}

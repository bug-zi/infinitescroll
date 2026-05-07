export const SCROLL_IMAGE_HEIGHT = 1152;
export const SCROLL_VISIBLE_WIDTH = 1536;

export function getScrollImageDimensions(isFirst: boolean, overlapRatio: number) {
  const overlapWidth = isFirst ? 0 : Math.round(SCROLL_VISIBLE_WIDTH * overlapRatio);
  const width = SCROLL_VISIBLE_WIDTH + overlapWidth;
  return {
    width,
    height: SCROLL_IMAGE_HEIGHT,
    overlapWidth,
    visibleWidth: SCROLL_VISIBLE_WIDTH,
  };
}

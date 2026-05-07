import type { Scroll, ScrollImage } from "../types";

export type ImageOperationPlan = {
  nextImageCount: number;
  shouldPauseScroll: boolean;
  markFollowingForReview: boolean;
  logDetail: string;
};

export function planImageDeletion(scroll: Scroll, image: ScrollImage): ImageOperationPlan {
  const isTailImage = image.index === scroll.imageCount;
  return {
    nextImageCount: Math.max(0, scroll.imageCount - 1),
    shouldPauseScroll: !isTailImage,
    markFollowingForReview: !isTailImage,
    logDetail: isTailImage ? "末尾图片已删除" : "中间图片删除后已暂停自动生成并标记后续衔接风险",
  };
}

export function shouldRegenerateImmediately(scroll: Scroll, image: ScrollImage) {
  return image.index === scroll.imageCount;
}

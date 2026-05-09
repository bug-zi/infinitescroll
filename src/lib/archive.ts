import type { Scroll, ScrollImage } from "../types";

const ARCHIVE_RETENTION_DAYS = 7;

export function calculatePurgeAfter(archivedAtIso: string) {
  return new Date(Date.parse(archivedAtIso) + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function partitionArchivedScrolls(scrolls: Scroll[]) {
  return {
    active: scrolls.filter((scroll) => !scroll.archivedAt),
    archived: scrolls.filter((scroll) => Boolean(scroll.archivedAt)),
  };
}

export function partitionArchivedImages(images: ScrollImage[]) {
  return {
    active: images.filter((image) => !image.archivedAt),
    archived: images.filter((image) => Boolean(image.archivedAt)),
  };
}

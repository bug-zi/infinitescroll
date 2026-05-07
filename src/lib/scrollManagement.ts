import type { Scroll } from "../types";

export function chooseScrollAfterDeletion(scrolls: Scroll[], deletedScrollId: string, selectedScrollId: string) {
  if (deletedScrollId !== selectedScrollId) return selectedScrollId;

  const deletedIndex = scrolls.findIndex((scroll) => scroll.id === deletedScrollId);
  if (deletedIndex === -1) return selectedScrollId;

  const remaining = scrolls.filter((scroll) => scroll.id !== deletedScrollId);
  if (!remaining.length) return "";

  return remaining[Math.min(deletedIndex, remaining.length - 1)].id;
}

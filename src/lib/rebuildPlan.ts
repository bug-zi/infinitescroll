export type RebuildPlan = {
  startIndex: number;
  originalCount: number;
  targetCount: number;
  deleteFromIndex: number;
};

export function planRebuildFromIndex(startIndex: number, originalCount: number, targetCount = originalCount): RebuildPlan {
  if (!Number.isInteger(startIndex) || startIndex < 1) {
    throw new Error("startIndex must be a positive integer");
  }
  if (!Number.isInteger(originalCount) || originalCount < 0) {
    throw new Error("originalCount must be a non-negative integer");
  }
  if (!Number.isInteger(targetCount) || targetCount < startIndex) {
    throw new Error("targetCount must be at least startIndex");
  }

  return {
    startIndex,
    originalCount,
    targetCount,
    deleteFromIndex: startIndex,
  };
}

export function getRebuildIterations(plan: RebuildPlan) {
  return Math.max(0, plan.targetCount - plan.startIndex + 1);
}

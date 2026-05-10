const DEFAULT_STALE_RUNNING_JOB_MINUTES = 30;

export type CandidateScrollFilters = {
  scrollId?: string;
  requireAutoEnabled: boolean;
  dueBeforeIso?: string;
};

export function getCandidateScrollFilters({
  scrollId,
  manual = false,
  nowIso = new Date().toISOString(),
}: {
  scrollId?: string | null;
  manual?: boolean;
  nowIso?: string;
}): CandidateScrollFilters {
  return {
    scrollId: scrollId ?? undefined,
    requireAutoEnabled: !manual,
    dueBeforeIso: manual || scrollId ? undefined : nowIso,
  };
}

export function isStaleRunningJob({
  lockedAt,
  nowIso = new Date().toISOString(),
  staleAfterMinutes = Number(process.env.STALE_RUNNING_JOB_MINUTES ?? DEFAULT_STALE_RUNNING_JOB_MINUTES),
}: {
  lockedAt?: string | null;
  nowIso?: string;
  staleAfterMinutes?: number;
}) {
  if (!lockedAt) return false;
  const lockedTime = Date.parse(lockedAt);
  const nowTime = Date.parse(nowIso);
  if (Number.isNaN(lockedTime) || Number.isNaN(nowTime)) return false;
  return nowTime - lockedTime > staleAfterMinutes * 60000;
}

export function canPersistGeneratedJobResult({
  jobStatus,
  existingImageId,
}: {
  jobStatus?: string | null;
  existingImageId?: string | null;
}) {
  return jobStatus === "running" && !existingImageId;
}

export function isStoryTargetBeyondEnd({
  generationMode,
  storyTotalFrames,
  targetIndex,
}: {
  generationMode?: string | null;
  storyTotalFrames?: number | string | null;
  targetIndex: number;
}) {
  const totalFrames = Number(storyTotalFrames ?? 0);
  return generationMode === "story" && totalFrames > 0 && targetIndex > totalFrames;
}

export function shouldCompleteStoryAfterFrame({
  generationMode,
  storyTotalFrames,
  targetIndex,
}: {
  generationMode?: string | null;
  storyTotalFrames?: number | string | null;
  targetIndex: number;
}) {
  const totalFrames = Number(storyTotalFrames ?? 0);
  return generationMode === "story" && totalFrames > 0 && targetIndex >= totalFrames;
}

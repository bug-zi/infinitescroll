export type ScrollStatus = "generating" | "paused" | "complete";

export type ImageStatus = "succeeded" | "queued" | "generating" | "failed" | "needs_review";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobType = "auto_next" | "regenerate" | "insert_before" | "insert_after";

export type OverlapPreset = "standard" | "strong" | "maximum";

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScrollImage {
  id: string;
  scrollId: string;
  index: number;
  title: string;
  src: string;
  generatedAt: string;
  prompt: string;
  model: string;
  status: ImageStatus;
  fileSize: string;
  dimensions: {
    width: number;
    height: number;
    ratioLabel: string;
  };
  visibleCrop: CropRegion;
  overlapCrop: CropRegion;
  newContentCrop: CropRegion;
  hasStitchWarning?: boolean;
  stitchQualityScore?: number;
}

export interface Scroll {
  id: string;
  title: string;
  status: ScrollStatus;
  originalTheme: string;
  optimizedPrompt: string;
  createdAt: string;
  lastGeneratedAt: string;
  nextRunAt: string;
  intervalMinutes: number;
  overlapPreset: OverlapPreset;
  overlapRatio: number;
  imageCount: number;
  autoGenerationEnabled: boolean;
  thumbnail: string;
}

export interface GenerationJob {
  id: string;
  scrollId: string;
  targetIndex: number;
  type: JobType;
  status: JobStatus;
  scheduledFor: string;
  errorMessage?: string;
}

export interface GenerationLog {
  id: string;
  scrollId: string;
  level: "success" | "info" | "warning" | "error";
  message: string;
  detail: string;
  createdAt: string;
}

export interface SystemStatus {
  cronRunning: boolean;
  nextGlobalRunLabel: string;
  generatedToday: number;
  totalGenerated: number;
  apiHealthPercent: number;
  activeConcurrentJobs: number;
  maxConcurrentJobs: number;
}

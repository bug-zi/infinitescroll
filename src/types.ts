export type ScrollStatus = "generating" | "paused" | "complete";

export type ImageStatus = "succeeded" | "queued" | "generating" | "failed" | "needs_review";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobType = "auto_next" | "regenerate" | "insert_before" | "insert_after";

export type OverlapPreset = "standard" | "strong" | "maximum";

export type GenerationMode = "free" | "story";

export interface CreativePlan {
  mode?: GenerationMode;
  storyTemplate?: string | null;
  storyTemplateVersion?: string | null;
  storyFrameIndex?: number | null;
  storyTotalFrames?: number | null;
  chapter?: string;
  title: string;
  continuityAnchor: string;
  newScene: string;
  composition: string;
  forbidden: string;
  promptFragment: string;
  characters?: string[];
  location?: string;
  mood?: string;
}

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
  archivedAt?: string | null;
  purgeAfter?: string | null;
}

export interface Scroll {
  id: string;
  title: string;
  status: ScrollStatus;
  originalTheme: string;
  optimizedPrompt: string;
  generationMode?: GenerationMode;
  storyTemplate?: string | null;
  storyTemplateVersion?: string | null;
  storyTotalFrames?: number | null;
  scriptSummary?: string | null;
  characterBible?: string | null;
  createdAt: string;
  lastGeneratedAt: string;
  nextRunAt: string;
  intervalMinutes: number;
  overlapPreset: OverlapPreset;
  overlapRatio: number;
  imageCount: number;
  autoGenerationEnabled: boolean;
  thumbnail: string;
  archivedAt?: string | null;
  purgeAfter?: string | null;
}

export interface GenerationJob {
  id: string;
  scrollId: string;
  targetIndex: number;
  type: JobType;
  status: JobStatus;
  scheduledFor: string;
  creativePlan?: CreativePlan;
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
  serviceRunning: boolean;
  autoGenerationEnabled: boolean;
  nextGlobalRunLabel: string;
  generatedToday: number;
  totalGenerated: number;
  apiHealthPercent: number;
  activeConcurrentJobs: number;
  maxConcurrentJobs: number;
  failedJobs: number;
  activeScrolls: number;
  statusError: string | null;
}

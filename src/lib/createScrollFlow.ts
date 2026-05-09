import { detectStoryMode } from "./storyMode";

export type CreateScrollPayload = {
  theme: string;
  optimizedPrompt: string;
};

export function buildCreateScrollPayload(input: CreateScrollPayload) {
  return {
    theme: input.theme.trim(),
    optimizedPrompt: input.optimizedPrompt.trim(),
  };
}

export function canCreateBlankScroll(input: CreateScrollPayload) {
  return buildCreateScrollPayload(input).theme.length > 0;
}

export function detectGenerationMode(theme: string, optimizedPrompt: string) {
  return detectStoryMode(theme, optimizedPrompt);
}

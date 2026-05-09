export const JOURNEY_TO_WEST_TEMPLATE = "journey_to_west";
export const JOURNEY_TO_WEST_TEMPLATE_VERSION = "v1";
export const JOURNEY_TO_WEST_TOTAL_FRAMES = 128;

export type StoryModeDetection = {
  generationMode: "free" | "story";
  storyTemplate: string | null;
  storyTemplateVersion: string | null;
  storyTotalFrames: number | null;
};

export function isJourneyToWestTheme(theme = "", prompt = "") {
  const text = `${theme}\n${prompt}`.toLowerCase();
  return /西游记|西遊記|取经|取經|唐僧|孙悟空|孫悟空|悟空|猪八戒|豬八戒|沙僧|白龙马|白龍馬/.test(text);
}

export function detectStoryMode(theme = "", prompt = ""): StoryModeDetection {
  if (!isJourneyToWestTheme(theme, prompt)) {
    return {
      generationMode: "free",
      storyTemplate: null,
      storyTemplateVersion: null,
      storyTotalFrames: null,
    };
  }

  return {
    generationMode: "story",
    storyTemplate: JOURNEY_TO_WEST_TEMPLATE,
    storyTemplateVersion: JOURNEY_TO_WEST_TEMPLATE_VERSION,
    storyTotalFrames: JOURNEY_TO_WEST_TOTAL_FRAMES,
  };
}

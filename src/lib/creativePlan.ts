import type { CreativePlan } from "../types.js";
import { getJourneyToWestFrame, getJourneyToWestTemplateMeta, JOURNEY_TO_WEST_STORYBOARD } from "./journeyToWestStoryboard";
import { detectStoryMode } from "./storyMode";

export { JOURNEY_TO_WEST_STORYBOARD };

export type CreativePlanInput = {
  theme?: string | null;
  optimizedPrompt?: string | null;
  previousPrompt?: string | null;
  targetIndex: number;
  hasReferenceImage?: boolean;
  generationMode?: "free" | "story" | null;
  storyTemplate?: string | null;
  storyTemplateVersion?: string | null;
  storyTotalFrames?: number | null;
};

const PLAN_ARCS = [
  {
    title: "主题空间延展",
    newScene: "向右展开与主题相关的主要空间、人物活动、道路或水系，让新内容从上一段自然延伸。",
  },
  {
    title: "人群事件推进",
    newScene: "安排与主题一致的人物队伍、器物、建筑和局部事件，使叙事继续向右推进。",
  },
  {
    title: "地貌建筑承接",
    newScene: "延续前段的地貌、建筑高度、路径方向和远景层次，并加入新的主题场景。",
  },
  {
    title: "局部高潮展开",
    newScene: "在中右部展开更密集的主题事件，同时为下一张保留清晰的右缘衔接线索。",
  },
  {
    title: "节奏过渡续写",
    newScene: "用较舒缓的主题空间、人物行动和环境细节承接上一段，避免突然切换场景。",
  },
  {
    title: "远景层次续写",
    newScene: "补充与主题一致的远景、道路、水系或建筑群，让画卷保持横向连续纵深。",
  },
];

function cleanText(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pickArc(targetIndex: number) {
  return PLAN_ARCS[Math.abs(targetIndex - 1) % PLAN_ARCS.length];
}

function shortThemeLabel(theme: string) {
  return theme.length > 14 ? `${theme.slice(0, 14)}...` : theme;
}

function buildThemeScene(theme: string, arcScene: string, optimizedPrompt: string, isFirst: boolean) {
  const promptCue = optimizedPrompt ? `依据长期方向“${optimizedPrompt}”` : "依据用户确认的主题方向";
  return isFirst
    ? `${promptCue}，建立“${theme}”的开篇场景：先交代核心人物、主要环境、道路或动线，并在右缘留下可继续延展的景物线索。`
    : `${promptCue}，围绕“${theme}”${arcScene}`;
}

export function createCreativePlan(input: CreativePlanInput): CreativePlan {
  const targetIndex = Math.max(1, Math.floor(input.targetIndex));
  const theme = cleanText(input.theme) || "连续横向画卷";
  const optimizedPrompt = cleanText(input.optimizedPrompt);
  const detection = detectStoryMode(theme, optimizedPrompt);
  const isStoryMode = input.generationMode === "story" || (!input.generationMode && detection.generationMode === "story");
  if (isStoryMode && (input.storyTemplate ?? detection.storyTemplate) === "journey_to_west") {
    return createJourneyToWestPlan({ ...input, theme, optimizedPrompt, targetIndex });
  }

  const isFirst = targetIndex === 1;
  const arc = pickArc(targetIndex);
  const previousPrompt = cleanText(input.previousPrompt);
  const continuityAnchor = isFirst
    ? `建立可持续延展的“${theme}”画卷开篇，明确道路、水系或行动方向、建筑/山石高度、远景层次和人物动线，为后续画面留下清晰右缘。`
    : "锁定上一张右缘的道路、水线、建筑高度、地平线、光照方向和人群行进方向。";
  const composition = isFirst
    ? "主体从中景展开，右缘保留可继续延伸的道路、水系、建筑轮廓、山石走势或人物方向。"
    : "左侧重叠区只负责承接，主体事件放在中右部；道路、水系、建筑轮廓、山石走势和人物方向保持同一延展逻辑。";
  const forbidden = isFirst
    ? "不得出现现代物品、文字、水印、边框或孤立大特写；不得把第一张画成封面海报；不得偏离用户主题。"
    : "不得改动左侧重叠区；不得突然换时代、季节、视角、光照或主题；不得用大面积空景打断画卷节奏。";
  const newScene = buildThemeScene(theme, arc.newScene, optimizedPrompt, isFirst);

  return {
    mode: "free",
    title: `第 ${targetIndex} 张：${shortThemeLabel(theme)}${isFirst ? "开篇" : arc.title}`,
    continuityAnchor,
    newScene,
    composition,
    forbidden,
    promptFragment: [
      `画卷主题：${theme}`,
      optimizedPrompt ? `长期风格方向：${optimizedPrompt}` : "",
      previousPrompt ? `上一张内容线索：${previousPrompt}` : "",
      input.hasReferenceImage ? "已提供上一张右缘参考图，必须把它作为硬衔接锚点。" : "未提供上一张右缘参考图时，仍要保持横向长卷叙事连续。",
      `本张计划：${newScene}`,
      `衔接要求：${continuityAnchor}`,
      `构图要求：${composition}`,
      `禁止偏移：${forbidden}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function createJourneyToWestPlan(input: CreativePlanInput & { theme: string; optimizedPrompt: string; targetIndex: number }): CreativePlan {
  const frame = getJourneyToWestFrame(input.targetIndex);
  const meta = getJourneyToWestTemplateMeta();
  const isOverflow = input.targetIndex > meta.storyTotalFrames;
  const previousPrompt = cleanText(input.previousPrompt);
  const title = `第 ${frame.frameIndex} / ${meta.storyTotalFrames} 帧：${frame.title}`;
  const composition = [
    `以经典中国连环画分镜构图表现“${frame.title}”：主体人物置于中景，场景从左到右形成阅读动线。`,
    "相邻帧允许换地点，用云气、山水、卷轴纹理、道路方向和统一色调完成分镜长卷过渡。",
    input.hasReferenceImage ? "左侧参考图只作为色调与卷轴衔接参考，不得牺牲当前剧情准确性。" : "",
  ]
    .filter(Boolean)
    .join("");
  const forbidden = isOverflow ? `剧情模板已经到达末尾。${frame.forbidden}` : frame.forbidden;

  return {
    mode: "story",
    storyTemplate: meta.storyTemplate,
    storyTemplateVersion: meta.storyTemplateVersion,
    storyFrameIndex: frame.frameIndex,
    storyTotalFrames: meta.storyTotalFrames,
    chapter: frame.chapter,
    title,
    continuityAnchor: frame.continuityAnchor,
    newScene: frame.scene,
    composition,
    forbidden,
    characters: frame.characters,
    location: frame.location,
    mood: frame.mood,
    promptFragment: [
      "剧情模式：西游记经典主线连环画。",
      `剧情进度：第 ${frame.frameIndex} / ${meta.storyTotalFrames} 帧。`,
      `章节：${frame.chapter}`,
      `当前剧情帧：${frame.title}`,
      `主要人物：${frame.characters.join("、")}`,
      `场景地点：${frame.location}`,
      `情绪氛围：${frame.mood}`,
      `当前画面：${frame.scene}`,
      previousPrompt ? `上一帧内容线索：${previousPrompt}` : "",
      `分镜衔接：${frame.continuityAnchor}`,
      `构图要求：${composition}`,
      `禁止偏移：${forbidden}`,
      "只画当前剧情帧，不得提前画后续剧情，不得跳过剧情，不得把画面改成泛泛山水、清明上河图市井或无关古风场景。",
      "角色一致性：孙悟空保持金箍棒、猴相、行者装束；唐僧保持僧衣与温和端正气质；猪八戒保持钉耙和憨态；沙僧保持行者挑担气质；白龙马保持白马形象。",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function field(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCreativePlan(value: unknown, fallbackInput: CreativePlanInput): CreativePlan {
  const fallback = createCreativePlan(fallbackInput);
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const characters = Array.isArray(record.characters) ? record.characters.map((item) => String(item).trim()).filter(Boolean) : fallback.characters;
  const plan = {
    mode: record.mode === "story" || record.mode === "free" ? record.mode : fallback.mode,
    storyTemplate: field(record.storyTemplate) || fallback.storyTemplate,
    storyTemplateVersion: field(record.storyTemplateVersion) || fallback.storyTemplateVersion,
    storyFrameIndex: Number.isFinite(Number(record.storyFrameIndex)) ? Number(record.storyFrameIndex) : fallback.storyFrameIndex,
    storyTotalFrames: Number.isFinite(Number(record.storyTotalFrames)) ? Number(record.storyTotalFrames) : fallback.storyTotalFrames,
    chapter: field(record.chapter) || fallback.chapter,
    title: field(record.title) || fallback.title,
    continuityAnchor: field(record.continuityAnchor) || fallback.continuityAnchor,
    newScene: field(record.newScene) || fallback.newScene,
    composition: field(record.composition) || fallback.composition,
    forbidden: field(record.forbidden) || fallback.forbidden,
    promptFragment: field(record.promptFragment),
    characters,
    location: field(record.location) || fallback.location,
    mood: field(record.mood) || fallback.mood,
  };
  return {
    ...plan,
    promptFragment:
      plan.promptFragment ||
      [
        plan.mode === "story" ? `剧情进度：第 ${plan.storyFrameIndex ?? fallback.storyFrameIndex} / ${plan.storyTotalFrames ?? fallback.storyTotalFrames} 帧` : "",
        plan.chapter ? `章节：${plan.chapter}` : "",
        plan.characters?.length ? `主要人物：${plan.characters.join("、")}` : "",
        plan.location ? `场景地点：${plan.location}` : "",
        `本张计划：${plan.newScene}`,
        `衔接要求：${plan.continuityAnchor}`,
        `构图要求：${plan.composition}`,
        `禁止偏移：${plan.forbidden}`,
      ].join("\n"),
  };
}

export function buildCreativePlanPromptSection(plan: CreativePlan) {
  return [
    "Creative plan for this exact segment:",
    plan.mode === "story" ? "Generation mode: story storyboard. Story continuity has priority over seamless same-location expansion." : "Generation mode: free scroll continuation.",
    plan.mode === "story" ? `Story progress: frame ${plan.storyFrameIndex} of ${plan.storyTotalFrames}, chapter ${plan.chapter ?? ""}` : "",
    `Title: ${plan.title}`,
    plan.characters?.length ? `Characters: ${plan.characters.join(", ")}` : "",
    plan.location ? `Location: ${plan.location}` : "",
    plan.mood ? `Mood: ${plan.mood}` : "",
    `Continuity anchor: ${plan.continuityAnchor}`,
    `New scene: ${plan.newScene}`,
    `Composition: ${plan.composition}`,
    `Forbidden drift: ${plan.forbidden}`,
    "Follow this plan exactly; the visible generation plan shown to the user is this same plan.",
    plan.promptFragment,
  ].join("\n");
}

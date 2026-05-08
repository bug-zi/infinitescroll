import type { CreativePlan } from "../types.js";

export type CreativePlanInput = {
  theme?: string | null;
  optimizedPrompt?: string | null;
  previousPrompt?: string | null;
  targetIndex: number;
  hasReferenceImage?: boolean;
};

const PLAN_ARCS = [
  {
    title: "河岸街市延展",
    newScene: "向右展开河岸茶肆、卸货小船、挑担行人、临街摊铺与停靠车马，让市井活动从上一段自然延伸。",
  },
  {
    title: "桥市人潮推进",
    newScene: "展开桥头人潮、货担队列、临水店铺、船工与看客，使道路和河道同时向右推进。",
  },
  {
    title: "城门道路承接",
    newScene: "展开通向城门的道路、驴车、行商、守门兵士与墙根摊贩，让空间从郊野进入城郭。",
  },
  {
    title: "坊巷商铺展开",
    newScene: "展开茶楼酒肆、幌子招牌、门前顾客、穿街儿童和运货车马，让街市密度逐步升高。",
  },
  {
    title: "水巷宅院过渡",
    newScene: "展开水边宅院、柳树、石阶、停泊小舟与搬运行人，让繁华街市暂时转入生活场景。",
  },
  {
    title: "远郊田畴续写",
    newScene: "展开田畴、村舍、驿路、农人和远山薄雾，让画卷节奏从密集市井舒缓过渡。",
  },
];

function cleanText(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pickArc(targetIndex: number) {
  return PLAN_ARCS[Math.abs(targetIndex - 1) % PLAN_ARCS.length];
}

export function createCreativePlan(input: CreativePlanInput): CreativePlan {
  const targetIndex = Math.max(1, Math.floor(input.targetIndex));
  const isFirst = targetIndex === 1;
  const arc = pickArc(targetIndex);
  const theme = cleanText(input.theme) || "连续横向中国手卷";
  const optimizedPrompt = cleanText(input.optimizedPrompt);
  const previousPrompt = cleanText(input.previousPrompt);
  const continuityAnchor = isFirst
    ? "建立可持续延展的河道、道路、屋檐高度、远山层次和人群动线，为后续画面留下清晰右缘。"
    : "锁定上一张右缘的河道水线、桥梁弧线、岸边道路、屋檐高度和人群行进方向。";
  const composition = isFirst
    ? "主体从中景展开，右缘保留可继续延伸的道路、水系、建筑轮廓和人物方向。"
    : "左侧重叠区只负责承接，主体事件放在中右部；河道、道路和屋檐线保持同一消失方向。";
  const forbidden = isFirst
    ? "不得出现现代物品、文字、水印、边框或孤立大特写；不得把第一张画成封面海报。"
    : "不得改动左侧重叠区；不得突然换时代、季节、视角或光照；不得用大面积空景打断画卷节奏。";

  return {
    title: `第 ${targetIndex} 张：${arc.title}`,
    continuityAnchor,
    newScene: arc.newScene,
    composition,
    forbidden,
    promptFragment: [
      `画卷主题：${theme}`,
      optimizedPrompt ? `长期风格方向：${optimizedPrompt}` : "",
      previousPrompt ? `上一张内容线索：${previousPrompt}` : "",
      input.hasReferenceImage ? "已提供上一张右缘参考图，必须把它作为硬衔接锚点。" : "未提供上一张右缘参考图时，仍要保持横向长卷叙事连续。",
      `本张计划：${arc.newScene}`,
      `衔接要求：${continuityAnchor}`,
      `构图要求：${composition}`,
      `禁止偏移：${forbidden}`,
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
  const plan = {
    title: field(record.title) || fallback.title,
    continuityAnchor: field(record.continuityAnchor) || fallback.continuityAnchor,
    newScene: field(record.newScene) || fallback.newScene,
    composition: field(record.composition) || fallback.composition,
    forbidden: field(record.forbidden) || fallback.forbidden,
    promptFragment: field(record.promptFragment),
  };
  return {
    ...plan,
    promptFragment:
      plan.promptFragment ||
      [
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
    `Title: ${plan.title}`,
    `Continuity anchor: ${plan.continuityAnchor}`,
    `New scene: ${plan.newScene}`,
    `Composition: ${plan.composition}`,
    `Forbidden drift: ${plan.forbidden}`,
    "Follow this plan exactly; the visible generation plan shown to the user is this same plan.",
    plan.promptFragment,
  ].join("\n");
}

import type { GenerationJob, GenerationLog, Scroll, ScrollImage, SystemStatus } from "../types";
import { createCreativePlan } from "../lib/creativePlan";
import { FIXED_OVERLAP_PRESET, FIXED_OVERLAP_RATIO, getStitchCrops } from "../lib/stitching";

const baseImage = "/assets/scroll-segment.svg";

const scrollId = "scroll-qingming";
const fixedCrops = getStitchCrops(1152, 768);

export const mockScrolls: Scroll[] = [
  {
    id: scrollId,
    title: "清明上河图风格画卷",
    status: "generating",
    originalTheme: "参照《清明上河图》的风格，绘制北宋汴京城的繁华市井与自然风光",
    optimizedPrompt:
      "以《清明上河图》为风格蓝本，采用北宋时期的细密技法，细腻地描绘舟人物、建筑、船只、桥架等，淡雅的设色展现汴京城的繁华市井、街道商铺、城门城楼、河流桥梁、舟船往来、车马行人、田野村舍等场景，画面连贯、景物自然过渡，展现北宋社会的生活风貌与自然景色。",
    createdAt: "2024-05-20T10:30:00+08:00",
    lastGeneratedAt: "2024-05-20T10:55:12+08:00",
    nextRunAt: new Date(Date.now() + 192000).toISOString(),
    intervalMinutes: 5,
    overlapPreset: FIXED_OVERLAP_PRESET,
    overlapRatio: FIXED_OVERLAP_RATIO,
    imageCount: 12,
    autoGenerationEnabled: true,
    thumbnail: baseImage,
  },
  {
    id: "scroll-mountain",
    title: "山海经奇幻之旅",
    status: "paused",
    originalTheme: "山海经神话世界中的山川、异兽与古城",
    optimizedPrompt: "用古籍插画风格绘制山海经旅程，山川、异兽、城郭与旅人从左至右连续展开。",
    createdAt: "2024-05-18T09:10:00+08:00",
    lastGeneratedAt: "2024-05-18T14:40:00+08:00",
    nextRunAt: new Date(Date.now() + 864000).toISOString(),
    intervalMinutes: 5,
    overlapPreset: FIXED_OVERLAP_PRESET,
    overlapRatio: FIXED_OVERLAP_RATIO,
    imageCount: 8,
    autoGenerationEnabled: false,
    thumbnail: baseImage,
  },
  {
    id: "scroll-future",
    title: "未来城市幻想",
    status: "generating",
    originalTheme: "未来城市的空中轨道、市场与霓虹街区",
    optimizedPrompt: "横向展开未来城市街区，保持空中轨道和街道透视连续。",
    createdAt: "2024-05-19T16:00:00+08:00",
    lastGeneratedAt: "2024-05-20T10:50:00+08:00",
    nextRunAt: new Date(Date.now() + 422000).toISOString(),
    intervalMinutes: 5,
    overlapPreset: FIXED_OVERLAP_PRESET,
    overlapRatio: FIXED_OVERLAP_RATIO,
    imageCount: 15,
    autoGenerationEnabled: true,
    thumbnail: baseImage,
  },
  {
    id: "scroll-garden",
    title: "梦境花园",
    status: "complete",
    originalTheme: "梦境般的巨大花园和玻璃温室",
    optimizedPrompt: "用细腻插画绘制连续花园、温室、水渠和人物活动。",
    createdAt: "2024-05-10T11:20:00+08:00",
    lastGeneratedAt: "2024-05-12T18:15:00+08:00",
    nextRunAt: new Date(Date.now() + 7200000).toISOString(),
    intervalMinutes: 5,
    overlapPreset: FIXED_OVERLAP_PRESET,
    overlapRatio: FIXED_OVERLAP_RATIO,
    imageCount: 20,
    autoGenerationEnabled: false,
    thumbnail: baseImage,
  },
];

export const mockImages: ScrollImage[] = Array.from({ length: 12 }, (_, index) => {
  const isFirst = index === 0;
  const width = isFirst ? 1024 : 1152;
  const height = 768;
  const crops = isFirst
    ? {
        visibleCrop: { x: 0, y: 0, width, height },
        overlapCrop: { x: 0, y: 0, width: 0, height },
        newContentCrop: { x: 0, y: 0, width, height },
      }
    : fixedCrops;

  return {
    id: `image-${index + 1}`,
    scrollId,
    index: index + 1,
    title: `第 ${index + 1} 张`,
    src: baseImage,
    generatedAt: new Date(new Date("2024-05-20T10:10:12+08:00").getTime() + index * 5 * 60000).toISOString(),
    prompt: [
      "汴京城外的田野、村庄与远山",
      "拱桥与河面船只，市民聚集",
      "城门外道路、行人、车马往来",
      "城门与城墙，守城士兵与进出车辆",
      "街市铺面、茶楼与流动摊贩",
      "水边宅院与树影",
    ][index % 6],
    model: "GPT Image",
    status: "succeeded",
    fileSize: index === 0 ? "1.0 MB" : "1.2 MB",
    dimensions: {
      width,
      height,
      ratioLabel: "4:3",
    },
    ...crops,
    hasStitchWarning: false,
  };
});

export const mockJobs: GenerationJob[] = [
  {
    id: "job-13",
    scrollId,
    targetIndex: 13,
    type: "auto_next",
    status: "queued",
    scheduledFor: mockScrolls[0].nextRunAt,
    creativePlan: createCreativePlan({
      theme: mockScrolls[0].originalTheme,
      optimizedPrompt: mockScrolls[0].optimizedPrompt,
      previousPrompt: mockImages[11].prompt,
      targetIndex: 13,
      hasReferenceImage: true,
    }),
  },
  {
    id: "job-14",
    scrollId,
    targetIndex: 14,
    type: "auto_next",
    status: "queued",
    scheduledFor: new Date(Date.now() + 492000).toISOString(),
    creativePlan: createCreativePlan({
      theme: mockScrolls[0].originalTheme,
      optimizedPrompt: mockScrolls[0].optimizedPrompt,
      previousPrompt: mockImages[11].prompt,
      targetIndex: 14,
      hasReferenceImage: true,
    }),
  },
  {
    id: "job-15",
    scrollId,
    targetIndex: 15,
    type: "auto_next",
    status: "queued",
    scheduledFor: new Date(Date.now() + 792000).toISOString(),
    creativePlan: createCreativePlan({
      theme: mockScrolls[0].originalTheme,
      optimizedPrompt: mockScrolls[0].optimizedPrompt,
      previousPrompt: mockImages[11].prompt,
      targetIndex: 15,
      hasReferenceImage: true,
    }),
  },
  {
    id: "job-16",
    scrollId,
    targetIndex: 16,
    type: "auto_next",
    status: "queued",
    scheduledFor: new Date(Date.now() + 1092000).toISOString(),
    creativePlan: createCreativePlan({
      theme: mockScrolls[0].originalTheme,
      optimizedPrompt: mockScrolls[0].optimizedPrompt,
      previousPrompt: mockImages[11].prompt,
      targetIndex: 16,
      hasReferenceImage: true,
    }),
  },
  {
    id: "job-17",
    scrollId,
    targetIndex: 17,
    type: "auto_next",
    status: "queued",
    scheduledFor: new Date(Date.now() + 1392000).toISOString(),
    creativePlan: createCreativePlan({
      theme: mockScrolls[0].originalTheme,
      optimizedPrompt: mockScrolls[0].optimizedPrompt,
      previousPrompt: mockImages[11].prompt,
      targetIndex: 17,
      hasReferenceImage: true,
    }),
  },
];

export const mockLogs: GenerationLog[] = [
  {
    id: "log-12",
    scrollId,
    level: "success",
    message: "第 12 张生成成功",
    detail: "画面内容：汴京城外的田野、村庄与远山",
    createdAt: "2024-05-20T10:55:12+08:00",
  },
  {
    id: "log-11",
    scrollId,
    level: "success",
    message: "第 11 张生成成功",
    detail: "画面内容：城门外的道路、行人、车马往来",
    createdAt: "2024-05-20T10:50:11+08:00",
  },
  {
    id: "log-10",
    scrollId,
    level: "success",
    message: "第 10 张生成成功",
    detail: "画面内容：城门与城墙，守城士兵与进出车辆",
    createdAt: "2024-05-20T10:45:10+08:00",
  },
];

export const mockSystemStatus: SystemStatus = {
  cronRunning: true,
  serviceRunning: true,
  autoGenerationEnabled: true,
  nextGlobalRunLabel: "03:12",
  generatedToday: 12,
  totalGenerated: 156,
  apiHealthPercent: 75,
  activeConcurrentJobs: 1,
  maxConcurrentJobs: 2,
  failedJobs: 1,
  activeScrolls: 1,
  statusError: null,
};

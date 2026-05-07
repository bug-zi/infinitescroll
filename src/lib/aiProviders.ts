export interface PromptOptimizer {
  optimizeTheme(theme: string): Promise<string>;
  createSegmentPrompt(input: {
    optimizedPrompt: string;
    previousPrompt?: string;
    targetIndex: number;
  }): Promise<string>;
}

export interface ImageProvider {
  generateFirstSegment(input: {
    prompt: string;
    aspectRatio: "4:3";
  }): Promise<{ imageUrl: string; model: string }>;
  extendSegment(input: {
    prompt: string;
    previousRightEdgeUrl: string;
    overlapRatio: number;
  }): Promise<{ imageUrl: string; model: string }>;
}

export class MockDeepSeekOptimizer implements PromptOptimizer {
  async optimizeTheme(theme: string) {
    return `以「${theme}」为长卷核心主题，采用横向叙事构图，保持统一的时代质感、色彩温度与笔触密度。画面应从左至右自然推进，每一段包含可延续的道路、水系、建筑群、人群活动和远景层次，避免突兀断点。`;
  }

  async createSegmentPrompt(input: { optimizedPrompt: string; previousPrompt?: string; targetIndex: number }) {
    return `${input.optimizedPrompt} 当前生成第 ${input.targetIndex} 段，延续上一段右侧边缘的地形、道路、人群方向和光照，新增区域需要形成新的局部事件。`;
  }
}

export class MockImageProvider implements ImageProvider {
  async generateFirstSegment() {
    return {
      imageUrl: "/assets/scroll-segment.svg",
      model: "Mock GPT Image",
    };
  }

  async extendSegment() {
    return {
      imageUrl: "/assets/scroll-segment.svg",
      model: "Mock GPT Image",
    };
  }
}

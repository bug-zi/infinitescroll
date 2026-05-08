import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_request: VercelRequest, response: VercelResponse) {
  response.status(200).json({
    cronRunning: true,
    serviceRunning: true,
    autoGenerationEnabled: false,
    nextGlobalRunLabel: "由外部调度器触发",
    generatedToday: 0,
    totalGenerated: 0,
    apiHealthPercent: 100,
    activeConcurrentJobs: 0,
    maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
    failedJobs: 0,
    activeScrolls: 0,
    statusError: null,
  });
}

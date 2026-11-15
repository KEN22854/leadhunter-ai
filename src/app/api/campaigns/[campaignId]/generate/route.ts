import { ApiError, handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { generateMissingReferences } from "@/lib/campaigns";
import { isAIConfigured } from "@/lib/ai/provider";

export const runtime = "nodejs";

export const POST = handler(async (_req, { campaignId }) => {
  const user = await requireUser();
  if (!(await isAIConfigured()))
    throw new ApiError(503, "ai_not_configured", "AI не подключён: войдите в Claude Code на этом компьютере или задайте ANTHROPIC_API_KEY");
  return await generateMissingReferences(user, campaignId);
});

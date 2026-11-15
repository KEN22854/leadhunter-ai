import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aiStatus } from "@/lib/ai/provider";

export const GET = handler(async () => {
  const user = await requireUser();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const usage = await prisma.aIUsageLog.aggregate({
    where: { userId: user.id, createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true, costEstimate: true },
    _count: true,
  });
  return {
    ...(await aiStatus()),
    usage30d: {
      requests: usage._count,
      inputTokens: usage._sum.inputTokens ?? 0,
      outputTokens: usage._sum.outputTokens ?? 0,
      costUsd: usage._sum.costEstimate ?? 0,
    },
  };
});

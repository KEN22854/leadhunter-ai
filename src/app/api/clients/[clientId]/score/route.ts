import { handler } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const history = await prisma.leadScore.findMany({ where: { clientId }, orderBy: { calculatedAt: "desc" }, take: 20 });
  return { current: history[0] ?? null, history };
});

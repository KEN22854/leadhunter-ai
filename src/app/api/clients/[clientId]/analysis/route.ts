import { handler } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runAnalysis } from "@/lib/ai/service";

export const maxDuration = 300;

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const analyses = await prisma.leadAnalysis.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 10 });
  const sources = await prisma.leadSource.findMany({ where: { clientId }, select: { id: true, sourceUrl: true, title: true, sourceType: true, capturedAt: true } });
  return { analyses, sources };
});

export const POST = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const analysis = await runAnalysis(user, clientId);
  return { analysis };
});

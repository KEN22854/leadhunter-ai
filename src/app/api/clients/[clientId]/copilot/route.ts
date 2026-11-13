import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { copilotAsk } from "@/lib/ai/service";

export const maxDuration = 120;

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const messages = await prisma.copilotMessage.findMany({ where: { clientId, userId: user.id }, orderBy: { createdAt: "asc" }, take: 100 });
  return { messages };
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const { question } = await parseBody(req, z.object({ question: z.string().trim().min(1).max(4000) }));
  return await copilotAsk(user, clientId, question);
});

export const DELETE = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  await prisma.copilotMessage.deleteMany({ where: { clientId, userId: user.id } });
  return { ok: true };
});

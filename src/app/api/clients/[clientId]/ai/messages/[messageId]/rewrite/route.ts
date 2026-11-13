import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { REWRITE_COMMANDS, TONES, keysOf } from "@/lib/domain";
import { rewriteMessage } from "@/lib/ai/service";

export const maxDuration = 120;

const Body = z.object({
  command: z.enum(keysOf(REWRITE_COMMANDS)),
  body: z.string().min(1).max(20000),
  subject: z.string().max(500).optional(),
  selection: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).nullable().optional(),
  tone: z.enum(keysOf(TONES)).optional(),
  targetLanguage: z.string().max(10).optional(),
  instruction: z.string().max(1000).optional(),
});

export const POST = handler(async (req, { clientId, messageId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  if (!(await prisma.aIMessage.findFirst({ where: { id: messageId, clientId } }))) throw new ApiError(404, "not_found", "Сообщение не найдено");
  const b = await parseBody(req, Body);
  return await rewriteMessage(user, messageId, b);
});

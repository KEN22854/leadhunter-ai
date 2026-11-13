import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { queueOutbound } from "@/lib/outreach";
import type { Channel } from "@/lib/domain";

/** Подготовка ответа в существующей ветке (ожидает подтверждения). */
export const POST = handler(async (req, { clientId, conversationId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, clientId } });
  if (!conv || !conv.contactId) throw new ApiError(404, "not_found", "Переписка не найдена");
  const b = await parseBody(req, z.object({ subject: z.string().max(500).optional().default(""), body: z.string().trim().min(1).max(20000) }));
  return await queueOutbound(user, clientId, { channel: conv.channel as Channel, contactId: conv.contactId, subject: b.subject, body: b.body });
});

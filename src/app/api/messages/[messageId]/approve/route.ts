import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireAIMessage } from "@/lib/guards";
import { queueOutbound } from "@/lib/outreach";
import type { Channel } from "@/lib/domain";

/**
 * Подготовка сообщения к отправке: выбирается контакт, выполняются проверки (suppression, основание, статус контакта),
 * создаётся исходящее со статусом «ожидает подтверждения». Сама отправка — отдельным подтверждением (/api/outbound/:id/send).
 */
export const POST = handler(async (req, { messageId }) => {
  const user = await requireUser();
  const msg = await requireAIMessage(user, messageId);
  const b = await parseBody(req, z.object({ contactId: z.string(), subject: z.string().max(500).optional(), body: z.string().min(1).max(20000).optional() }));
  return await queueOutbound(user, msg.clientId, {
    channel: msg.channel as Channel,
    contactId: b.contactId,
    subject: b.subject ?? msg.subject,
    body: b.body ?? msg.body,
    aiMessageId: msg.id,
  });
});

import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireOutbound } from "@/lib/guards";

/** Правка текста исходящего до отправки (только «ожидает подтверждения» / «ошибка»). */
export const PATCH = handler(async (req, { itemId }) => {
  const user = await requireUser();
  const item = await requireOutbound(user, itemId);
  if (!["pending_approval", "failed"].includes(item.status)) throw new ApiError(409, "invalid_state", "Отправленное сообщение нельзя изменить");
  const b = await parseBody(req, z.object({ subject: z.string().max(500).optional(), body: z.string().min(1).max(20000).optional() }));
  return { item: await prisma.conversationMessage.update({ where: { id: itemId }, data: b }) };
});

/** Отмена неотправленного сообщения. */
export const DELETE = handler(async (_req, { itemId }) => {
  const user = await requireUser();
  const item = await requireOutbound(user, itemId);
  if (!["pending_approval", "failed", "draft"].includes(item.status)) throw new ApiError(409, "invalid_state", "Нельзя отменить отправленное сообщение");
  await prisma.conversationMessage.delete({ where: { id: itemId } });
  return { ok: true };
});

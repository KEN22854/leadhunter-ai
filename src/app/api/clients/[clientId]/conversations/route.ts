import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { channelStatuses } from "@/lib/channels";
import { CHANNELS, keysOf } from "@/lib/domain";
import { logManualMessage } from "@/lib/outreach";

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const conversations = await prisma.conversation.findMany({
    where: { clientId },
    include: { contact: true, items: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return { conversations, channels: channelStatuses() };
});

/** Ручная регистрация: входящий ответ (для каналов без API входящих) или отметка ручной отправки (например, LinkedIn). */
const Body = z.object({
  channel: z.enum(keysOf(CHANNELS)),
  contactId: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string().trim().min(1).max(20000),
  subject: z.string().max(500).optional(),
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const b = await parseBody(req, Body);
  return { item: await logManualMessage(user, clientId, b) };
});

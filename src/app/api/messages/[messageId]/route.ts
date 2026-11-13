import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAIMessage } from "@/lib/guards";
import { logInteraction } from "@/lib/timeline";

export const GET = handler(async (_req, { messageId }) => {
  const user = await requireUser();
  await requireAIMessage(user, messageId);
  const message = await prisma.aIMessage.findUniqueOrThrow({ where: { id: messageId }, include: { versions: { orderBy: { version: "desc" } } } });
  return { message };
});

const Patch = z.object({
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(20000).optional(),
  status: z.enum(["draft", "saved", "archived"]).optional(),
  contactId: z.string().nullable().optional(),
  note: z.string().max(200).optional(),
});

/** Сохранение правок: каждое изменение текста — новая версия. */
export const PATCH = handler(async (req, { messageId }) => {
  const user = await requireUser();
  const msg = await requireAIMessage(user, messageId);
  const b = await parseBody(req, Patch);
  const textChanged = (b.body !== undefined && b.body !== msg.body) || (b.subject !== undefined && b.subject !== msg.subject);
  const data: Record<string, unknown> = {};
  if (b.status) data.status = b.status;
  if (b.contactId !== undefined) {
    data.contactId = b.contactId && (await prisma.contact.findFirst({ where: { id: b.contactId, clientId: msg.clientId } })) ? b.contactId : null;
  }
  if (textChanged) {
    const version = msg.version + 1;
    data.body = b.body ?? msg.body;
    data.subject = b.subject ?? msg.subject;
    data.version = version;
    if (!b.status && msg.status === "draft") data.status = "saved";
    await prisma.aIMessageVersion.create({
      data: { messageId, version, subject: (b.subject ?? msg.subject) as string, body: (b.body ?? msg.body) as string, origin: "edited", note: b.note ?? "Ручное редактирование" },
    });
    await logInteraction(msg.clientId, "message_edited", `Сообщение отредактировано (v${version})`, user, { messageId });
  } else if (b.status === "saved" && msg.status === "draft") {
    await logInteraction(msg.clientId, "message_edited", "Черновик сохранён в карточке", user, { messageId });
  }
  const message = await prisma.aIMessage.update({ where: { id: messageId }, data });
  return { message };
});

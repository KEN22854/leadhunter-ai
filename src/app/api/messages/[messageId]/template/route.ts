import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAIMessage } from "@/lib/guards";

/** Сохранение сообщения как шаблона. Название компании заменяется на переменную {{company}}. */
export const POST = handler(async (req, { messageId }) => {
  const user = await requireUser();
  const msg = await requireAIMessage(user, messageId);
  const b = await parseBody(req, z.object({ name: z.string().trim().min(1).max(200), category: z.string().max(100).optional().default("") }));
  const client = await prisma.client.findUniqueOrThrow({ where: { id: msg.clientId } });
  const esc = client.companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toVars = (s: string) => (client.companyName ? s.replace(new RegExp(esc, "g"), "{{company}}") : s);
  const template = await prisma.messageTemplate.create({
    data: {
      ownerId: user.id,
      name: b.name,
      category: b.category,
      channel: msg.channel,
      language: msg.language,
      subject: toVars(msg.subject),
      content: toVars(msg.body),
      variables: ["company", "city", "website", "industry"],
    },
  });
  return { template };
});

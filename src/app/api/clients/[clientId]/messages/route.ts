import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CHANNELS, LANGUAGES, keysOf } from "@/lib/domain";
import { logInteraction } from "@/lib/timeline";

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const messages = await prisma.aIMessage.findMany({
    where: { clientId, status: { not: "archived" } },
    orderBy: { createdAt: "desc" },
    take: 60,
    include: { _count: { select: { versions: true } } },
  });
  return { messages };
});

/** Ручной черновик или черновик из шаблона (без AI). */
const Create = z.object({
  channel: z.enum(keysOf(CHANNELS)),
  language: z.enum(keysOf(LANGUAGES)).optional().default("ru"),
  subject: z.string().max(500).optional().default(""),
  body: z.string().max(20000).optional().default(""),
  templateId: z.string().optional(),
  contactId: z.string().nullable().optional(),
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  const client = await requireClientAccess(user, clientId);
  const b = await parseBody(req, Create);
  let { subject, body } = b;
  if (b.templateId) {
    const t = await prisma.messageTemplate.findFirst({ where: { id: b.templateId, ownerId: user.id } });
    if (!t) throw new ApiError(404, "not_found", "Шаблон не найден");
    const vars: Record<string, string> = { company: client.companyName, city: client.city, website: client.website, industry: client.industry };
    const fill = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
    subject = fill(t.subject);
    body = fill(t.content);
  }
  if (!body.trim()) throw new ApiError(400, "empty", "Текст сообщения пуст");
  const msg = await prisma.aIMessage.create({
    data: {
      clientId,
      contactId: b.contactId ?? null,
      generationId: randomUUID(),
      variantKey: "manual",
      label: b.templateId ? "Из шаблона" : "Вручную",
      channel: b.channel,
      language: b.language === "auto" ? client.language : b.language,
      tone: "",
      goal: "",
      service: "",
      length: "",
      subject: b.channel === "email" ? subject : "",
      body,
      personalization: [],
      assumptions: [],
      warnings: [],
      status: "saved",
      versions: { create: { version: 1, subject, body, origin: "edited", note: b.templateId ? "Создано из шаблона" : "Создано вручную" } },
    },
  });
  await logInteraction(clientId, "message_edited", "Создан черновик сообщения", user, { messageId: msg.id });
  return { message: msg };
});

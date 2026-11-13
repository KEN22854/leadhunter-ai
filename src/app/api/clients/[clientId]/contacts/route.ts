import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CONTACT_TYPES, keysOf } from "@/lib/domain";
import { normalizeContact } from "@/lib/normalize";
import { recalcScore } from "@/lib/scoring";
import { logInteraction } from "@/lib/timeline";

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const contacts = await prisma.contact.findMany({ where: { clientId }, orderBy: { createdAt: "asc" }, include: { source: true } });
  // Дубликаты по нормализованному значению среди других клиентов пользователя
  const dupes = await prisma.contact.findMany({
    where: { normalizedValue: { in: contacts.map((c) => c.normalizedValue) }, clientId: { not: clientId }, client: { ownerId: user.id } },
    select: { normalizedValue: true, client: { select: { id: true, companyName: true } } },
  });
  return { contacts, duplicates: dupes };
});

const Create = z.object({
  type: z.enum(keysOf(CONTACT_TYPES)),
  value: z.string().trim().min(2).max(300),
  label: z.string().trim().max(200).optional().default(""),
  sourceUrl: z.string().trim().max(500).optional().default(""),
  sourceId: z.string().optional(),
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const b = await parseBody(req, Create);
  const normalizedValue = normalizeContact(b.type, b.value);
  const exists = await prisma.contact.findFirst({ where: { clientId, normalizedValue, type: b.type } });
  if (exists) throw new ApiError(409, "duplicate", "Такой контакт уже есть у клиента");

  let sourceId = b.sourceId ?? null;
  if (sourceId && !(await prisma.leadSource.findFirst({ where: { id: sourceId, clientId } }))) sourceId = null;
  if (!sourceId) {
    const src = await prisma.leadSource.create({
      data: {
        clientId,
        sourceType: b.sourceUrl ? "other" : "manual",
        sourceUrl: b.sourceUrl,
        method: "manual",
        title: b.sourceUrl ? "" : "Внесено вручную",
        evidence: `Контакт: ${b.type}`,
      },
    });
    sourceId = src.id;
  }
  const contact = await prisma.contact.create({
    data: { clientId, type: b.type, value: b.value, normalizedValue, label: b.label, sourceId, verificationStatus: "found" },
  });
  await logInteraction(clientId, "contact_added", `Добавлен контакт: ${CONTACT_TYPES[b.type]} ${b.value}`, user, { contactId: contact.id });
  await recalcScore(clientId, user);
  return { contact };
});

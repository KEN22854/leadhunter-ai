import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formalCheck } from "@/lib/contacts";
import { VERIFICATION_STATUSES, keysOf } from "@/lib/domain";
import { requireContact as guardsContact } from "@/lib/guards";
import { normalizeContact, suppressionKeys } from "@/lib/normalize";
import { recalcScore } from "@/lib/scoring";
import { logInteraction } from "@/lib/timeline";

const Patch = z.object({
  value: z.string().trim().min(2).max(300).optional(),
  label: z.string().max(200).optional(),
  verificationStatus: z.enum(keysOf(VERIFICATION_STATUSES)).optional(),
  verificationNote: z.string().max(500).optional(),
  doNotContact: z.boolean().optional(),
  runFormalCheck: z.boolean().optional(),
});

export const PATCH = handler(async (req, { contactId }) => {
  const user = await requireUser();
  const c = await guardsContact(user, contactId);
  const b = await parseBody(req, Patch);
  const data: Record<string, unknown> = {};
  let summary = "Контакт обновлён";
  if (b.value !== undefined && b.value !== c.value) {
    data.value = b.value;
    data.normalizedValue = normalizeContact(c.type, b.value);
    data.verificationStatus = "found"; // новое значение требует новой проверки
    data.verifiedAt = null;
  }
  if (b.label !== undefined) data.label = b.label;
  if (b.runFormalCheck) {
    const r = await formalCheck(c.type, (b.value ?? c.value) as string);
    data.verificationStatus = r.status === "unknown" ? c.verificationStatus : r.status;
    data.lastCheckedAt = new Date();
    if (r.status === "formal") data.verifiedAt = new Date();
    summary = `Формальная проверка ${c.value}: ${r.detail}`;
    await logInteraction(c.clientId, "contact_verified", summary, user, { contactId, result: r.status });
  } else if (b.verificationStatus) {
    data.verificationStatus = b.verificationStatus;
    data.lastCheckedAt = new Date();
    if (b.verificationStatus === "confirmed" || b.verificationStatus === "formal") data.verifiedAt = new Date();
    summary = `Статус контакта ${c.value}: ${VERIFICATION_STATUSES[b.verificationStatus]}${b.verificationNote ? ` (${b.verificationNote})` : ""}`;
    await logInteraction(c.clientId, "contact_verified", summary, user, { contactId });
  }
  if (b.doNotContact !== undefined) {
    data.doNotContact = b.doNotContact;
    if (b.doNotContact) {
      const value = suppressionKeys(c.type, c.value)[0];
      await prisma.suppressionEntry.upsert({
        where: { ownerId_value: { ownerId: c.client.ownerId, value } },
        update: {},
        create: { ownerId: c.client.ownerId, value, type: c.type, reason: b.verificationNote || "Запрет обработки" },
      });
    }
    await logInteraction(c.clientId, "suppression", b.doNotContact ? `Контакт ${c.value} — запрет обращений` : `Снят запрет для ${c.value}`, user);
  }
  if (!b.runFormalCheck && !b.verificationStatus && b.doNotContact === undefined)
    await logInteraction(c.clientId, "contact_updated", `Контакт изменён: ${c.value}`, user, { contactId });
  const contact = await prisma.contact.update({ where: { id: contactId }, data });
  await recalcScore(c.clientId, user);
  return { contact, summary };
});

export const DELETE = handler(async (_req, { contactId }) => {
  const user = await requireUser();
  const c = await guardsContact(user, contactId);
  await prisma.contact.delete({ where: { id: contactId } });
  await logInteraction(c.clientId, "contact_updated", `Контакт удалён: ${c.value}`, user);
  await recalcScore(c.clientId, user);
  return { ok: true };
});

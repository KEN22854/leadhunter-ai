import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CONSENT_BASES, keysOf } from "@/lib/domain";
import { audit, logInteraction } from "@/lib/timeline";

/** Журнал согласий/правовых оснований для обращений. */
export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  return { consents: await prisma.consentRecord.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, include: { contact: true } }) };
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const b = await parseBody(
    req,
    z.object({
      basis: z.enum(keysOf(CONSENT_BASES)),
      contactId: z.string().nullable().optional(),
      note: z.string().trim().min(3, "Опишите основание").max(2000),
      sourceUrl: z.string().trim().max(1000).optional(),
      validDays: z.number().int().min(1).max(3650).nullable().optional(),
    }),
  );
  if (b.contactId && !(await prisma.contact.findFirst({ where: { id: b.contactId, clientId } }))) throw new ApiError(400, "bad_contact", "Контакт не принадлежит клиенту");
  const consent = await prisma.consentRecord.create({ data: {
      clientId,
      contactId: b.contactId ?? null,
      basis: b.basis,
      note: b.note,
      sourceUrl: b.sourceUrl ?? "",
      expiresAt: b.validDays ? new Date(Date.now() + b.validDays * 86_400_000) : null,
      recordedById: user.id,
    },
  });
  await logInteraction(clientId, "consent", `Основание для обращения: ${CONSENT_BASES[b.basis]}`, user, { consentId: consent.id });
  await audit(user.id, "consent.record", "ConsentRecord", consent.id, { basis: b.basis });
  return { consent };
});

/** Отзыв основания: запись сохраняется в журнале (для аудита), но перестаёт действовать. */
export const DELETE = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id") ?? "";
  const reason = (sp.get("reason") ?? "Отозвано пользователем").slice(0, 500);
  const r = await prisma.consentRecord.updateMany({ where: { id, clientId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  if (r.count) {
    await logInteraction(clientId, "consent", "Основание для обращения отозвано", user, { consentId: id });
    await audit(user.id, "consent.revoke", "ConsentRecord", id, { reason });
  }
  return { ok: true, revoked: r.count };
});

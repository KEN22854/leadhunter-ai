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
    z.object({ basis: z.enum(keysOf(CONSENT_BASES)), contactId: z.string().nullable().optional(), note: z.string().trim().min(3, "Опишите основание").max(2000) }),
  );
  if (b.contactId && !(await prisma.contact.findFirst({ where: { id: b.contactId, clientId } }))) throw new ApiError(400, "bad_contact", "Контакт не принадлежит клиенту");
  const consent = await prisma.consentRecord.create({ data: { clientId, contactId: b.contactId ?? null, basis: b.basis, note: b.note, recordedById: user.id } });
  await logInteraction(clientId, "consent", `Основание для обращения: ${CONSENT_BASES[b.basis]}`, user, { consentId: consent.id });
  await audit(user.id, "consent.record", "ConsentRecord", consent.id, { basis: b.basis });
  return { consent };
});

export const DELETE = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  await prisma.consentRecord.deleteMany({ where: { id, clientId } });
  await audit(user.id, "consent.remove", "ConsentRecord", id);
  return { ok: true };
});

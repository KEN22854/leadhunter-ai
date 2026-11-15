import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireReference } from "@/lib/guards";
import { logInteraction } from "@/lib/timeline";

export const GET = handler(async (_req, { referenceId }) => {
  const user = await requireUser();
  const { client: _c, ...reference } = await requireReference(user, referenceId);
  void _c;
  return { reference };
});

export const PATCH = handler(async (req, { referenceId }) => {
  const user = await requireUser();
  const r = await requireReference(user, referenceId);
  const b = await parseBody(
    req,
    z.object({ emailSubject: z.string().max(200).optional(), emailBody: z.string().max(10000).optional(), status: z.enum(["draft", "approved"]).optional() }),
  );
  const { html, ...updated } = await prisma.reference.update({ where: { id: referenceId }, data: b });
  // Ещё не поставленные в очередь письма кампаний подхватывают новый текст
  if (b.emailSubject !== undefined || b.emailBody !== undefined)
    await prisma.campaignItem.updateMany({
      where: { referenceId, status: { in: ["draft", "ready"] } },
      data: { ...(b.emailSubject !== undefined ? { subject: b.emailSubject } : {}), ...(b.emailBody !== undefined ? { body: b.emailBody } : {}) },
    });
  if (b.status === "approved") await logInteraction(r.clientId, "reference_created", `Референс одобрен: «${r.title}»`, user);
  return { reference: { ...updated, hasPrototype: Boolean(html) } };
});

export const DELETE = handler(async (_req, { referenceId }) => {
  const user = await requireUser();
  await requireReference(user, referenceId);
  await prisma.reference.delete({ where: { id: referenceId } });
  return { ok: true };
});

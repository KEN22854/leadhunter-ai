import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireReference } from "@/lib/guards";
import { queueOutbound, type AttachmentRef } from "@/lib/outreach";

export const runtime = "nodejs";

/** Письмо с референсом из карточки: создаётся исходящее «ожидает подтверждения» (отправка — вручную в «Переписке»). */
export const POST = handler(async (req, { referenceId }) => {
  const user = await requireUser();
  const r = await requireReference(user, referenceId);
  const b = await parseBody(
    req,
    z.object({
      contactId: z.string().min(1),
      subject: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(20000),
      attachPdf: z.boolean().default(true),
      attachHtml: z.boolean().default(false),
    }),
  );
  const attachments: AttachmentRef[] = [];
  if (b.attachPdf) attachments.push({ kind: "reference_pdf", referenceId });
  if (b.attachHtml) attachments.push({ kind: "reference_html", referenceId });
  return await queueOutbound(user, r.clientId, { channel: "email", contactId: b.contactId, subject: b.subject, body: b.body, attachments });
});

import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireLead } from "@/lib/signals/store";
import { REWRITE_OPS, rewriteDraft } from "@/lib/signals/outreach";

export const runtime = "nodejs";

async function own(userId: string, role: string, id: string) {
  const d = await prisma.outreachDraft.findUnique({ where: { id } });
  if (!d) throw new ApiError(404, "not_found", "Черновик не найден");
  await requireLead({ id: userId, role, email: "", name: "" }, d.leadId);
  return d;
}

/** Сохранение ручных правок */
export const PATCH = handler(async (req, p) => {
  const user = await requireUser();
  const d = await own(user.id, user.role, p.draftId);
  const b = await parseBody(req, z.object({ subject: z.string().max(300).optional(), body: z.string().trim().min(1).max(8000) }));
  return { draft: await prisma.outreachDraft.update({ where: { id: d.id }, data: { ...b, origin: "edited", status: "saved", version: { increment: 1 } } }) };
});

/** AI-правка: тон, сокращение, перевод */
export const POST = handler(async (req, p) => {
  const user = await requireUser();
  await own(user.id, user.role, p.draftId);
  const b = await parseBody(req, z.object({ op: z.enum(Object.keys(REWRITE_OPS) as [keyof typeof REWRITE_OPS, ...(keyof typeof REWRITE_OPS)[]]), language: z.string().max(5).optional() }));
  return { draft: await rewriteDraft(user, p.draftId, b.op, b.language) };
});

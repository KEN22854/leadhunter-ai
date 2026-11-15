import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAIConfigured } from "@/lib/ai/provider";
import { deleteLeadData, requireLead } from "@/lib/signals/store";
import { channelOptions } from "@/lib/signals/outreach";

export const runtime = "nodejs";

export const GET = handler(async (_req, p) => {
  const user = await requireUser();
  await requireLead(user, p.leadId);
  const lead = await prisma.socialLead.findUniqueOrThrow({
    where: { id: p.leadId },
    include: {
      signals: { orderBy: [{ score: "desc" }, { createdAt: "desc" }] },
      identities: true,
      drafts: { where: { status: { not: "archived" } }, orderBy: { createdAt: "desc" }, take: 12 },
      attempts: { orderBy: { createdAt: "desc" } },
    },
  });
  const log = await prisma.processingLog.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const client = lead.clientId ? await prisma.client.findFirst({ where: { id: lead.clientId, ownerId: user.id }, select: { id: true, companyName: true, status: true } }) : null;
  const profile = await prisma.executorProfile.findUnique({ where: { userId: user.id }, select: { specialization: true, portfolioUrl: true } });
  return { lead, log, client, channels: await channelOptions(lead.id), ai: await isAIConfigured(), profileFilled: Boolean(profile?.specialization || profile?.portfolioUrl) };
});

export const PATCH = handler(async (req, p) => {
  const user = await requireUser();
  await requireLead(user, p.leadId);
  const b = await parseBody(req, z.object({ status: z.enum(["new", "qualified", "archived"]).optional(), notes: z.string().max(5000).optional() }));
  return { lead: await prisma.socialLead.update({ where: { id: p.leadId }, data: b }) };
});

/** Удаление персональных данных лида (журнал остаётся обезличенным). */
export const DELETE = handler(async (req, p) => {
  const user = await requireUser();
  await requireLead(user, p.leadId);
  const sp = new URL(req.url).searchParams;
  await deleteLeadData(user, p.leadId, { blockRecollect: sp.get("block") === "1", reason: (sp.get("reason") ?? "").slice(0, 300) });
  return { ok: true };
});

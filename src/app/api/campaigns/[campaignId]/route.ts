import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CAMPAIGN_ITEM_STATUSES, isGenerating, ownCampaign } from "@/lib/campaigns";
import { CampaignSettings } from "@/lib/campaign-schema";

export const runtime = "nodejs";

export const GET = handler(async (_req, { campaignId }) => {
  const user = await requireUser();
  const campaign = await ownCampaign(user, campaignId);
  const items = await prisma.campaignItem.findMany({
    where: { campaignId },
    orderBy: { createdAt: "asc" },
    include: { client: { select: { id: true, companyName: true, city: true, website: true, siteAuditScore: true } } },
  });
  const contactIds = items.map((i) => i.contactId).filter(Boolean) as string[];
  const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, value: true, verificationStatus: true } });
  return {
    campaign,
    generating: isGenerating(campaignId),
    statuses: CAMPAIGN_ITEM_STATUSES,
    items: items.map((i) => ({ ...i, contact: contacts.find((c) => c.id === i.contactId) ?? null })),
  };
});

export const PATCH = handler(async (req, { campaignId }) => {
  const user = await requireUser();
  const c = await ownCampaign(user, campaignId);
  if (c.status === "running") throw new ApiError(409, "invalid_state", "Поставьте кампанию на паузу, чтобы изменить настройки");
  const b = await parseBody(req, z.object({ ...CampaignSettings.shape, name: z.string().trim().min(1).max(120) }).partial());
  return { campaign: await prisma.campaign.update({ where: { id: campaignId }, data: b }) };
});

export const DELETE = handler(async (_req, { campaignId }) => {
  const user = await requireUser();
  const c = await ownCampaign(user, campaignId);
  if (c.status === "running") throw new ApiError(409, "invalid_state", "Сначала поставьте кампанию на паузу");
  // Неотправленные письма из очереди удаляются вместе с кампанией
  const items = await prisma.campaignItem.findMany({ where: { campaignId, status: { in: ["queued", "ready", "draft"] } }, select: { outboundId: true } });
  const ids = items.map((i) => i.outboundId).filter(Boolean) as string[];
  if (ids.length) await prisma.conversationMessage.deleteMany({ where: { id: { in: ids }, status: "pending_approval" } });
  await prisma.campaign.delete({ where: { id: campaignId } });
  return { ok: true };
});

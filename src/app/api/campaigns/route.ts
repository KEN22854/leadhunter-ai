import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createCampaign } from "@/lib/campaigns";
import { CampaignSettings } from "@/lib/campaign-schema";

export const runtime = "nodejs";

export const GET = handler(async () => {
  const user = await requireUser();
  const campaigns = await prisma.campaign.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const stats = await prisma.campaignItem.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: campaigns.map((c) => c.id) } }, _count: { _all: true } });
  return {
    campaigns: campaigns.map((c) => ({
      ...c,
      stats: Object.fromEntries(stats.filter((s) => s.campaignId === c.id).map((s) => [s.status, s._count._all])),
    })),
  };
});

export const POST = handler(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, CampaignSettings.extend({ name: z.string().trim().min(1).max(120), clientIds: z.array(z.string()).min(1).max(500) }));
  return { campaign: await createCampaign(user, b) };
});

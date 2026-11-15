import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setCampaignPaused } from "@/lib/campaigns";

export const runtime = "nodejs";

export const POST = handler(async (req, { campaignId }) => {
  const user = await requireUser();
  const { paused } = await parseBody(req, z.object({ paused: z.boolean() }));
  await setCampaignPaused(user, campaignId, paused);
  return { ok: true };
});

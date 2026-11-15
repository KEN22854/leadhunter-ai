import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { addToCampaign } from "@/lib/campaigns";

export const runtime = "nodejs";

export const POST = handler(async (req, { campaignId }) => {
  const user = await requireUser();
  const { clientIds } = await parseBody(req, z.object({ clientIds: z.array(z.string()).min(1).max(500) }));
  return await addToCampaign(user, campaignId, clientIds);
});

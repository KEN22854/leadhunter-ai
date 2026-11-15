import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { approveCampaign } from "@/lib/campaigns";

export const runtime = "nodejs";

/** Явное одобрение кампании пользователем — после него письма уходят автоматически по расписанию. */
export const POST = handler(async (req, { campaignId }) => {
  const user = await requireUser();
  const b = await parseBody(req, z.object({ basisConfirmed: z.boolean(), confirm: z.literal(true, { message: "Требуется явное подтверждение" }) }));
  return await approveCampaign(user, campaignId, { basisConfirmed: b.basisConfirmed });
});

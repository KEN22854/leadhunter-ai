import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/ratelimit";
import { startCampaignRun } from "@/lib/signals/engine";

export const runtime = "nodejs";

export const POST = handler(async (req, p) => {
  const user = await requireUser();
  const c = await prisma.signalCampaign.findUnique({ where: { id: p.campaignId } });
  if (!c || (c.ownerId !== user.id && user.role !== "admin")) throw new ApiError(404, "not_found", "Кампания не найдена");
  const b = await parseBody(req, z.object({ sources: z.array(z.string().max(40)).max(40).optional() }));
  const rl = checkRateLimit(`signals-run:${user.id}`, 6);
  if (!rl.ok) throw new ApiError(429, "rate_limited", `Слишком частые запуски, подождите ${rl.retryAfterSec} с.`, { retryAfterSec: rl.retryAfterSec });
  return startCampaignRun(user, c.id, b.sources?.length ? b.sources : undefined);
});

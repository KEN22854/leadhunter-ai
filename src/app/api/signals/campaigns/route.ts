import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/ratelimit";
import { audit } from "@/lib/timeline";
import { CampaignBody } from "@/lib/signals/schema";
import { isRunning, startCampaignRun } from "@/lib/signals/engine";

export const runtime = "nodejs";

export const GET = handler(async () => {
  const user = await requireUser();
  const items = await prisma.signalCampaign.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" }, include: { runs: { orderBy: { startedAt: "desc" }, take: 1 }, _count: { select: { signals: true } } } });
  return { campaigns: items.map((c) => ({ ...c, lastRun: c.runs[0] ?? null, runs: undefined, signalCount: c._count.signals, running: isRunning(c.id) })) };
});

export const POST = handler(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, CampaignBody.extend({ runNow: z.boolean().default(true) }));
  if ((await prisma.signalCampaign.count({ where: { ownerId: user.id } })) >= 50) throw new ApiError(400, "too_many", "Не больше 50 кампаний");
  const { runNow, ...data } = b;
  const c = await prisma.signalCampaign.create({
    data: { ...data, ownerId: user.id, channels: data.channels as Prisma.InputJsonValue, nextRunAt: data.schedule === "once" ? null : new Date(Date.now() + (data.schedule === "daily" ? 86_400_000 : 7 * 86_400_000)) },
  });
  await audit(user.id, "signals.campaign.create", "SignalCampaign", c.id, { sources: data.sources });
  if (runNow) {
    const rl = checkRateLimit(`signals-run:${user.id}`, 6);
    if (rl.ok) startCampaignRun(user, c.id);
  }
  return { campaign: c };
});

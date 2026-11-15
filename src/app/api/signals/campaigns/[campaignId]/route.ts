import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/timeline";
import { isRunning, nextRunAt } from "@/lib/signals/engine";
import { CampaignPatch } from "@/lib/signals/schema";

export const runtime = "nodejs";

async function own(userId: string, role: string, id: string) {
  const c = await prisma.signalCampaign.findUnique({ where: { id } });
  if (!c || (c.ownerId !== userId && role !== "admin")) throw new ApiError(404, "not_found", "Кампания не найдена");
  return c;
}

export const GET = handler(async (_req, p) => {
  const user = await requireUser();
  const c = await own(user.id, user.role, p.campaignId);
  const runs = await prisma.signalRun.findMany({ where: { campaignId: c.id }, orderBy: { startedAt: "desc" }, take: 20 });
  const signalCount = await prisma.leadSignal.count({ where: { campaignId: c.id } });
  return { campaign: { ...c, running: isRunning(c.id), signalCount }, runs };
});

export const PATCH = handler(async (req, p) => {
  const user = await requireUser();
  const c = await own(user.id, user.role, p.campaignId);
  const b = await parseBody(req, CampaignPatch);
  const schedule = b.schedule ?? c.schedule;
  const status = b.status ?? c.status;
  const upd = await prisma.signalCampaign.update({
    where: { id: c.id },
    data: {
      ...b,
      nextRunAt: status === "active" ? (b.schedule || b.status ? nextRunAt(schedule) : c.nextRunAt) : null,
    },
  });
  await audit(user.id, "signals.campaign.update", "SignalCampaign", c.id, { fields: Object.keys(b) });
  return { campaign: upd };
});

export const DELETE = handler(async (_req, p) => {
  const user = await requireUser();
  const c = await own(user.id, user.role, p.campaignId);
  if (isRunning(c.id)) throw new ApiError(409, "running", "Кампания выполняется — дождитесь окончания");
  // Найденные лиды остаются (у публикаций обнуляется ссылка на кампанию)
  await prisma.signalCampaign.delete({ where: { id: c.id } });
  await audit(user.id, "signals.campaign.delete", "SignalCampaign", c.id);
  return { ok: true };
});

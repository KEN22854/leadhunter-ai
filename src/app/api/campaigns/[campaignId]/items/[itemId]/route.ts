import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ownCampaign } from "@/lib/campaigns";

async function findItem(campaignId: string, itemId: string) {
  const it = await prisma.campaignItem.findFirst({ where: { id: itemId, campaignId } });
  if (!it) throw new ApiError(404, "not_found", "Письмо не найдено");
  return it;
}

export const PATCH = handler(async (req, { campaignId, itemId }) => {
  const user = await requireUser();
  await ownCampaign(user, campaignId);
  const it = await findItem(campaignId, itemId);
  if (!["draft", "ready", "skipped"].includes(it.status)) throw new ApiError(409, "invalid_state", "Письмо уже в очереди или отправлено");
  const b = await parseBody(req, z.object({ subject: z.string().max(300).optional(), body: z.string().max(20000).optional(), skip: z.boolean().optional() }));
  const data: { subject?: string; body?: string; status?: string; error?: string } = {};
  if (b.subject !== undefined) data.subject = b.subject;
  if (b.body !== undefined) data.body = b.body;
  if (b.skip === true) Object.assign(data, { status: "skipped", error: "Исключено вручную" });
  if (b.skip === false && it.status === "skipped" && it.contactId && it.referenceId) Object.assign(data, { status: "ready", error: "" });
  return { item: await prisma.campaignItem.update({ where: { id: itemId }, data }) };
});

export const DELETE = handler(async (_req, { campaignId, itemId }) => {
  const user = await requireUser();
  await ownCampaign(user, campaignId);
  const it = await findItem(campaignId, itemId);
  if (["sending", "sent"].includes(it.status)) throw new ApiError(409, "invalid_state", "Отправленное письмо нельзя удалить из кампании");
  if (it.outboundId) await prisma.conversationMessage.deleteMany({ where: { id: it.outboundId, status: "pending_approval" } });
  await prisma.campaignItem.delete({ where: { id: itemId } });
  return { ok: true };
});

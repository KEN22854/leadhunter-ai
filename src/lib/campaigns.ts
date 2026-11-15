import "server-only";
import { prisma } from "./db";
import { ApiError } from "./api";
import type { CurrentUser } from "./auth";
import { ADAPTERS } from "./channels";
import { checkOutreachCompliance } from "./compliance";
import { approveAndSend, queueOutbound, type AttachmentRef } from "./outreach";
import { generateReference } from "./reference/service";
import { audit, logInteraction } from "./timeline";

// Кампания = список лидов + письмо с референсом для каждого. Пользователь просматривает письма и ОДИН раз
// одобряет кампанию; дальше планировщик отправляет письма сам: по одному, с интервалом, в рабочие часы и с
// дневным лимитом. Перед КАЖДОЙ отправкой заново проверяются список запрета, «Не связываться», основание и статус адреса.
// Ответ клиента или отказ останавливает дальнейшие письма этому клиенту.

export const CAMPAIGN_ITEM_STATUSES = {
  draft: "Нужен референс",
  ready: "Готово к одобрению",
  queued: "В очереди",
  sending: "Отправляется",
  sent: "Отправлено",
  failed: "Ошибка",
  skipped: "Пропущено",
  replied: "Ответил",
  opted_out: "Отписался",
} as const;

async function pickEmail(clientId: string) {
  const contacts = await prisma.contact.findMany({ where: { clientId, type: "email", doNotContact: false, verificationStatus: { not: "invalid" } }, orderBy: { createdAt: "asc" } });
  const rank = (s: string) => ({ confirmed: 0, formal: 1, found: 2, unknown: 3 })[s] ?? 4;
  return contacts.sort((a, b) => rank(a.verificationStatus) - rank(b.verificationStatus))[0] ?? null;
}

async function fillItem(itemId: string) {
  const item = await prisma.campaignItem.findUniqueOrThrow({ where: { id: itemId } });
  const contact = item.contactId ? await prisma.contact.findUnique({ where: { id: item.contactId } }) : await pickEmail(item.clientId);
  const ref = item.referenceId
    ? await prisma.reference.findUnique({ where: { id: item.referenceId } })
    : await prisma.reference.findFirst({ where: { clientId: item.clientId }, orderBy: { createdAt: "desc" } });
  let status: string = "ready";
  let error = "";
  if (!contact) {
    status = "skipped";
    error = "Нет пригодного email (не найден, недействителен или «Не связываться»)";
  } else if (!ref) {
    status = "draft";
    error = "Нет референса — сгенерируйте";
  }
  return prisma.campaignItem.update({
    where: { id: itemId },
    data: {
      contactId: contact?.id ?? null,
      referenceId: ref?.id ?? null,
      subject: item.subject || ref?.emailSubject || "",
      body: item.body || ref?.emailBody || "",
      status,
      error,
    },
  });
}

export async function createCampaign(user: CurrentUser, p: { name: string; clientIds: string[]; attachPdf: boolean; attachHtml: boolean; dailyLimit: number; intervalMin: number; windowStart: number; windowEnd: number }) {
  const clients = await prisma.client.findMany({ where: { id: { in: p.clientIds }, ownerId: user.id, archived: false, doNotContact: false }, select: { id: true } });
  if (!clients.length) throw new ApiError(400, "no_clients", "Нет подходящих клиентов (архивные и «Не связываться» исключаются)");
  const c = await prisma.campaign.create({
    data: { ownerId: user.id, name: p.name, attachPdf: p.attachPdf, attachHtml: p.attachHtml, dailyLimit: p.dailyLimit, intervalMin: p.intervalMin, windowStart: p.windowStart, windowEnd: p.windowEnd },
  });
  for (const cl of clients) {
    const item = await prisma.campaignItem.create({ data: { campaignId: c.id, clientId: cl.id } });
    await fillItem(item.id);
  }
  await audit(user.id, "campaign.create", "Campaign", c.id, { clients: clients.length });
  return c;
}

export async function addToCampaign(user: CurrentUser, campaignId: string, clientIds: string[]) {
  const c = await ownCampaign(user, campaignId);
  if (c.status !== "draft") throw new ApiError(409, "invalid_state", "Добавлять лидов можно только в черновик кампании");
  const clients = await prisma.client.findMany({ where: { id: { in: clientIds }, ownerId: user.id, archived: false, doNotContact: false }, select: { id: true } });
  let added = 0;
  for (const cl of clients) {
    const exists = await prisma.campaignItem.findUnique({ where: { campaignId_clientId: { campaignId, clientId: cl.id } } });
    if (exists) continue;
    const item = await prisma.campaignItem.create({ data: { campaignId, clientId: cl.id } });
    await fillItem(item.id);
    added++;
  }
  return { added };
}

export async function ownCampaign(user: CurrentUser, id: string) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c || (c.ownerId !== user.id && user.role !== "admin")) throw new ApiError(404, "not_found", "Кампания не найдена");
  return c;
}

const generating = new Set<string>();
/** Генерация недостающих референсов по очереди (в фоне). */
export async function generateMissingReferences(user: CurrentUser, campaignId: string) {
  await ownCampaign(user, campaignId);
  if (generating.has(campaignId)) return { started: false, reason: "Генерация уже идёт" };
  const items = await prisma.campaignItem.findMany({ where: { campaignId, status: "draft" }, select: { id: true, clientId: true } });
  if (!items.length) return { started: false, reason: "Все референсы готовы" };
  generating.add(campaignId);
  void (async () => {
    try {
      for (const it of items) {
        try {
          const ref = await generateReference(user, it.clientId);
          await prisma.campaignItem.update({ where: { id: it.id }, data: { referenceId: ref.id, subject: ref.emailSubject, body: ref.emailBody } });
          await fillItem(it.id);
        } catch (e) {
          await prisma.campaignItem.update({ where: { id: it.id }, data: { error: `AI: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) } });
          // Нет AI / лимит — дальше нет смысла
          if (e instanceof ApiError && [503, 429].includes(e.status)) break;
        }
      }
    } finally {
      generating.delete(campaignId);
    }
  })();
  return { started: true, count: items.length };
}
export const isGenerating = (id: string) => generating.has(id);

/** Одобрение кампании: проверки, фиксация основания, постановка писем в очередь. Отправляет планировщик. */
export async function approveCampaign(user: CurrentUser, campaignId: string, opts: { basisConfirmed: boolean }) {
  const c = await ownCampaign(user, campaignId);
  if (c.status !== "draft" && c.status !== "paused") throw new ApiError(409, "invalid_state", "Кампания уже запущена или завершена");
  if (!opts.basisConfirmed)
    throw new ApiError(400, "basis_required", "Подтвердите, что адреса — публичные деловые контакты компаний и у вас есть основание для B2B-обращения");
  if (ADAPTERS.email.status().state !== "connected")
    throw new ApiError(409, "channel_not_connected", "Email не подключён — задайте SMTP_* в .env", { setupHint: ADAPTERS.email.status().setupHint });

  const items = await prisma.campaignItem.findMany({ where: { campaignId, status: "ready" }, include: { client: true } });
  let queued = 0;
  const problems: { clientId: string; company: string; reason: string }[] = [];
  for (const it of items) {
    if (!it.contactId || !it.subject.trim() || !it.body.trim()) {
      problems.push({ clientId: it.clientId, company: it.client.companyName, reason: "Нет темы, текста или адреса" });
      continue;
    }
    // Основание: законный интерес по публичному деловому адресу — фиксируется с источником, если нет действующего
    const issues = await checkOutreachCompliance({ ownerId: user.id, clientId: it.clientId, contactId: it.contactId });
    if (issues.some((i) => i.code === "no_basis")) {
      const contact = await prisma.contact.findUnique({ where: { id: it.contactId }, include: { source: true } });
      await prisma.consentRecord.create({
        data: {
          clientId: it.clientId,
          contactId: it.contactId,
          basis: "legitimate_interest",
          note: "Публичный деловой email компании; B2B-предложение по её сайту. Подтверждено при одобрении кампании.",
          sourceUrl: contact?.source?.sourceUrl ?? "",
          expiresAt: new Date(Date.now() + 180 * 86_400_000),
          recordedById: user.id,
        },
      });
    }
    const attachments: AttachmentRef[] = [];
    if (it.referenceId && c.attachPdf) attachments.push({ kind: "reference_pdf", referenceId: it.referenceId });
    if (it.referenceId && c.attachHtml) attachments.push({ kind: "reference_html", referenceId: it.referenceId });
    try {
      const { item } = await queueOutbound(user, it.clientId, { channel: "email", contactId: it.contactId, subject: it.subject, body: it.body, attachments });
      await prisma.campaignItem.update({ where: { id: it.id }, data: { status: "queued", outboundId: item.id, error: "" } });
      queued++;
    } catch (e) {
      const reason = e instanceof ApiError ? (e.details as { issues?: { message: string }[] })?.issues?.map((i) => i.message).join(" ") || e.message : String(e);
      await prisma.campaignItem.update({ where: { id: it.id }, data: { status: "skipped", error: reason.slice(0, 300) } });
      problems.push({ clientId: it.clientId, company: it.client.companyName, reason });
    }
  }
  const anyQueued = queued > 0 || (await prisma.campaignItem.count({ where: { campaignId, status: "queued" } })) > 0;
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: anyQueued ? "running" : "done", basisConfirmed: true, approvedAt: new Date() } });
  await audit(user.id, "campaign.approve", "Campaign", campaignId, { queued, problems: problems.length });
  return { queued, problems };
}

export async function setCampaignPaused(user: CurrentUser, campaignId: string, paused: boolean) {
  const c = await ownCampaign(user, campaignId);
  if (paused && c.status === "running") await prisma.campaign.update({ where: { id: campaignId }, data: { status: "paused" } });
  else if (!paused && c.status === "paused") await prisma.campaign.update({ where: { id: campaignId }, data: { status: "running" } });
  else throw new ApiError(409, "invalid_state", "Нельзя изменить состояние кампании");
  await audit(user.id, paused ? "campaign.pause" : "campaign.resume", "Campaign", campaignId);
}

export function inWindow(now: Date, start: number, end: number) {
  const h = now.getHours();
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/** Один шаг планировщика: не более одного письма на кампанию за вызов. */
export async function processCampaigns(now = new Date()) {
  const running = await prisma.campaign.findMany({ where: { status: "running" }, include: { owner: true } });
  let sent = 0;
  for (const c of running) {
    if (!inWindow(now, c.windowStart, c.windowEnd)) continue;
    if (c.lastSentAt && now.getTime() - c.lastSentAt.getTime() < c.intervalMin * 60_000) continue;
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const today = await prisma.campaignItem.count({ where: { campaignId: c.id, sentAt: { gte: dayStart } } });
    if (today >= c.dailyLimit) continue;
    const next = await prisma.campaignItem.findFirst({ where: { campaignId: c.id, status: "queued" }, orderBy: { createdAt: "asc" } });
    if (!next) {
      await prisma.campaign.update({ where: { id: c.id }, data: { status: "done" } });
      continue;
    }
    const lock = await prisma.campaignItem.updateMany({ where: { id: next.id, status: "queued" }, data: { status: "sending" } });
    if (!lock.count || !next.outboundId) continue;
    const owner = { id: c.owner.id, email: c.owner.email, name: c.owner.name, role: c.owner.role };
    try {
      const r = await approveAndSend(owner, next.outboundId, `campaign:${next.id}`);
      if (r.status === "sent") {
        await prisma.campaignItem.update({ where: { id: next.id }, data: { status: "sent", sentAt: new Date(), error: "" } });
        sent++;
      } else await prisma.campaignItem.update({ where: { id: next.id }, data: { status: "failed", error: r.error.slice(0, 300) } });
    } catch (e) {
      const msg = e instanceof ApiError ? ((e.details as { issues?: { message: string }[] })?.issues?.map((i) => i.message).join(" ") || e.message) : String(e);
      // Канал отключили — ставим кампанию на паузу, письмо возвращаем в очередь
      if (e instanceof ApiError && e.code === "channel_not_connected") {
        await prisma.campaignItem.update({ where: { id: next.id }, data: { status: "queued" } });
        await prisma.campaign.update({ where: { id: c.id }, data: { status: "paused" } });
        continue;
      }
      await prisma.campaignItem.update({ where: { id: next.id }, data: { status: "skipped", error: msg.slice(0, 300) } });
      await logInteraction(next.clientId, "campaign", `Письмо кампании «${c.name}» не отправлено: ${msg.slice(0, 150)}`, null);
    }
    await prisma.campaign.update({ where: { id: c.id }, data: { lastSentAt: new Date() } });
  }
  return sent;
}

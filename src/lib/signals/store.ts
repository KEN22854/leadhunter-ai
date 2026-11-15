import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../api";
import type { CurrentUser } from "../auth";
import { normalizeContact } from "../normalize";
import { logInteraction, audit } from "../timeline";
import { SOURCE_MAP, sourceLabel } from "./catalog";
import { dncKeys, type Identity } from "./identity";
import { SIGNAL_SERVICES } from "./lexicon";
import { combineLeadScore, type SignalFactor } from "./scoring";
import type { Temperature } from "./classify";

// Хранилище лидов модуля «Спрос»: дедупликация и слияние, пересчёт итогов, Do Not Contact,
// журнал оснований обработки, удаление данных, конвертация в клиента CRM.

export async function logProcessing(ownerId: string, p: { leadId: string | null; subject: string; action: string; basis: string; sourceUrl?: string; note?: string }) {
  await prisma.processingLog.create({ data: { ownerId, leadId: p.leadId, subject: p.subject.slice(0, 200), action: p.action, basis: p.basis, sourceUrl: p.sourceUrl ?? "", note: (p.note ?? "").slice(0, 500) } });
}

/** Попадает ли хотя бы один идентификатор в глобальный список Do Not Contact пользователя. */
export async function dncHit(ownerId: string, ids: Identity[]) {
  const keys = dncKeys(ids);
  if (!keys.length) return null;
  return prisma.suppressionEntry.findFirst({ where: { ownerId, value: { in: keys } } });
}

export async function requireLead(user: CurrentUser, id: string) {
  const lead = await prisma.socialLead.findUnique({ where: { id } });
  if (!lead || (lead.ownerId !== user.id && user.role !== "admin")) throw new ApiError(404, "not_found", "Лид не найден или нет прав доступа");
  return lead;
}

/** Слияние лидов: всё переносится в target, остальные удаляются. */
export async function mergeLeads(ownerId: string, targetId: string, otherIds: string[]) {
  for (const id of otherIds) {
    if (id === targetId) continue;
    const other = await prisma.socialLead.findUnique({ where: { id }, include: { identities: true } });
    if (!other || other.ownerId !== ownerId) continue;
    await prisma.$transaction(async (tx) => {
      await tx.leadSignal.updateMany({ where: { leadId: id }, data: { leadId: targetId } });
      await tx.outreachDraft.updateMany({ where: { leadId: id }, data: { leadId: targetId } });
      await tx.outreachAttempt.updateMany({ where: { leadId: id }, data: { leadId: targetId } });
      // идентификаторы уникальны в рамках владельца — переносим, конфликтов нет по построению
      await tx.leadIdentity.updateMany({ where: { leadId: id }, data: { leadId: targetId } });
      const t = await tx.socialLead.findUniqueOrThrow({ where: { id: targetId } });
      await tx.socialLead.update({
        where: { id: targetId },
        data: {
          firstSeenAt: other.firstSeenAt < t.firstSeenAt ? other.firstSeenAt : t.firstSeenAt,
          firstContactAt: t.firstContactAt ?? other.firstContactAt,
          clientId: t.clientId ?? other.clientId,
          doNotContact: t.doNotContact || other.doNotContact,
          notes: [t.notes, other.notes].filter(Boolean).join("\n"),
          profileUrl: t.profileUrl || other.profileUrl,
          headline: t.headline || other.headline,
        },
      });
      await tx.socialLead.delete({ where: { id } });
    });
    await logProcessing(ownerId, { leadId: targetId, subject: other.displayName, action: "merged", basis: "legitimate_interest", note: `Объединён дубликат ${id} по совпадающим идентификаторам` });
  }
}

/** Пересчёт итогов лида по всем его публикациям. */
export async function recomputeLead(leadId: string) {
  const signals = await prisma.leadSignal.findMany({ where: { leadId }, orderBy: [{ score: "desc" }, { createdAt: "desc" }] });
  if (!signals.length) return;
  const best = signals[0];
  const score = combineLeadScore(signals.map((s) => s.score));
  const factors = ((best.scoreFactors as unknown as SignalFactor[] | null) ?? []).slice();
  if (signals.length > 1) factors.push({ key: "repeat", label: "Повторные запросы", max: 9, points: score - best.score, reason: `${signals.length} публикаций этого автора` });
  const order: Temperature[] = ["hot", "warm", "potential", "cold"];
  const temperature = order.find((t) => signals.some((s) => s.temperature === t)) ?? "potential";
  const last = signals.reduce((m, s) => ((s.publishedAt ?? s.createdAt) > m ? (s.publishedAt ?? s.createdAt) : m), new Date(0));
  await prisma.socialLead.update({
    where: { id: leadId },
    data: {
      score,
      scoreFactors: factors as unknown as Prisma.InputJsonValue,
      scoreExplanation: signals.length > 1 ? `Лучшая публикация: ${best.score}/100 + ${score - best.score} за повторные запросы.` : `По публикации «${best.title.slice(0, 80)}»: ${best.score}/100.`,
      intent: best.intent,
      temperature,
      lastSeenAt: last > new Date(0) ? last : new Date(),
    },
  });
}

export type IngestInput = {
  ownerId: string;
  campaignId: string | null;
  runId: string | null;
  source: string;
  externalId: string;
  url: string;
  title: string;
  text: string;
  authorName: string;
  authorUrl?: string;
  headline?: string;
  publishedAt: Date | null;
  language: string;
  budget: string;
  matchedTerms: string[];
  intent: string;
  intentScore: number;
  intentReasons: string[];
  aiIntent?: unknown;
  serviceMatch: number;
  score: number;
  scoreFactors: SignalFactor[];
  temperature: Temperature;
  identities: Identity[];
  service: string;
  country?: string;
  city?: string;
  basis: "published_request" | "legitimate_interest";
};

/** Сохранение публикации с дедупликацией. Возвращает { status: "new"|"merged"|"duplicate"|"dnc", leadId }. */
export async function ingestSignal(p: IngestInput): Promise<{ status: "new" | "attached" | "duplicate" | "dnc"; leadId: string | null }> {
  const existing = await prisma.leadSignal.findUnique({ where: { ownerId_source_externalId: { ownerId: p.ownerId, source: p.source, externalId: p.externalId } } });
  if (existing) return { status: "duplicate", leadId: existing.leadId };
  if (await dncHit(p.ownerId, p.identities)) return { status: "dnc", leadId: null };

  const matches = await prisma.leadIdentity.findMany({
    where: { ownerId: p.ownerId, OR: p.identities.map((i) => ({ kind: i.kind, value: i.value })) },
    select: { leadId: true },
  });
  const leadIds = [...new Set(matches.map((m) => m.leadId))];
  let leadId: string;
  let status: "new" | "attached";
  if (leadIds.length) {
    const leads = await prisma.socialLead.findMany({ where: { id: { in: leadIds } }, orderBy: { createdAt: "asc" } });
    leadId = leads[0].id;
    await mergeLeads(p.ownerId, leadId, leads.slice(1).map((l) => l.id));
    status = "attached";
  } else {
    const lead = await prisma.socialLead.create({
      data: {
        ownerId: p.ownerId,
        displayName: p.authorName.slice(0, 200) || sourceLabel(p.source),
        headline: (p.headline ?? "").slice(0, 300),
        profileUrl: p.authorUrl ?? "",
        primarySource: p.source,
        language: p.language,
        service: p.service,
        country: p.country ?? "",
        city: p.city ?? "",
        firstSeenAt: new Date(),
      },
    });
    leadId = lead.id;
    status = "new";
  }
  await prisma.leadSignal.create({
    data: {
      ownerId: p.ownerId,
      leadId,
      campaignId: p.campaignId,
      runId: p.runId,
      source: p.source,
      externalId: p.externalId.slice(0, 300),
      url: p.url,
      title: p.title.slice(0, 300),
      text: p.text.slice(0, 8000),
      authorName: p.authorName.slice(0, 200),
      authorUrl: p.authorUrl ?? "",
      publishedAt: p.publishedAt,
      language: p.language,
      budget: p.budget,
      matchedTerms: p.matchedTerms as unknown as Prisma.InputJsonValue,
      intent: p.intent,
      intentScore: p.intentScore,
      intentReasons: p.intentReasons as unknown as Prisma.InputJsonValue,
      aiIntent: p.aiIntent ? (p.aiIntent as Prisma.InputJsonValue) : undefined,
      serviceMatch: p.serviceMatch,
      score: p.score,
      scoreFactors: p.scoreFactors as unknown as Prisma.InputJsonValue,
      temperature: p.temperature,
    },
  });
  for (const i of p.identities) {
    await prisma.leadIdentity.upsert({ where: { ownerId_kind_value: { ownerId: p.ownerId, kind: i.kind, value: i.value } }, update: {}, create: { ownerId: p.ownerId, leadId, kind: i.kind, value: i.value, source: p.source } });
  }
  await recomputeLead(leadId);
  await logProcessing(p.ownerId, {
    leadId,
    subject: p.authorName,
    action: "collected",
    basis: p.basis,
    sourceUrl: p.url,
    note: p.basis === "published_request" ? `Публичная публикация на ${sourceLabel(p.source)} с запросом услуги` : `Публичные данные на ${sourceLabel(p.source)} (карточка организации / запуск проекта), законный интерес`,
  });
  return { status, leadId };
}

// ---------------- Do Not Contact ----------------

export async function addLeadToDnc(user: CurrentUser, leadId: string, reason: string) {
  const ids = await prisma.leadIdentity.findMany({ where: { leadId } });
  const lead = await prisma.socialLead.findUniqueOrThrow({ where: { id: leadId } });
  // В список попадают устойчивые идентификаторы человека; source_id публикации — тоже, чтобы не собрать повторно
  const values = dncKeys(ids.map((i) => ({ kind: i.kind as Identity["kind"], value: i.value }))).filter((v) => !v.startsWith("@") || ids.some((i) => i.kind === "domain"));
  for (const value of values) {
    const type = value.startsWith("profile:") ? "profile" : value.startsWith("source:") ? "other" : value.startsWith("@") ? "domain" : value.includes("@") ? "email" : /^\+?\d+$/.test(value) ? "phone" : "other";
    await prisma.suppressionEntry.upsert({ where: { ownerId_value: { ownerId: user.id, value } }, update: { reason }, create: { ownerId: user.id, value, type, reason } });
  }
  await prisma.socialLead.update({ where: { id: leadId }, data: { doNotContact: true } });
  await prisma.outreachAttempt.updateMany({ where: { leadId, status: { in: ["prepared", "opened"] } }, data: { status: "cancelled", error: "Лид внесён в Do Not Contact" } });
  if (lead.clientId) {
    await prisma.client.updateMany({ where: { id: lead.clientId, ownerId: user.id }, data: { doNotContact: true } });
    await logInteraction(lead.clientId, "suppression", `Запрет обращений: ${reason}`, user).catch(() => {});
  }
  await logProcessing(user.id, { leadId, subject: lead.displayName, action: "opted_out", basis: "user_request", note: reason });
  await audit(user.id, "signals.dnc", "SocialLead", leadId, { values: values.length });
  return values.length;
}

/** Удаление персональных данных лида. Журнал сохраняется в обезличенном виде; по желанию — запрет повторного сбора. */
export async function deleteLeadData(user: CurrentUser, leadId: string, opts: { blockRecollect: boolean; reason: string }) {
  const lead = await prisma.socialLead.findUniqueOrThrow({ where: { id: leadId } });
  if (opts.blockRecollect) await addLeadToDnc(user, leadId, opts.reason || "Удаление данных по запросу");
  const pseudonym = "удалён:" + createHash("sha256").update(lead.id).digest("hex").slice(0, 10);
  await prisma.socialLead.delete({ where: { id: leadId } });
  await prisma.processingLog.updateMany({ where: { leadId }, data: { subject: pseudonym, sourceUrl: "" } });
  await logProcessing(user.id, { leadId, subject: pseudonym, action: "deleted", basis: "user_request", note: opts.reason || "Данные удалены" });
  await audit(user.id, "signals.delete", "SocialLead", leadId, { blockRecollect: opts.blockRecollect });
}

// ---------------- Интеграция с CRM ----------------

const CONTACT_FROM_IDENTITY: Record<string, string> = { email: "email", phone: "phone", domain: "website" };

/** Создаёт (или находит) клиента CRM для лида: контакты, источник, правовое основание, задача. Идемпотентно. */
export async function ensureClientForLead(user: CurrentUser, leadId: string, opts: { createTask?: boolean } = {}) {
  const lead = await prisma.socialLead.findUniqueOrThrow({ where: { id: leadId }, include: { identities: true, signals: { orderBy: { score: "desc" }, take: 5 } } });
  if (lead.clientId) {
    const c = await prisma.client.findFirst({ where: { id: lead.clientId, ownerId: user.id } });
    if (c) return { client: c, created: false };
  }
  const best = lead.signals[0];
  const svc = SIGNAL_SERVICES[lead.service];
  const domain = lead.identities.find((i) => i.kind === "domain")?.value ?? "";
  const dup = domain ? await prisma.client.findFirst({ where: { ownerId: user.id, website: { contains: domain } } }) : null;
  const client =
    dup ??
    (await prisma.client.create({
      data: {
        ownerId: user.id,
        companyName: lead.displayName,
        description: [lead.headline, best && `Запрос: «${best.title}»`].filter(Boolean).join("\n").slice(0, 2000),
        category: svc?.label ?? "",
        industry: "",
        country: lead.country,
        city: lead.city,
        website: domain ? `https://${domain}` : "",
        language: ["ru", "en"].includes(lead.language) ? lead.language : "en",
        status: "new",
        priority: lead.temperature === "hot" ? "high" : lead.temperature === "warm" ? "medium" : "low",
        externalId: `signal:${lead.id}`,
        doNotContact: lead.doNotContact,
      },
    }));
  for (const s of lead.signals) {
    const exists = await prisma.leadSource.findFirst({ where: { clientId: client.id, sourceUrl: s.url } });
    if (!exists)
      await prisma.leadSource.create({
        data: {
          clientId: client.id,
          sourceType: SOURCE_MAP[s.source]?.kind === "freelance" ? "job_post" : SOURCE_MAP[s.source]?.kind === "directory" ? "directory" : "social",
          sourceUrl: s.url,
          title: `${sourceLabel(s.source)}: ${s.title.slice(0, 120)}`,
          method: "import",
          checkedAt: new Date(),
          rawReference: s.text.slice(0, 1500),
          evidence: `Публикация автора ${s.authorName}${s.publishedAt ? ` от ${s.publishedAt.toLocaleDateString("ru-RU")}` : ""}. Намерение: ${s.intent}.`,
        },
      });
  }
  const contactIds: string[] = [];
  for (const i of lead.identities) {
    const type = CONTACT_FROM_IDENTITY[i.kind] ?? (i.kind === "profile" ? (i.value.startsWith("t.me/") ? "telegram" : i.value.startsWith("linkedin.com/") ? "linkedin" : "social") : null);
    if (!type) continue;
    const value = type === "telegram" ? i.value.replace(/^t\.me\//, "@") : type === "website" ? `https://${i.value}` : type === "social" || type === "linkedin" ? `https://${i.value}` : i.value;
    const normalized = normalizeContact(type, value);
    const exists = await prisma.contact.findFirst({ where: { clientId: client.id, normalizedValue: normalized } });
    if (exists) {
      contactIds.push(exists.id);
      continue;
    }
    const c = await prisma.contact.create({
      data: { clientId: client.id, type, value, normalizedValue: normalized, label: `Опубликовано автором (${sourceLabel(i.source)})`, verificationStatus: "found", doNotContact: lead.doNotContact },
    });
    contactIds.push(c.id);
  }
  // Правовое основание: автор сам опубликовал запрос услуги
  if (best && !(await prisma.consentRecord.findFirst({ where: { clientId: client.id, basis: "published_request", revokedAt: null } })))
    await prisma.consentRecord.create({
      data: { clientId: client.id, basis: "published_request", sourceUrl: best.url, note: `Публичный запрос на ${sourceLabel(best.source)}: «${best.title.slice(0, 120)}»`, recordedById: user.id, expiresAt: new Date(Date.now() + 90 * 86_400_000) },
    });
  await prisma.socialLead.update({ where: { id: lead.id }, data: { clientId: client.id, status: lead.status === "new" || lead.status === "qualified" ? "converted" : lead.status } });
  if (!dup) {
    await logInteraction(client.id, "lead_discovered", `Лид из «Спроса»: ${sourceLabel(lead.primarySource)}, Lead Score ${lead.score}`, user, { leadId: lead.id });
    if (opts.createTask !== false)
      await prisma.clientTask.create({
        data: { clientId: client.id, title: `Ответить на запрос: ${best?.title.slice(0, 80) ?? lead.displayName}`, description: best?.url ?? "", kind: "follow_up", source: "ai", priority: lead.temperature === "hot" ? "high" : "medium", dueAt: new Date(Date.now() + 86_400_000), assigneeId: user.id },
      });
  }
  await logProcessing(user.id, { leadId: lead.id, subject: lead.displayName, action: "converted", basis: "published_request", sourceUrl: best?.url, note: `Карточка CRM ${client.id}` });
  return { client, created: !dup, contactIds };
}

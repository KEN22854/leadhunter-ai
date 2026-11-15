import "server-only";
import { prisma } from "../db";
import { sourceLabel } from "./catalog";
import { SIGNAL_SERVICES } from "./lexicon";

// Outreach Analytics. Отправленными считаются только подтверждённые отправки:
// confirmed_sent (пользователь подтвердил ручную отправку) и sent (официальный канал принял сообщение).
// Подготовленное ≠ отправленное; доставленное ≠ прочитанное — прочтение не учитывается вовсе, т.к. площадки его не подтверждают.

type Bucket = { key: string; label: string; leads: number; hot: number; contacted: number; replies: number; positive: number; conversion: number };

export async function signalAnalytics(ownerId: string, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);
  const leads = await prisma.socialLead.findMany({
    where: { ownerId, createdAt: { gte: since } },
    select: { id: true, primarySource: true, service: true, country: true, temperature: true, firstSeenAt: true, firstContactAt: true, status: true },
  });
  const ids = leads.map((l) => l.id);
  const attempts = await prisma.outreachAttempt.findMany({ where: { leadId: { in: ids } }, select: { leadId: true, status: true, outcome: true, sentAt: true } });
  const drafts = await prisma.outreachDraft.count({ where: { leadId: { in: ids }, status: { not: "archived" } } });
  const signals = await prisma.leadSignal.groupBy({ by: ["source"], where: { ownerId, createdAt: { gte: since } }, _count: { _all: true } });

  const sent = attempts.filter((a) => a.status === "confirmed_sent" || a.status === "sent");
  const contactedLeads = new Set(sent.map((a) => a.leadId));
  const repliedLeads = new Set(sent.filter((a) => ["replied", "positive", "negative"].includes(a.outcome)).map((a) => a.leadId));
  const positiveLeads = new Set(sent.filter((a) => a.outcome === "positive").map((a) => a.leadId));
  const negativeLeads = new Set(sent.filter((a) => a.outcome === "negative").map((a) => a.leadId));

  function bucket(keyOf: (l: (typeof leads)[number]) => string, labelOf: (k: string) => string): Bucket[] {
    const m = new Map<string, Bucket>();
    for (const l of leads) {
      const k = keyOf(l) || "—";
      const b = m.get(k) ?? { key: k, label: labelOf(k), leads: 0, hot: 0, contacted: 0, replies: 0, positive: 0, conversion: 0 };
      b.leads++;
      if (l.temperature === "hot") b.hot++;
      if (contactedLeads.has(l.id)) b.contacted++;
      if (repliedLeads.has(l.id)) b.replies++;
      if (positiveLeads.has(l.id)) b.positive++;
      m.set(k, b);
    }
    return [...m.values()].map((b) => ({ ...b, conversion: b.contacted ? Math.round((b.positive / b.contacted) * 1000) / 10 : 0 })).sort((a, b) => b.leads - a.leads);
  }

  const contactTimes = leads.filter((l) => l.firstContactAt).map((l) => (l.firstContactAt!.getTime() - l.firstSeenAt.getTime()) / 3_600_000);
  const avgHoursToContact = contactTimes.length ? Math.round((contactTimes.reduce((s, x) => s + x, 0) / contactTimes.length) * 10) / 10 : null;

  return {
    periodDays: days,
    totals: {
      leads: leads.length,
      hot: leads.filter((l) => l.temperature === "hot").length,
      warm: leads.filter((l) => l.temperature === "warm").length,
      signals: signals.reduce((s, x) => s + x._count._all, 0),
      draftsPrepared: drafts,
      attemptsPrepared: attempts.length,
      confirmedSends: sent.length,
      leadsContacted: contactedLeads.size,
      replies: repliedLeads.size,
      positive: positiveLeads.size,
      declined: negativeLeads.size,
      failed: attempts.filter((a) => a.status === "failed").length,
      conversion: contactedLeads.size ? Math.round((positiveLeads.size / contactedLeads.size) * 1000) / 10 : 0,
      avgHoursToContact,
    },
    bySource: bucket((l) => l.primarySource, sourceLabel),
    byService: bucket((l) => l.service, (k) => SIGNAL_SERVICES[k]?.label ?? k),
    byCountry: bucket((l) => l.country, (k) => k),
    signalsBySource: signals.map((s) => ({ key: s.source, label: sourceLabel(s.source), count: s._count._all })).sort((a, b) => b.count - a.count),
  };
}

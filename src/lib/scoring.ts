import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { CurrentUser } from "./auth";
import { computeLeadScore } from "./score";
import { scoreCategory } from "./domain";
import { logInteraction } from "./timeline";

export async function countConflicts(clientId: string) {
  const rows = await prisma.fieldProvenance.findMany({ where: { clientId }, select: { field: true, value: true, selected: true } });
  const byField = new Map<string, { values: Set<string>; resolved: boolean }>();
  for (const r of rows) {
    const e = byField.get(r.field) ?? { values: new Set<string>(), resolved: false };
    e.values.add(r.value.trim().toLowerCase());
    if (r.selected) e.resolved = true;
    byField.set(r.field, e);
  }
  return [...byField.values()].filter((e) => e.values.size > 1 && !e.resolved).length;
}

export async function recalcScore(clientId: string, actor: CurrentUser | null) {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      contacts: { select: { type: true, verificationStatus: true, doNotContact: true } },
      sources: { select: { sourceType: true, capturedAt: true, checkedAt: true } },
      analyses: { orderBy: { createdAt: "desc" }, take: 1 },
      scores: { orderBy: { calculatedAt: "desc" }, take: 1 },
    },
  });
  const a = client.analyses[0];
  const result = computeLeadScore({
    client,
    contacts: client.contacts,
    sources: client.sources,
    analysis: a ? { recommendations: a.recommendations, confidence: a.confidence, createdAt: a.createdAt } : null,
    conflicts: await countConflicts(clientId),
  });
  const prev = client.scores[0]?.score;
  const saved = await prisma.leadScore.create({
    data: { clientId, score: result.score, factors: result.factors as unknown as Prisma.InputJsonValue, explanation: result.explanation },
  });
  await prisma.client.update({ where: { id: clientId }, data: { priority: scoreCategory(result.score).key } });
  if (prev !== result.score) {
    await logInteraction(clientId, "score_changed", `Lead Score: ${prev ?? "—"} → ${result.score}`, actor, { from: prev ?? null, to: result.score });
  }
  return saved;
}

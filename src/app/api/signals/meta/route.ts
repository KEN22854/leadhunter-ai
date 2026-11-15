import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAIConfigured } from "@/lib/ai/provider";
import { sourceReadiness } from "@/lib/signals/adapters";
import { GROUPS, SOURCES } from "@/lib/signals/catalog";
import { INTENTS, LANGS, SIGNAL_SERVICES } from "@/lib/signals/lexicon";
import { TEMPERATURES } from "@/lib/signals/classify";

export const runtime = "nodejs";

export const GET = handler(async () => {
  await requireUser();
  const states = await prisma.sourceState.findMany();
  const byKey = new Map(states.map((s) => [s.source, s]));
  return {
    groups: GROUPS,
    sources: SOURCES.map((s) => {
      const st = byKey.get(s.key);
      return {
        ...s,
        readiness: sourceReadiness(s.key),
        health: st
          ? { lastOkAt: st.lastOkAt, lastErrorAt: st.lastErrorAt, lastError: st.lastError, consecutiveFails: st.consecutiveFails, backoffUntil: st.backoffUntil, requestsToday: st.dayKey === new Date().toISOString().slice(0, 10) ? st.requestsToday : 0 }
          : null,
      };
    }),
    services: Object.fromEntries(Object.entries(SIGNAL_SERVICES).map(([k, v]) => [k, { label: v.label, queries: v.queries }])),
    languages: LANGS,
    intents: INTENTS,
    temperatures: TEMPERATURES,
    ai: await isAIConfigured(),
  };
});

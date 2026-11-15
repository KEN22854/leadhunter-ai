import "server-only";
import { processCampaigns } from "../campaigns";
import { imapConfigured, syncEmailInbox } from "../channels/imap";
import { processEnrichmentQueue } from "../discovery/service";
import { processDueCampaigns } from "../signals/engine";
import { processThreadsQueue } from "../signals/outreach";

// Фоновый планировщик внутри процесса Next.js (запускается из src/instrumentation.ts).
// Подходит для одного инстанса; при нескольких нужен внешний планировщик/очередь.
// Каждая задача защищена от наложения: следующий запуск не стартует, пока не закончился предыдущий.

type Job = { name: string; everyMs: number; run: () => Promise<unknown>; busy?: boolean; last?: number; lastError?: string; lastResult?: unknown };

const jobs: Job[] = [
  { name: "enrichment", everyMs: 5_000, run: () => processEnrichmentQueue(3) },
  { name: "campaigns", everyMs: 30_000, run: () => processCampaigns() },
  { name: "signals", everyMs: 60_000, run: () => processDueCampaigns() },
  { name: "threads-replies", everyMs: 60_000, run: () => processThreadsQueue() },
  { name: "imap", everyMs: Number(process.env.IMAP_POLL_SEC || 120) * 1000, run: () => (imapConfigured() ? syncEmailInbox() : Promise.resolve(null)) },
];

const g = globalThis as unknown as { __lhScheduler?: NodeJS.Timeout };

export function startScheduler() {
  if (g.__lhScheduler || process.env.DISABLE_SCHEDULER === "1") return;
  g.__lhScheduler = setInterval(() => {
    const now = Date.now();
    for (const j of jobs) {
      if (j.busy || (j.last && now - j.last < j.everyMs)) continue;
      j.busy = true;
      j.last = now;
      j.run()
        .then((r) => {
          j.lastResult = r;
          j.lastError = undefined;
        })
        .catch((e) => {
          j.lastError = e instanceof Error ? e.message : String(e);
          console.error(`[scheduler] ${j.name}:`, j.lastError);
        })
        .finally(() => {
          j.busy = false;
        });
    }
  }, 2_000);
  g.__lhScheduler.unref?.();
  console.log("[scheduler] started");
}

export function schedulerStatus() {
  return jobs.map((j) => ({ name: j.name, running: Boolean(j.busy), lastRunAt: j.last ? new Date(j.last).toISOString() : null, lastError: j.lastError ?? null }));
}

// Живая проверка модуля «Спрос» на реальных источниках (без UI):
//   npm run signals:smoke -- website fl_ru,kwork,freelancer,hn,habr
// Создаёт кампанию для первого пользователя, запускает её и печатает статистику по источникам и лучшие лиды.
import { prisma } from "../src/lib/db";
import { runCampaign } from "../src/lib/signals/engine";

const [service = "website", srcArg = "fl_ru,kwork,freelancer,dribbble,hn,habr,vc_ru,product_hunt"] = process.argv.slice(2);

async function main() {
  const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const c = await prisma.signalCampaign.create({
    data: { ownerId: user.id, name: `Smoke ${service} ${new Date().toISOString().slice(0, 16)}`, service, languages: ["ru", "en"], sources: srcArg.split(","), keywords: [], periodDays: 14, maxResults: 60, minScore: 35, useAI: false },
  });
  const t = Date.now();
  const run = await runCampaign(c.id, "manual");
  const stats = (run.stats as { sources: Record<string, { status: string; fetched: number; matched: number; saved: number; duplicates: number; filtered: Record<string, number>; error?: string }> }).sources;
  console.log(`run ${run.status} in ${Math.round((Date.now() - t) / 1000)}s: fetched=${run.fetched} matched=${run.matched} saved=${run.saved} new=${run.newLeads}`);
  for (const [k, s] of Object.entries(stats)) console.log(`  ${k.padEnd(14)} ${s.status.padEnd(7)} fetched=${s.fetched} matched=${s.matched} saved=${s.saved} dup=${s.duplicates} filtered=${JSON.stringify(s.filtered)} ${s.error ?? ""}`);
  const top = await prisma.leadSignal.findMany({ where: { runId: run.id }, orderBy: { score: "desc" }, take: 12 });
  for (const s of top) console.log(`  [${s.score} ${s.temperature} ${s.intent}] ${s.source}: ${s.title.slice(0, 90)} — ${(s.intentReasons as string[])[0]}`);
}

main().finally(() => prisma.$disconnect());

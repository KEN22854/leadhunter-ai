"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ExternalLink, Loader2, Pause, Play, Radar, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Notice, Select, SkeletonBlock, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { CampaignModal } from "@/components/signals/CampaignModal";
import { SignalsHeader, type SignalsMeta } from "@/components/signals/shared";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";

type Campaign = {
  id: string;
  name: string;
  service: string;
  city: string;
  country: string;
  languages: string[];
  sources: string[];
  schedule: string;
  status: string;
  minScore: number;
  periodDays: number;
  maxResults: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  running: boolean;
  signalCount: number;
  lastRun: Run | null;
};
type SourceStat = { status: "ok" | "error" | "skipped" | "manual"; fetched: number; matched: number; saved: number; duplicates: number; filtered: Record<string, number>; error?: string; attempts?: number; links?: { query: string; url: string }[] };
type Run = { id: string; status: string; trigger: string; fetched: number; matched: number; saved: number; newLeads: number; error: string; startedAt: string; finishedAt: string | null; stats: { sources: Record<string, SourceStat>; ai?: string } | null };

const RUN_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "info" }> = {
  running: { label: "Выполняется", tone: "info" },
  done: { label: "Готово", tone: "ok" },
  partial: { label: "Частично", tone: "warn" },
  failed: { label: "Ошибка", tone: "danger" },
};
const SCHEDULE: Record<string, string> = { once: "Однократно", daily: "Ежедневно", weekly: "Еженедельно" };
const SRC_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  ok: { label: "OK", tone: "ok" },
  error: { label: "Ошибка", tone: "danger" },
  skipped: { label: "Пропущен", tone: "neutral" },
  manual: { label: "Ручной режим", tone: "warn" },
};

function CampaignsInner() {
  const sp = useSearchParams();
  const toast = useToast();
  const { data: meta } = useApi<SignalsMeta>("/api/signals/meta");
  const { data, error, loading, reload } = useApi<{ campaigns: Campaign[] }>("/api/signals/campaigns");
  const [active, setActive] = useState<string | null>(sp.get("open"));
  const { data: detail, reload: reloadDetail } = useApi<{ campaign: Campaign; runs: Run[] }>(active ? `/api/signals/campaigns/${active}` : null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const label = (k: string) => meta?.sources.find((s) => s.key === k)?.label ?? k;

  useEffect(() => {
    if (!active && data?.campaigns.length) setActive(data.campaigns[0].id);
  }, [data, active]);
  const isRunning = detail?.campaign.running || detail?.runs[0]?.status === "running";
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => {
      void reloadDetail();
      void reload();
    }, 3000);
    return () => clearInterval(t);
  }, [isRunning, reloadDetail, reload]);

  async function act(kind: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(kind);
    try {
      await fn();
      toast("success", ok);
      await Promise.all([reload(), reloadDetail()]);
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }
  const c = detail?.campaign;
  const lastRun = detail?.runs[0];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <SignalsHeader
        title="Кампании поиска"
        text="Сохранённые параметры поиска: запуск вручную, ежедневно или еженедельно. Статистика по каждому источнику: что получено, отфильтровано и сохранено."
        action={
          <Button variant="primary" icon={<Radar className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
            Новая кампания
          </Button>
        }
      />
      {loading && !data ? (
        <SkeletonBlock rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.campaigns.length ? (
        <EmptyState icon={<Radar className="h-6 w-6" />} title="Кампаний пока нет" text="Создайте первую кампанию поиска спроса." action={<Button variant="primary" onClick={() => setNewOpen(true)}>Создать</Button>} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <ul className="space-y-2">
            {data.campaigns.map((x) => (
              <li key={x.id}>
                <button onClick={() => setActive(x.id)} className={clsx("card w-full p-3 text-left transition", active === x.id ? "border-accent/60" : "hover:border-accent/40")}>
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium">{x.name}</p>
                    {x.running ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : x.status === "paused" ? <Badge>Пауза</Badge> : null}
                  </div>
                  <p className="text-xs text-muted">
                    {SCHEDULE[x.schedule]} · {x.sources.length} источн. · найдено {x.signalCount}
                  </p>
                  <p className="text-xs text-muted">{x.lastRunAt ? `Запуск ${fmtDate(x.lastRunAt, true)}` : "Ещё не запускалась"}</p>
                </button>
              </li>
            ))}
          </ul>

          {c ? (
            <section className="min-w-0 space-y-3">
              <div className="card space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">{c.name}</h2>
                    <p className="text-xs text-muted">
                      {meta?.services[c.service]?.label ?? c.service} · {[c.city, c.country].filter(Boolean).join(", ") || "без гео"} · языки: {c.languages.join(", ")} · период {c.periodDays} дн. · мин. score {c.minScore}
                    </p>
                    {c.nextRunAt && c.status === "active" && <p className="text-xs text-muted">Следующий запуск: {fmtDate(c.nextRunAt, true)}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" loading={busy === "run" || Boolean(isRunning)} icon={<Play className="h-3.5 w-3.5" />} onClick={() => act("run", () => api("POST", `/api/signals/campaigns/${c.id}/run`, {}), "Запуск начат")}>
                      {isRunning ? "Выполняется" : "Запустить"}
                    </Button>
                    <Select className="h-8 w-36 text-xs" value={c.schedule} onChange={(v) => act("sched", () => api("PATCH", `/api/signals/campaigns/${c.id}`, { schedule: v }), "Расписание обновлено")} options={SCHEDULE} />
                    <Button size="sm" icon={c.status === "paused" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} onClick={() => act("pause", () => api("PATCH", `/api/signals/campaigns/${c.id}`, { status: c.status === "paused" ? "active" : "paused" }), c.status === "paused" ? "Мониторинг возобновлён" : "Мониторинг на паузе")}>
                      {c.status === "paused" ? "Возобновить" : "Пауза"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      onClick={() => {
                        if (confirm("Удалить кампанию? Найденные лиды останутся."))
                          void act("del", () => api("DELETE", `/api/signals/campaigns/${c.id}`), "Кампания удалена").then(() => setActive(null));
                      }}
                      aria-label="Удалить кампанию"
                    />
                  </div>
                </div>
                <Link href={`/signals?campaign=${c.id}`} className="text-sm text-accent hover:underline">
                  Найдено публикаций: {c.signalCount} → к лидам
                </Link>
              </div>

              {lastRun && (
                <div className="card space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">Последний запуск</h3>
                    <Badge tone={RUN_STATUS[lastRun.status]?.tone ?? "info"}>{RUN_STATUS[lastRun.status]?.label ?? lastRun.status}</Badge>
                    <span className="text-xs text-muted">
                      {fmtDate(lastRun.startedAt, true)} · получено {lastRun.fetched} · подходит {lastRun.matched} · сохранено {lastRun.saved} · новых лидов {lastRun.newLeads}
                    </span>
                    <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => reloadDetail()} aria-label="Обновить" />
                  </div>
                  {lastRun.stats?.ai && <Notice tone={/недоступен|не подключ/.test(lastRun.stats.ai) ? "warn" : "info"}>{lastRun.stats.ai}</Notice>}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="text-left text-xs text-muted">
                        <tr>
                          <th className="py-1 pr-2 font-medium">Источник</th>
                          <th className="py-1 pr-2 font-medium">Статус</th>
                          <th className="py-1 pr-2 text-right font-medium">Получено</th>
                          <th className="py-1 pr-2 text-right font-medium">Подходит</th>
                          <th className="py-1 pr-2 text-right font-medium">Сохранено</th>
                          <th className="py-1 font-medium">Отфильтровано / причина</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(lastRun.stats?.sources ?? {}).map(([k, s]) => (
                          <tr key={k} className="border-t border-border/60 align-top">
                            <td className="py-1.5 pr-2">{label(k)}</td>
                            <td className="py-1.5 pr-2">
                              <Badge tone={SRC_STATUS[s.status].tone}>{SRC_STATUS[s.status].label}</Badge>
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{s.fetched}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{s.matched}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">
                              {s.saved}
                              {s.duplicates ? <span className="text-muted"> (+{s.duplicates} дубл.)</span> : null}
                            </td>
                            <td className="py-1.5 text-xs text-muted">
                              {Object.entries(s.filtered)
                                .map(([r, n]) => `${r}: ${n}`)
                                .join(" · ")}
                              {s.error && <p className={s.status === "error" ? "text-danger" : ""}>{s.error}</p>}
                              {s.links?.length ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {s.links.map((l) => (
                                    <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-text hover:border-accent/60">
                                      {l.query} <ExternalLink className="h-3 w-3" />
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {Object.values(lastRun.stats?.sources ?? {}).some((s) => s.status === "error") && (
                    <Button
                      size="sm"
                      icon={<RotateCcw className="h-3.5 w-3.5" />}
                      loading={busy === "retry"}
                      onClick={() =>
                        act(
                          "retry",
                          () => api("POST", `/api/signals/campaigns/${c.id}/run`, { sources: Object.entries(lastRun.stats?.sources ?? {}).filter(([, s]) => s.status === "error").map(([k]) => k) }),
                          "Повторный опрос источников с ошибками запущен",
                        )
                      }
                    >
                      Повторить источники с ошибками
                    </Button>
                  )}
                </div>
              )}

              {(detail?.runs.length ?? 0) > 1 && (
                <div className="card p-4">
                  <h3 className="mb-2 font-medium">История запусков</h3>
                  <ul className="space-y-1 text-sm">
                    {detail!.runs.slice(1).map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2">
                        <Badge tone={RUN_STATUS[r.status]?.tone ?? "info"}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge>
                        <span className="text-muted">
                          {fmtDate(r.startedAt, true)} · {r.trigger === "schedule" ? "по расписанию" : r.trigger === "retry" ? "повтор" : "вручную"} · сохранено {r.saved}, новых {r.newLeads}
                        </span>
                        {r.error && <span className="truncate text-xs text-danger" title={r.error}>{r.error.slice(0, 80)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ) : (
            <SkeletonBlock rows={4} />
          )}
        </div>
      )}
      <CampaignModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        meta={meta}
        onCreated={(id) => {
          toast("success", "Кампания создана и запущена");
          setActive(id);
          void reload();
        }}
      />
    </div>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={<SkeletonBlock rows={4} />}>
      <CampaignsInner />
    </Suspense>
  );
}

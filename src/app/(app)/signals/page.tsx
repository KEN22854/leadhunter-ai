"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ExternalLink, MessageSquareText, Plus, Radar, Search } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Select, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { CampaignModal } from "@/components/signals/CampaignModal";
import { ManualSignalModal } from "@/components/signals/ManualSignalModal";
import { INTENT_UI, ScorePill, SignalsHeader, TEMP_UI, TempBadge, type SignalsMeta } from "@/components/signals/shared";
import { fmtDate, useApi } from "@/lib/client-api";
import { Pager } from "@/components/ui/Pager";

type LeadRow = {
  id: string;
  displayName: string;
  headline: string;
  primarySource: string;
  score: number;
  temperature: string;
  intent: string;
  status: string;
  clientId: string | null;
  doNotContact: boolean;
  lastSeenAt: string;
  signals: { id: string; title: string; url: string; source: string; publishedAt: string | null; budget: string; intent: string }[];
  _count: { signals: number; attempts: number };
};

const STATUS: Record<string, string> = { new: "Новый", qualified: "Квалифицирован", converted: "В CRM", contacted: "Связались", replied: "Ответил", positive: "Положительный ответ", declined: "Отказ", archived: "Архив" };

function SignalsInner() {
  const router = useRouter();
  const campaign = useSearchParams().get("campaign") ?? "";
  const toast = useToast();
  const { data: meta } = useApi<SignalsMeta>("/api/signals/meta");
  const [temp, setTemp] = useState<string>(campaign ? "" : "hot,warm");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [sort, setSort] = useState("score");
  const [page, setPage] = useState(1);
  const url = `/api/signals/leads?${new URLSearchParams({ ...(temp ? { temperature: temp } : {}), ...(source ? { source } : {}), ...(qApplied ? { q: qApplied } : {}), ...(campaign ? { campaignId: campaign } : {}), sort, page: String(page) }).toString()}`;
  const { data, error, loading, reload } = useApi<{ leads: LeadRow[]; counts: Record<string, number>; page: number; pages: number; filtered: number }>(url);
  const [newOpen, setNewOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const label = (k: string) => meta?.sources.find((s) => s.key === k)?.label ?? k;
  const total = Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <SignalsHeader
        title="Спрос в соцсетях и на биржах"
        text="Люди и компании, которые публично ищут исполнителя, просят рекомендации или запускают проект. Каждое обращение — только с вашим подтверждением."
        action={
          <div className="flex flex-wrap gap-2">
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setManualOpen(true)}>
              Добавить вручную
            </Button>
            <Button variant="primary" icon={<Radar className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
              Новая кампания
            </Button>
          </div>
        }
      />

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="flex flex-wrap gap-1">
          {[
            { v: "hot,warm", l: "Горячие и тёплые", n: (data?.counts.hot ?? 0) + (data?.counts.warm ?? 0) },
            { v: "hot", l: TEMP_UI.hot.label, n: data?.counts.hot ?? 0 },
            { v: "warm", l: TEMP_UI.warm.label, n: data?.counts.warm ?? 0 },
            { v: "potential", l: TEMP_UI.potential.label, n: data?.counts.potential ?? 0 },
            { v: "", l: "Все", n: total },
          ].map((t) => (
            <button key={t.v} onClick={() => {
              setTemp(t.v);
              setPage(1);
            }} className="chip" data-active={temp === t.v}>
              {t.l} <span className="tabular-nums text-muted">{t.n}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex w-full flex-wrap gap-2 sm:w-auto">
          <Select className="w-full sm:w-44" value={source} onChange={(v) => { setSource(v); setPage(1); }} options={[{ value: "", label: "Все источники" }, ...(meta?.sources ?? []).map((s) => ({ value: s.key, label: s.label }))]} />
          <Select className="w-full sm:w-40" value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={{ score: "По Lead Score", recent: "Сначала новые" }} />
          <form
            className="flex w-full gap-1 sm:w-auto"
            onSubmit={(e) => {
              e.preventDefault();
              setQApplied(q);
              setPage(1);
            }}
          >
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по тексту" aria-label="Поиск по тексту" />
            <Button type="submit" icon={<Search className="h-4 w-4" />} aria-label="Искать" />
          </form>
        </div>
      </div>

      {loading && !data ? (
        <SkeletonBlock rows={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.leads.length ? (
        <EmptyState
          icon={<Radar className="h-6 w-6" />}
          title={total ? "Нет лидов с такими фильтрами" : "Лидов пока нет"}
          text={total ? "Измените фильтр температуры или источника." : "Создайте кампанию: выберите услугу, языки и источники — система найдёт публикации с реальным спросом."}
          action={!total && <Button variant="primary" onClick={() => setNewOpen(true)}>Создать кампанию</Button>}
        />
      ) : (
        <ul className="grid gap-2">
          {data.leads.map((l) => {
            const s = l.signals[0];
            return (
              <li key={l.id}>
                <div className="card flex gap-3 p-3 transition hover:border-accent/50">
                  <ScorePill score={l.score} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/signals/leads/${l.id}`} className="font-medium hover:underline">
                        {s?.title || l.displayName}
                      </Link>
                      <TempBadge t={l.temperature} />
                      <Badge>{INTENT_UI[l.intent] ?? l.intent}</Badge>
                      {s?.budget && <Badge tone="ok">{s.budget}</Badge>}
                      {l.status !== "new" && <Badge tone="accent">{STATUS[l.status] ?? l.status}</Badge>}
                      {l.doNotContact && <Badge tone="danger">Не связываться</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {l.displayName} · {label(l.primarySource)} · {s?.publishedAt ? fmtDate(s.publishedAt, true) : `найден ${fmtDate(l.lastSeenAt)}`}
                      {l._count.signals > 1 && ` · ${l._count.signals} публикации`}
                      {l._count.attempts > 0 && ` · обращений: ${l._count.attempts}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {s?.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="rounded-md p-2 text-muted hover:bg-surface2 hover:text-text" aria-label="Открыть публикацию" title="Открыть публикацию">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <Link href={`/signals/leads/${l.id}#outreach`} className="rounded-md p-2 text-muted hover:bg-surface2 hover:text-text" aria-label="Подготовить обращение" title="Подготовить обращение">
                      <MessageSquareText className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.pages > 1 && <Pager page={data.page} pages={data.pages} onPage={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}

      <CampaignModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        meta={meta}
        onCreated={(id) => {
          toast("success", "Кампания создана и запущена");
          router.push(`/signals/campaigns?open=${id}`);
        }}
      />
      <ManualSignalModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        meta={meta}
        onAdded={(id) => {
          toast("success", "Публикация добавлена и оценена");
          router.push(`/signals/leads/${id}`);
        }}
      />
    </div>
  );
}

export default function SignalsPage() {
  return (
    <Suspense fallback={<SkeletonBlock rows={6} />}>
      <SignalsInner />
    </Suspense>
  );
}

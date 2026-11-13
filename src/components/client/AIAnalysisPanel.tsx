"use client";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, ListPlus, Sparkles } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, InlineError, Notice, SectionTitle, Select, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import { SERVICES } from "@/lib/domain";
import { useClient } from "./context";
import { AINotConfigured } from "./AINotConfigured";
import type { Analysis } from "./types";

type Resp = { analyses: Analysis[]; sources: { id: string; sourceUrl: string; title: string; sourceType: string; capturedAt: string }[] };
const CONF: Record<string, string> = { high: "высокая", medium: "средняя", low: "низкая" };

export function AIAnalysisPanel() {
  const { clientId, bundle, reloadBundle, openTask } = useClient();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Resp>(`/api/clients/${clientId}/analysis`);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");

  async function run() {
    setRunning(true);
    setRunError(null);
    try {
      await api("POST", `/api/clients/${clientId}/analysis`);
      toast("success", "AI-анализ готов");
      setSelected("");
      await Promise.all([reload(), reloadBundle()]);
    } catch (e) {
      setRunError(e instanceof ApiClientError ? e.message : "Ошибка анализа");
    } finally {
      setRunning(false);
    }
  }

  if (loading && !data) return <SkeletonBlock rows={6} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const a = data?.analyses.find((x) => x.id === selected) ?? data?.analyses[0];
  const srcById = new Map(data?.sources.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      {!bundle.ai.configured && <AINotConfigured />}
      <div className="card flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">AI-анализ клиента</p>
          <p className="text-xs text-muted">
            Загружаются публичные страницы сайта (главная + до 2 страниц «о компании/услуги/контакты», с учётом robots.txt) и источники карточки. Модель не
            придумывает факты и отделяет их от гипотез.
          </p>
        </div>
        {data && data.analyses.length > 1 && (
          <Select
            value={a?.id ?? ""}
            onChange={setSelected}
            options={data.analyses.map((x) => ({ value: x.id, label: `от ${fmtDate(x.createdAt, true)}` }))}
            className="w-auto"
          />
        )}
        <Button variant="primary" loading={running} icon={<Sparkles className="h-4 w-4" />} disabledReason={bundle.ai.configured ? undefined : "AI не подключён"} onClick={run}>
          {a ? "Обновить анализ" : "Запустить анализ"}
        </Button>
      </div>
      {running && <Notice tone="info">Анализ выполняется: загрузка сайта и обработка моделью может занять до минуты…</Notice>}
      {runError && (
        <div className="space-y-2">
          <InlineError text={runError} />
          <Button size="sm" onClick={run} disabledReason={bundle.ai.configured ? undefined : "AI не подключён"}>
            Повторить
          </Button>
        </div>
      )}

      {!a ? (
        <EmptyState title="Анализ ещё не проводился" text="Запустите анализ, чтобы получить структурированный отчёт по клиенту." />
      ) : (
        <>
          {a.findings.insufficientData && <Notice tone="warn">Данных недостаточно для уверенных выводов — модель сообщила об этом явно.</Notice>}
          <section className="card space-y-2">
            <SectionTitle>Бизнес и позиционирование</SectionTitle>
            <p className="text-sm">{a.summary}</p>
            <p className="text-sm text-muted">{a.findings.audienceAndProducts}</p>
          </section>

          <section className="card space-y-2">
            <SectionTitle>Анализ сайта</SectionTitle>
            {!a.findings.siteReview.observed ? (
              <p className="text-sm text-muted">Сайт не анализировался (нет сайта или страницы недоступны).</p>
            ) : (
              <dl className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["Структура", a.findings.siteReview.structure],
                    ["Визуальная подача", a.findings.siteReview.visual],
                    ["UX", a.findings.siteReview.ux],
                    ["Контент", a.findings.siteReview.content],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-semibold text-muted">{k}</dt>
                    <dd className="text-sm">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {a.pagesAnalyzed.length > 0 && (
              <p className="text-xs text-muted">
                Просмотрено страниц: {a.pagesAnalyzed.length} —{" "}
                {a.pagesAnalyzed.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="mr-2 text-accent2 hover:underline">
                    {u.replace(/^https?:\/\//, "")}
                  </a>
                ))}
              </p>
            )}
            {a.findings.fetchErrors?.length > 0 && <p className="text-xs text-warn">Не загружено: {a.findings.fetchErrors.map((e) => `${e.url} — ${e.error}`).join("; ")}</p>}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card">
              <SectionTitle>Признаки возможной потребности</SectionTitle>
              <ul className="space-y-2 text-sm">
                {a.findings.needSignals.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {s.confirmed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
                    <span>
                      {s.signal}
                      <span className="ml-1 text-xs text-muted">
                        {s.confirmed ? "подтверждено" : "гипотеза"}
                        {s.sourceId && srcById.get(s.sourceId) ? ` · ${srcById.get(s.sourceId)!.title || srcById.get(s.sourceId)!.sourceUrl}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
                {!a.findings.needSignals.length && <li className="text-muted">Не обнаружено.</li>}
              </ul>
            </section>
            <section className="card">
              <SectionTitle>Рекомендуемые услуги</SectionTitle>
              <ul className="space-y-2">
                {a.recommendations.map((r, i) => (
                  <li key={i} className="rounded-lg border border-border/60 bg-surface2/40 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{SERVICES[r.service as keyof typeof SERVICES] ?? r.service}</span>
                      <Badge tone={r.isHypothesis ? "warn" : "ok"}>{r.isHypothesis ? "гипотеза" : "по данным"}</Badge>
                    </div>
                    <p className="mt-1 text-muted">{r.rationale}</p>
                    {r.arguments.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-xs">
                        {r.arguments.map((x, j) => (
                          <li key={j}>{x}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
                {!a.recommendations.length && <li className="text-sm text-muted">Нет рекомендаций.</li>}
              </ul>
            </section>
            <section className="card">
              <SectionTitle>Риски и пробелы</SectionTitle>
              <ul className="space-y-1.5 text-sm">
                {[...a.risks.map((r) => ({ t: r, k: "risk" })), ...a.findings.gaps.map((g) => ({ t: g, k: "gap" }))].map((x, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${x.k === "risk" ? "text-danger" : "text-warn"}`} />
                    {x.t}
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <SectionTitle>Вопросы для проверки</SectionTitle>
              <ul className="space-y-1.5 text-sm">
                {a.findings.questionsToVerify.map((q, i) => (
                  <li key={i} className="flex items-start justify-between gap-2">
                    <span>{q}</span>
                    <button className="shrink-0 text-muted hover:text-accent" title="Создать задачу" aria-label={`Создать задачу: ${q}`} onClick={() => openTask({ title: `Проверить: ${q}`.slice(0, 290), source: "ai" })}>
                      <ListPlus className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="card">
            <SectionTitle>Источники и подтверждаемые утверждения</SectionTitle>
            <ul className="space-y-2 text-sm">
              {a.sources.map((s, i) => {
                const src = srcById.get(s.sourceId);
                return (
                  <li key={i} className="rounded-lg border border-border/60 p-2.5">
                    <p className="text-xs text-muted">
                      {src ? (
                        <>
                          {src.sourceUrl ? (
                            <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent2 hover:underline">
                              {src.title || src.sourceUrl}
                            </a>
                          ) : (
                            src.title || "Внесено вручную"
                          )}{" "}
                          · получено {fmtDate(src.capturedAt)}
                        </>
                      ) : (
                        s.sourceRef || "источник не указан"
                      )}
                    </p>
                    <ul className="mt-1 list-disc pl-5">
                      {s.claims.map((c, j) => (
                        <li key={j}>{c}</li>
                      ))}
                    </ul>
                  </li>
                );
              })}
              {!a.sources.length && <li className="text-muted">Модель не привязала утверждения к источникам.</li>}
            </ul>
          </section>
          <p className="text-xs text-muted">
            Дата анализа: {fmtDate(a.createdAt, true)} · модель: {a.model} · промпт: {a.promptVersion} · уверенность: {CONF[a.confidence] ?? a.confidence}
          </p>
        </>
      )}
    </div>
  );
}

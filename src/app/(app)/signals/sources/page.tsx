"use client";
import { CheckCircle2, CircleSlash, ExternalLink, KeyRound, PauseCircle, XCircle } from "lucide-react";
import { Badge, ErrorState, Notice, SkeletonBlock } from "@/components/ui";
import { ACCESS_UI, SignalsHeader, type SignalsMeta } from "@/components/signals/shared";
import { fmtDate, useApi } from "@/lib/client-api";
import { SourceTestButton } from "@/components/signals/SourceTest";

const REPLY: Record<string, string> = { api: "официальная отправка", open_dialog: "открыть диалог, отправить вручную", platform_reply: "отклик механизмом площадки" };

export default function SourcesPage() {
  const { data, error, loading, reload } = useApi<SignalsMeta>("/api/signals/meta");
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <SignalsHeader title="Источники" text="Отдельный адаптер для каждой площадки: способ доступа, готовность, здоровье (ошибки, лимиты, пауза после сбоев) и допустимый способ связи." />
      <Notice tone="info">
        Используются только официальные API, RSS и публичные страницы, разрешённые robots.txt. CAPTCHA, авторизация и ограничения не обходятся: ответы 401/403/429 переводят источник на паузу. Ключи API задаются в <code>.env</code> (см. README) и применяются после перезапуска.
      </Notice>
      {loading && !data ? (
        <SkeletonBlock rows={8} />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        Object.entries(data.groups).map(([g, gl]) => (
          <section key={g} className="space-y-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{gl}</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {data.sources
                .filter((s) => s.group === g && s.key !== "manual")
                .map((s) => {
                  const h = s.health;
                  const paused = h?.backoffUntil && new Date(h.backoffUntil) > new Date();
                  return (
                    <article key={s.key} className="card space-y-1.5 p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {s.readiness.ready ? paused ? <PauseCircle className="h-4 w-4 text-warn" /> : <CheckCircle2 className="h-4 w-4 text-ok" /> : s.access === "api_key" ? <KeyRound className="h-4 w-4 text-accent2" /> : s.access === "closed" ? <CircleSlash className="h-4 w-4 text-muted" /> : <XCircle className="h-4 w-4 text-warn" />}
                        <h3 className="font-medium">{s.label}</h3>
                        <Badge tone={ACCESS_UI[s.access].tone}>{ACCESS_UI[s.access].label}</Badge>
                        {s.readiness.ready && <Badge tone={paused ? "warn" : "ok"}>{paused ? "Пауза" : "Готов"}</Badge>}
                        <span className="ml-auto text-[11px] text-muted">качество {s.quality}/10</span>
                      </div>
                      <p className="text-xs text-muted">{s.note}</p>
                      {!s.readiness.ready && s.access === "api_key" && <p className="text-xs">Нужно в .env: {s.env?.map((e) => <code key={e} className="mr-1 rounded bg-surface2 px-1">{e}</code>)}</p>}
                      <p className="text-xs">Связь: {s.reply.map((r) => REPLY[r]).join(", ")} — {s.replyHint}</p>
                      {h && (
                        <p className="text-[11px] text-muted">
                          {h.lastOkAt && `Успешно: ${fmtDate(h.lastOkAt, true)}. `}
                          {h.requestsToday ? `Запросов сегодня: ${h.requestsToday}. ` : ""}
                          {h.lastError && <span className="text-danger">Ошибка {h.lastErrorAt ? fmtDate(h.lastErrorAt, true) : ""}: {h.lastError}. </span>}
                          {paused && `Пауза до ${fmtDate(h.backoffUntil!, true)}.`}
                        </p>
                      )}
                      {(s.access === "api_key" || s.access === "public") && s.key !== "custom_rss" && <SourceTestButton sourceKey={s.key} label={s.access === "api_key" ? "Проверить подключение" : "Проверить доступ"} />}
                      {s.docs && (
                        <a href={s.docs} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                          Документация API <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </article>
                  );
                })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

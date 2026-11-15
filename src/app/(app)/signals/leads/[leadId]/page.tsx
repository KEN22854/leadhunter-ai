"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArrowLeft, Building2, ExternalLink, ShieldBan, Trash2 } from "lucide-react";
import { Badge, Button, ErrorState, Modal, Notice, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { OutreachPanel, type Attempt, type Draft } from "@/components/signals/OutreachPanel";
import { INTENT_UI, ScorePill, TempBadge, type SignalsMeta } from "@/components/signals/shared";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";

type Factor = { key: string; label: string; points: number; max: number; reason: string };
type Signal = { id: string; source: string; url: string; title: string; text: string; authorName: string; authorUrl: string; publishedAt: string | null; language: string; budget: string; matchedTerms: string[] | null; intent: string; intentScore: number; intentReasons: string[] | null; aiIntent: { intent: string; confidence: number; reason: string } | null; serviceMatch: number; score: number; temperature: string; createdAt: string };
type Lead = {
  id: string;
  displayName: string;
  headline: string;
  profileUrl: string;
  primarySource: string;
  language: string;
  country: string;
  city: string;
  service: string;
  intent: string;
  temperature: string;
  score: number;
  scoreFactors: Factor[] | null;
  scoreExplanation: string;
  status: string;
  doNotContact: boolean;
  clientId: string | null;
  firstSeenAt: string;
  firstContactAt: string | null;
  signals: Signal[];
  identities: { id: string; kind: string; value: string; source: string }[];
  drafts: Draft[];
  attempts: Attempt[];
};
type LogRow = { id: string; action: string; basis: string; sourceUrl: string; note: string; createdAt: string };
type Detail = { lead: Lead; log: LogRow[]; client: { id: string; companyName: string; status: string } | null; ai: boolean; profileFilled: boolean };

const ID_KIND: Record<string, string> = { profile: "Профиль", domain: "Домен", email: "Email", phone: "Телефон", source_id: "ID в источнике" };
const ACTION: Record<string, string> = { collected: "Сбор", merged: "Объединение дублей", contacted: "Обращение", converted: "Передан в CRM", opted_out: "Запрет обращений", deleted: "Удаление" };
const BASIS: Record<string, string> = { published_request: "Опубликованный запрос", legitimate_interest: "Законный интерес", consent: "Согласие", user_request: "Запрос/решение пользователя" };
const STATUS: Record<string, string> = { new: "Новый", qualified: "Квалифицирован", converted: "В CRM", contacted: "Связались", replied: "Ответил", positive: "Положительный ответ", declined: "Отказ", archived: "Архив" };

export default function LeadPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data: meta } = useApi<SignalsMeta>("/api/signals/meta");
  const { data, error, loading, reload } = useApi<Detail>(`/api/signals/leads/${leadId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [block, setBlock] = useState(true);
  const label = (k: string) => meta?.sources.find((s) => s.key === k)?.label ?? k;

  async function act(kind: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(kind);
    try {
      await fn();
      toast("success", ok);
      await reload();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <div className="mx-auto max-w-6xl p-4 sm:p-6"><SkeletonBlock rows={8} /></div>;
  if (error || !data) return <div className="mx-auto max-w-6xl p-4 sm:p-6"><ErrorState error={error} onRetry={reload} /></div>;
  const { lead, log, client } = data;
  const best = lead.signals[0];
  const blocked = lead.doNotContact ? "Лид в списке Do Not Contact — обращения запрещены." : lead.status === "declined" ? "Человек отказался от общения — повторные обращения запрещены." : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <Link href="/signals" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Все лиды
      </Link>
      <div className="card flex flex-wrap items-start gap-3 p-4">
        <ScorePill score={lead.score} />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{best?.title || lead.displayName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <TempBadge t={lead.temperature} />
            <Badge>{INTENT_UI[lead.intent] ?? lead.intent}</Badge>
            <Badge tone="accent">{STATUS[lead.status] ?? lead.status}</Badge>
            {lead.doNotContact && <Badge tone="danger">Не связываться</Badge>}
            <span className="text-xs text-muted">
              {lead.profileUrl ? (
                <a href={lead.profileUrl} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                  {lead.displayName}
                </a>
              ) : (
                lead.displayName
              )}{" "}
              · {label(lead.primarySource)} · найден {fmtDate(lead.firstSeenAt, true)}
              {lead.firstContactAt && ` · первый контакт ${fmtDate(lead.firstContactAt, true)}`}
            </span>
          </div>
          {lead.headline && <p className="mt-1 text-sm text-muted">{lead.headline}</p>}
        </div>
        <div className="flex w-full flex-wrap gap-1.5 border-t border-border/60 pt-3">
          {best?.url && (
            <a href={best.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:border-accent/60">
              <ExternalLink className="h-3.5 w-3.5" /> Публикация
            </a>
          )}
          {client ? (
            <Link href={`/clients/${client.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/10 px-2.5 text-xs">
              <Building2 className="h-3.5 w-3.5" /> Карточка CRM
            </Link>
          ) : (
            <Button size="sm" icon={<Building2 className="h-3.5 w-3.5" />} loading={busy === "convert"} disabledReason={lead.doNotContact ? "Лид в Do Not Contact" : undefined} onClick={() => act("convert", () => api("POST", `/api/signals/leads/${lead.id}/convert`), "Клиент создан в CRM, задача добавлена")}>
              В CRM
            </Button>
          )}
          {lead.status !== "archived" && (
            <Button size="sm" variant="ghost" icon={<Archive className="h-3.5 w-3.5" />} loading={busy === "archive"} onClick={() => act("archive", () => api("PATCH", `/api/signals/leads/${lead.id}`, { status: "archived" }), "Перенесён в архив")}>
              В архив
            </Button>
          )}
          {!lead.doNotContact && (
            <Button size="sm" variant="ghost" icon={<ShieldBan className="h-3.5 w-3.5" />} loading={busy === "dnc"} onClick={() => confirm("Внести в Do Not Contact? Обращения и повторный сбор станут невозможны.") && act("dnc", () => api("POST", `/api/signals/leads/${lead.id}/dnc`, { reason: "Решение пользователя" }), "Внесён в Do Not Contact")}>
              Не связываться
            </Button>
          )}
          <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDelOpen(true)}>
            Удалить данные
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_440px]">
        <div className="min-w-0 space-y-4">
          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Почему такой Lead Score</h2>
            <p className="mb-3 text-sm text-muted">{lead.scoreExplanation}</p>
            <ul className="space-y-2">
              {(lead.scoreFactors ?? []).map((f) => (
                <li key={f.key}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>{f.label}</span>
                    <span className="tabular-nums text-muted">
                      {f.points}/{f.max}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((f.points / Math.max(1, f.max)) * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{f.reason}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">Публикации ({lead.signals.length})</h2>
            {lead.signals.map((s) => (
              <article key={s.id} className="card space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:underline">
                    {s.title || "Публикация"} <ExternalLink className="inline h-3.5 w-3.5" />
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Badge>{label(s.source)}</Badge>
                  <TempBadge t={s.temperature} />
                  <span>score {s.score}</span>
                  <span>· {s.publishedAt ? fmtDate(s.publishedAt, true) : "дата неизвестна"}</span>
                  <span>· язык {s.language}</span>
                  {s.budget && <Badge tone="ok">{s.budget}</Badge>}
                </div>
                <p className="max-h-48 overflow-y-auto whitespace-pre-line text-sm">{s.text.slice(0, 2500)}</p>
                <div className="rounded-lg bg-surface2/60 p-2 text-xs">
                  <p className="font-medium">
                    Намерение: {INTENT_UI[s.intent] ?? s.intent} · уверенность {s.intentScore}% · соответствие услуге {s.serviceMatch}%
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                    {(s.intentReasons ?? []).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  {s.matchedTerms?.length ? <p className="mt-1 text-muted">Совпадения: {s.matchedTerms.join(", ")}</p> : null}
                </div>
              </article>
            ))}
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Идентификаторы (дедупликация)</h2>
            <p className="mb-2 text-xs text-muted">По этим ключам новые публикации того же человека автоматически объединяются в эту карточку. Собраны только данные, опубликованные самим автором.</p>
            <ul className="space-y-1 text-sm">
              {lead.identities.map((i) => (
                <li key={i.id} className="flex flex-wrap gap-2">
                  <span className="w-28 shrink-0 text-xs text-muted">{ID_KIND[i.kind] ?? i.kind}</span>
                  <span className="min-w-0 break-all">{i.value}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Журнал оснований обработки</h2>
            <ul className="space-y-1.5 text-sm">
              {log.map((l) => (
                <li key={l.id} className="text-xs">
                  <span className="text-muted">{fmtDate(l.createdAt, true)}</span> · <b>{ACTION[l.action] ?? l.action}</b> · {BASIS[l.basis] ?? l.basis}
                  {l.note && <span className="text-muted"> — {l.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <OutreachPanel leadId={lead.id} drafts={lead.drafts} attempts={lead.attempts} ai={data.ai} profileFilled={data.profileFilled} blocked={blocked} onChange={reload} />
      </div>

      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Удалить данные лида">
        <div className="space-y-3 text-sm">
          <p>Будут удалены карточка, публикации, идентификаторы, черновики и история обращений. В журнале оснований останется обезличенная запись об удалении. Карточка в CRM (если создана) удаляется отдельно.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={block} onChange={(e) => setBlock(e.target.checked)} />
            <span>Запретить повторный сбор и обращения (добавить идентификаторы в Do Not Contact). Рекомендуется, если человек попросил удалить данные.</span>
          </label>
          <Notice tone="warn">Действие необратимо.</Notice>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDelOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              loading={busy === "delete"}
              onClick={async () => {
                setBusy("delete");
                try {
                  await api("DELETE", `/api/signals/leads/${lead.id}?block=${block ? 1 : 0}&reason=${encodeURIComponent("Удаление данных пользователем")}`);
                  toast("success", "Данные удалены");
                  router.replace("/signals");
                } catch (e) {
                  toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
                  setBusy(null);
                }
              }}
            >
              Удалить навсегда
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

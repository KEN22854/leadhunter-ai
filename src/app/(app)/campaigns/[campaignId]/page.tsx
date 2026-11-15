"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Pause, Play, Rocket, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, ErrorState, Field, InlineError, Modal, Notice, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { AuditScore } from "@/components/discovery/AuditView";
import { CAMPAIGN_STATUS, ITEM_TONE } from "@/components/campaigns/status";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";

type Campaign = {
  id: string;
  name: string;
  status: string;
  attachPdf: boolean;
  attachHtml: boolean;
  dailyLimit: number;
  intervalMin: number;
  windowStart: number;
  windowEnd: number;
  approvedAt: string | null;
  lastSentAt: string | null;
};
type Item = {
  id: string;
  clientId: string;
  status: string;
  error: string;
  subject: string;
  body: string;
  referenceId: string | null;
  sentAt: string | null;
  client: { id: string; companyName: string; city: string; website: string; siteAuditScore: number | null };
  contact: { id: string; value: string; verificationStatus: string } | null;
};
type Resp = { campaign: Campaign; items: Item[]; statuses: Record<string, string>; generating: boolean };

export default function CampaignPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Resp>(`/api/campaigns/${campaignId}`);
  const [approveOpen, setApproveOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const live = data && (data.generating || data.campaign.status === "running");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  if (loading && !data) return <div className="mx-auto max-w-5xl p-6"><SkeletonBlock rows={6} /></div>;
  if (error || !data) return <div className="mx-auto max-w-5xl p-6"><ErrorState error={error} onRetry={reload} /></div>;
  const { campaign: c, items, statuses } = data;
  const st = CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.draft;
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const editable = c.status === "draft" || c.status === "paused";

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
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

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <Link href="/campaigns" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Кампании
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{c.name}</h1>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <p className="text-sm text-muted">
            Писем {items.length} · готово {count("ready")} · нужен референс {count("draft")} · в очереди {count("queued")} · отправлено {count("sent")} · ответили {count("replied")}
            {c.lastSentAt ? ` · последнее ${fmtDate(c.lastSentAt)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {count("draft") > 0 && editable && (
            <Button icon={data.generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} disabledReason={data.generating ? "Генерация идёт" : undefined} loading={busy === "gen"} onClick={() => act("gen", () => api("POST", `/api/campaigns/${c.id}/generate`), "Генерация референсов запущена")}>
              {data.generating ? "Генерируем…" : `Сгенерировать референсы (${count("draft")})`}
            </Button>
          )}
          {c.status === "running" && (
            <Button icon={<Pause className="h-4 w-4" />} loading={busy === "pause"} onClick={() => act("pause", () => api("POST", `/api/campaigns/${c.id}/pause`, { paused: true }), "Кампания на паузе")}>
              Пауза
            </Button>
          )}
          {c.status === "paused" && (
            <Button icon={<Play className="h-4 w-4" />} loading={busy === "resume"} onClick={() => act("resume", () => api("POST", `/api/campaigns/${c.id}/pause`, { paused: false }), "Отправка продолжена")}>
              Продолжить
            </Button>
          )}
          {editable && (
            <Button variant="primary" icon={<Rocket className="h-4 w-4" />} disabledReason={count("ready") ? undefined : "Нет готовых писем"} onClick={() => setApproveOpen(true)}>
              Одобрить и запустить ({count("ready")})
            </Button>
          )}
          {c.status !== "running" && (
            <Button
              variant="ghost"
              icon={<Trash2 className="h-4 w-4" />}
              aria-label="Удалить кампанию"
              onClick={async () => {
                if (!confirm("Удалить кампанию? Неотправленные письма из очереди будут удалены.")) return;
                await api("DELETE", `/api/campaigns/${c.id}`).catch(() => {});
                router.push("/campaigns");
              }}
            />
          )}
        </div>
      </div>

      {data.generating && <Notice tone="info">AI готовит референсы по очереди (30–90 с на лида). Страница обновляется сама.</Notice>}
      <SettingsCard c={c} editable={editable} onSaved={reload} />

      <ul className="space-y-2">
        {items.map((it) => {
          const expanded = openItem === it.id;
          return (
            <li key={it.id} className="card p-3">
              <div className="flex items-start gap-3">
                <AuditScore score={it.client.siteAuditScore} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/clients/${it.clientId}?tab=reference`} className="font-medium hover:underline">
                      {it.client.companyName}
                    </Link>
                    <Badge tone={ITEM_TONE[it.status] ?? "neutral"}>{statuses[it.status] ?? it.status}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted">
                    {it.contact ? it.contact.value : "нет email"} · {it.subject || "без темы"}
                    {it.sentAt ? ` · отправлено ${fmtDate(it.sentAt)}` : ""}
                  </p>
                  {it.error && <p className="text-xs text-warn">{it.error}</p>}
                </div>
                <Button size="sm" variant="ghost" icon={expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} onClick={() => setOpenItem(expanded ? null : it.id)}>
                  Письмо
                </Button>
              </div>
              {expanded && <ItemEditor campaignId={c.id} it={it} onSaved={reload} />}
            </li>
          );
        })}
      </ul>
      <ApproveModal open={approveOpen} onClose={() => setApproveOpen(false)} c={c} ready={count("ready")} onDone={reload} />
    </div>
  );
}

function SettingsCard({ c, editable, onSaved }: { c: Campaign; editable: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ dailyLimit: String(c.dailyLimit), intervalMin: String(c.intervalMin), windowStart: String(c.windowStart), windowEnd: String(c.windowEnd), attachPdf: c.attachPdf, attachHtml: c.attachHtml });
  const [busy, setBusy] = useState(false);
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(/\D/g, "").slice(0, 3) });
  async function save() {
    setBusy(true);
    try {
      await api("PATCH", `/api/campaigns/${c.id}`, {
        dailyLimit: Number(f.dailyLimit),
        intervalMin: Number(f.intervalMin),
        windowStart: Number(f.windowStart),
        windowEnd: Number(f.windowEnd),
        attachPdf: f.attachPdf,
        attachHtml: f.attachHtml,
      });
      toast("success", "Настройки сохранены");
      onSaved();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <p className="mb-2 text-sm font-medium">Расписание и вложения</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Писем в день">{(id) => <input id={id} className="input" disabled={!editable} value={f.dailyLimit} onChange={num("dailyLimit")} />}</Field>
        <Field label="Пауза между, мин">{(id) => <input id={id} className="input" disabled={!editable} value={f.intervalMin} onChange={num("intervalMin")} />}</Field>
        <Field label="С, час">{(id) => <input id={id} className="input" disabled={!editable} value={f.windowStart} onChange={num("windowStart")} />}</Field>
        <Field label="До, час">{(id) => <input id={id} className="input" disabled={!editable} value={f.windowEnd} onChange={num("windowEnd")} />}</Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={!editable} checked={f.attachPdf} onChange={(e) => setF({ ...f, attachPdf: e.target.checked })} /> PDF с концепцией
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={!editable} checked={f.attachHtml} onChange={(e) => setF({ ...f, attachHtml: e.target.checked })} /> HTML-прототип (если создан)
        </label>
        <div className="flex-1" />
        {editable && (
          <Button size="sm" loading={busy} onClick={save}>
            Сохранить
          </Button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted">Небольшой дневной лимит и паузы снижают риск попасть в спам. Для новых ящиков начинайте с 10–20 писем в день.</p>
    </section>
  );
}

function ItemEditor({ campaignId, it, onSaved }: { campaignId: string; it: Item; onSaved: () => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(it.subject);
  const [body, setBody] = useState(it.body);
  const [busy, setBusy] = useState(false);
  const editable = ["draft", "ready", "skipped"].includes(it.status);
  async function patch(data: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      await api("PATCH", `/api/campaigns/${campaignId}/items/${it.id}`, data);
      toast("success", ok);
      onSaved();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
      <Field label="Тема">{(id) => <input id={id} className="input" disabled={!editable} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
      <Field label="Текст">{(id) => <textarea id={id} className="input min-h-[160px]" disabled={!editable} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy} disabledReason={subject !== it.subject || body !== it.body ? undefined : "Нет изменений"} onClick={() => patch({ subject, body }, "Письмо сохранено")}>
            Сохранить
          </Button>
          {it.status === "skipped" ? (
            <Button size="sm" variant="ghost" onClick={() => patch({ skip: false }, "Возвращено в кампанию")}>
              Вернуть
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => patch({ skip: true }, "Исключено")}>
              Исключить
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ApproveModal({ open, onClose, c, ready, onDone }: { open: boolean; onClose: () => void; c: Campaign; ready: number; onDone: () => void }) {
  const toast = useToast();
  const [basis, setBasis] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ company: string; reason: string }[]>([]);
  async function approve() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ queued: number; problems: { company: string; reason: string }[] }>("POST", `/api/campaigns/${c.id}/approve`, { basisConfirmed: basis, confirm: true });
      setProblems(r.problems);
      toast("success", `В очереди: ${r.queued}. Письма будут уходить автоматически.`);
      onDone();
      if (!r.problems.length) onClose();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  const days = Math.ceil(ready / Math.max(c.dailyLimit, 1));
  return (
    <Modal open={open} onClose={onClose} title="Одобрить и запустить кампанию">
      <div className="space-y-3 text-sm">
        <p>
          Будет отправлено <b>{ready}</b> писем: по одному каждые {c.intervalMin} мин, с {c.windowStart}:00 до {c.windowEnd}:00, не больше {c.dailyLimit} в день (≈ {days} дн.).
        </p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>Перед каждым письмом заново проверяются список запрета, «Не связываться» и статус адреса.</li>
          <li>Если клиент ответил или попросил не писать — дальнейшие письма ему не уходят, отказ попадает в список запрета.</li>
          <li>В каждое письмо добавляется строка «ответьте „Отписаться“» и заголовок List-Unsubscribe.</li>
          <li>Кампанию можно поставить на паузу в любой момент.</li>
        </ul>
        <Notice tone="warn">
          Реклама по email без согласия получателя ограничена законом (в РФ — ст. 18 ФЗ «О рекламе», в ЕС — ePrivacy/GDPR). Пишите только на общие деловые адреса компаний с персональным предложением, а не массовую рекламу; учитывайте законы страны получателя.
        </Notice>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          Я просмотрел(а) письма и референсы
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={basis} onChange={(e) => setBasis(e.target.checked)} />
          Адреса — опубликованные деловые контакты компаний, и у меня есть основание для B2B-обращения (будет записано как «законный интерес» со ссылкой на источник, на 180 дней)
        </label>
        <InlineError text={err} />
        {problems.length > 0 && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">
            <p className="mb-1 font-medium text-warn">Не поставлены в очередь:</p>
            <ul className="list-disc pl-4">
              {problems.map((p, i) => (
                <li key={i}>
                  {p.company}: {p.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon={<Rocket className="h-4 w-4" />} loading={busy} disabledReason={basis && reviewed ? undefined : "Подтвердите оба пункта"} onClick={approve}>
            Запустить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

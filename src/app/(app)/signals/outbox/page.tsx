"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ExternalLink, Save, Send, Sparkles, Wand2, X } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, Modal, Notice, Select, SkeletonBlock, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { SignalsHeader, TempBadge } from "@/components/signals/shared";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";

type Item = {
  id: string;
  status: "prepared" | "queued" | "sending" | "failed" | "sent";
  body: string;
  error: string;
  target: string;
  outboundId: string | null;
  sentAt: string | null;
  updatedAt: string;
  lead: { id: string; displayName: string; score: number; temperature: string; profileUrl: string; signals: { title: string; url: string; text: string }[] };
};
type Data = {
  items: Item[];
  usage: { sent24h: number; lastAt: string | null; limit: number; intervalMin: number };
  quota: { used: number; total: number } | null;
  connected: boolean;
  queued: number;
  remainingToday: number;
  nextAt: string | null;
};
type Bulk = { results: { leadId: string; name: string; status: string; reason?: string }[]; usedAI: boolean };

const STATUS: Record<Item["status"], { label: string; tone: "neutral" | "info" | "ok" | "danger" }> = {
  prepared: { label: "Ждёт одобрения", tone: "neutral" },
  queued: { label: "В очереди", tone: "info" },
  sending: { label: "Отправляется", tone: "info" },
  failed: { label: "Ошибка", tone: "danger" },
  sent: { label: "Опубликовано", tone: "ok" },
};

function Row({ it, selected, onSelect, onChanged }: { it: Item; selected: boolean; onSelect: () => void; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const [text, setText] = useState(it.body);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setText(it.body), [it.body]);
  const chars = [...text.trim()].length;
  const editable = it.status === "prepared" || it.status === "failed";
  const s = it.lead.signals[0];
  async function act(kind: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(kind);
    try {
      await fn();
      toast("success", ok);
      await onChanged();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }
  return (
    <li className="card space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {editable && <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Выбрать ответ для ${it.lead.displayName}`} />}
        <Badge tone={STATUS[it.status].tone}>{STATUS[it.status].label}</Badge>
        <TempBadge t={it.lead.temperature} />
        <Link href={`/signals/leads/${it.lead.id}`} className="font-medium hover:underline">
          {it.lead.displayName}
        </Link>
        <span className="text-xs text-muted">score {it.lead.score}</span>
        {s?.url && (
          <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-text">
            пост <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {s && <p className="line-clamp-2 rounded-lg border border-border bg-surface2 px-2 py-1 text-xs text-muted">«{s.text.slice(0, 300)}»</p>}
      {editable ? (
        <>
          <textarea className="input min-h-20 text-sm" value={text} onChange={(e) => setText(e.target.value)} aria-label="Текст ответа" />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={clsx("text-[11px]", chars > 500 ? "text-danger" : "text-muted")}>{chars}/500</span>
            <div className="flex-1" />
            {text !== it.body && (
              <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={busy === "save"} disabledReason={chars > 500 ? "Больше 500 символов" : undefined} onClick={() => act("save", () => api("PATCH", "/api/signals/outbox", { id: it.id, body: text }), "Сохранено")}>
                Сохранить
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} loading={busy === "cancel"} onClick={() => act("cancel", () => api("POST", `/api/signals/attempts/${it.id}`, { action: "cancel" }), "Отменено")}>
              Отменить
            </Button>
            <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} loading={busy === "queue"} disabledReason={text !== it.body ? "Сначала сохраните правку" : undefined} onClick={() => act("queue", () => api("POST", `/api/signals/attempts/${it.id}`, { action: "queue", confirm: true }), "Одобрено")}>
              Одобрить
            </Button>
            <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} loading={busy === "send"} disabledReason={text !== it.body ? "Сначала сохраните правку" : undefined} onClick={() => confirm("Опубликовать этот ответ в Threads сейчас?") && act("send", () => api("POST", `/api/signals/attempts/${it.id}`, { action: "send", confirm: true }), "Опубликовано")}>
              Сейчас
            </Button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-line text-sm">{it.body}</p>
      )}
      {it.status === "queued" && (
        <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} loading={busy === "cancel"} onClick={() => act("cancel", () => api("POST", `/api/signals/attempts/${it.id}`, { action: "cancel" }), "Снято с очереди")}>
          Снять с очереди
        </Button>
      )}
      {it.error && <p className="text-xs text-danger">{it.error}</p>}
      {it.sentAt && <p className="text-[11px] text-muted">Опубликовано {fmtDate(it.sentAt, true)}</p>}
    </li>
  );
}

export default function OutboxPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Data>("/api/signals/outbox");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState({ temperature: "hot,warm", limit: "20", mode: "ai", variant: "short" });
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkRes, setBulkRes] = useState<Bulk | null>(null);

  useEffect(() => {
    if (!data?.queued) return;
    const t = setInterval(() => void reload(), 15_000);
    return () => clearInterval(t);
  }, [data?.queued, reload]);

  if (loading && !data) return <div className="mx-auto max-w-5xl p-4 sm:p-6"><SkeletonBlock rows={6} /></div>;
  if (error || !data) return <div className="mx-auto max-w-5xl p-4 sm:p-6"><ErrorState error={error} onRetry={reload} /></div>;
  const prepared = data.items.filter((i) => i.status === "prepared" || i.status === "failed");
  const queued = data.items.filter((i) => i.status === "queued" || i.status === "sending");
  const sent = data.items.filter((i) => i.status === "sent").reverse();
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function approveSelected() {
    if (!confirm(`Одобрить ${sel.size} ответ(ов)? Они будут опубликованы в Threads автоматически: не чаще одного раза в ${data!.usage.intervalMin} мин и не больше ${data!.usage.limit} в сутки.`)) return;
    setBusy("approve");
    try {
      const r = await api<{ queued: number; errors: { id: string; message: string }[] }>("POST", "/api/signals/outbox/approve", { ids: [...sel], confirm: true });
      toast(r.errors.length ? "info" : "success", `В очереди: ${r.queued}${r.errors.length ? `, не одобрено: ${r.errors.length} (${r.errors[0].message})` : ""}`);
      setSel(new Set());
      await reload();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function runBulk() {
    setBusy("bulk");
    try {
      const r = await api<Bulk>("POST", "/api/signals/outbox/bulk", { temperature: bulk.temperature.split(","), limit: Number(bulk.limit), mode: bulk.mode, variant: bulk.variant });
      setBulkRes(r);
      await reload();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <SignalsHeader
        title="Исходящие: ответы в Threads"
        text="Система готовит ответы на найденные посты, вы одобряете — дальше они публикуются через официальный Threads API сами, по одному, с паузами и дневным лимитом."
        action={
          <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} disabledReason={data.connected ? undefined : "Сначала подключите Threads"} onClick={() => { setBulkRes(null); setBulkOpen(true); }}>
            Подготовить ответы
          </Button>
        }
      />
      {!data.connected && (
        <Notice tone="warn">
          Threads не подключён. Добавьте токен в <Link href="/settings" className="underline">Настройки → Подключения → Источники «Спроса»: соцсети</Link>. Нужны разрешения threads_basic, threads_keyword_search, threads_content_publish и threads_manage_replies.
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Опубликовано за 24 ч", `${data.usage.sent24h} / ${data.usage.limit}`],
          ["Осталось сегодня", data.remainingToday],
          ["В очереди", data.queued],
          ["Квота Meta", data.quota ? `${data.quota.used} / ${data.quota.total}` : "—"],
        ].map(([k, v]) => (
          <div key={k as string} className="card p-3">
            <p className="text-[11px] text-muted">{k}</p>
            <p className="text-xl font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        Пауза между ответами — {data.usage.intervalMin} мин{data.nextAt ? `, следующий не раньше ${fmtDate(data.nextAt, true)}` : ""}. Одному автору — только один ответ. Перед каждой публикацией заново проверяются Do Not Contact и отказы. Лимиты меняются в «Настройках → Подключения».
      </p>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Ждут одобрения ({prepared.length})</h2>
          {prepared.length > 0 && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSel(sel.size === prepared.length ? new Set() : new Set(prepared.map((i) => i.id)))}>
                {sel.size === prepared.length ? "Снять выбор" : "Выбрать все"}
              </Button>
              <Button size="sm" variant="primary" icon={<Check className="h-3.5 w-3.5" />} loading={busy === "approve"} disabledReason={sel.size ? undefined : "Выберите ответы"} onClick={approveSelected}>
                Одобрить выбранные ({sel.size})
              </Button>
            </>
          )}
        </div>
        {prepared.length ? (
          <ul className="space-y-2">
            {prepared.map((it) => (
              <Row key={it.id} it={it} selected={sel.has(it.id)} onSelect={() => toggle(it.id)} onChanged={reload} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Нет ответов на одобрение" text="Нажмите «Подготовить ответы» — система возьмёт горячие и тёплые лиды из Threads и напишет короткий ответ каждому." />
        )}
      </section>

      {queued.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">В очереди ({queued.length})</h2>
          <ul className="space-y-2">
            {queued.map((it) => (
              <Row key={it.id} it={it} selected={false} onSelect={() => {}} onChanged={reload} />
            ))}
          </ul>
        </section>
      )}

      {sent.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Опубликовано за 7 дней ({sent.length})</h2>
          <ul className="space-y-2">
            {sent.map((it) => (
              <Row key={it.id} it={it} selected={false} onSelect={() => {}} onChanged={reload} />
            ))}
          </ul>
        </section>
      )}

      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Подготовить ответы в Threads">
        {bulkRes ? (
          <div className="space-y-3 text-sm">
            <p>
              Подготовлено: <b>{bulkRes.results.filter((r) => r.status === "prepared").length}</b>, пропущено: {bulkRes.results.filter((r) => r.status === "skipped").length}.{" "}
              {bulkRes.usedAI ? "Тексты написал AI." : "AI недоступен — использованы шаблоны по фактам публикации."}
            </p>
            <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">
              {bulkRes.results.map((r) => (
                <li key={r.leadId}>
                  {r.status === "prepared" ? "✓" : "—"} {r.name}
                  {r.reason && <span className="text-muted"> — {r.reason}</span>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Ничего не отправлено. Проверьте тексты и одобрите их на этой странице.</p>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setBulkOpen(false)}>
                К проверке
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Какие лиды">{(id) => <Select id={id} value={bulk.temperature} onChange={(v) => setBulk({ ...bulk, temperature: v })} options={{ hot: "Только горячие", "hot,warm": "Горячие и тёплые", "hot,warm,potential": "Все с интересом" }} />}</Field>
              <Field label="Сколько, максимум">{(id) => <Select id={id} value={bulk.limit} onChange={(v) => setBulk({ ...bulk, limit: v })} options={{ "5": "5", "10": "10", "20": "20", "50": "50" }} />}</Field>
              <Field label="Тексты">{(id) => <Select id={id} value={bulk.mode} onChange={(v) => setBulk({ ...bulk, mode: v })} options={{ ai: "AI (если доступен)", template: "Шаблон без AI" }} />}</Field>
              <Field label="Вариант">{(id) => <Select id={id} value={bulk.variant} onChange={(v) => setBulk({ ...bulk, variant: v })} options={{ short: "Краткий", friendly: "Дружелюбный", business: "Деловой" }} />}</Field>
            </div>
            <Notice tone="info">Берутся лиды из Threads без прошлых ответов и без отказов. Ответы только готовятся — опубликуются после вашего одобрения.</Notice>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setBulkOpen(false)}>
                Отмена
              </Button>
              <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={busy === "bulk"} onClick={runBulk}>
                Подготовить
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

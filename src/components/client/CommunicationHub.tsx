"use client";
import { useState } from "react";
import { CheckCircle2, CircleOff, Inbox, Mail, MessageCircle, Plug, RefreshCw, Reply, Scale, Send, Trash2, XCircle } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, Notice, SectionTitle, Select, SkeletonBlock, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import { CHANNELS, CONSENT_BASES, DELIVERY_STATUSES } from "@/lib/domain";
import { useClient } from "./context";
import { CHANNEL_CONTACT } from "./studio/constants";
import type { Contact } from "./types";

type ChannelStatus = { channel: keyof typeof CHANNELS; state: "connected" | "not_configured" | "unavailable"; detail: string; setupHint: string; supportsInbound: boolean };
type Item = { id: string; direction: "inbound" | "outbound"; subject: string; body: string; status: keyof typeof DELIVERY_STATUSES; error: string; createdAt: string; sentAt: string | null; approvedAt: string | null };
type Conversation = { id: string; channel: keyof typeof CHANNELS; externalThreadId: string; contact: Contact | null; lastInboundAt: string | null; items: Item[] };
type Consent = {
  id: string;
  basis: keyof typeof CONSENT_BASES;
  note: string;
  sourceUrl: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string;
  contact: Contact | null;
};

const STATUS_TONE: Record<string, "neutral" | "warn" | "info" | "ok" | "danger" | "accent"> = {
  draft: "neutral",
  pending_approval: "warn",
  sending: "info",
  sent: "ok",
  delivered: "ok",
  failed: "danger",
  replied: "accent",
  received: "info",
};

export function CommunicationHub() {
  const { clientId, reloadBundle } = useClient();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ conversations: Conversation[]; channels: ChannelStatus[] }>(`/api/clients/${clientId}/conversations`);
  const [sendItem, setSendItem] = useState<{ item: Item; conv: Conversation } | null>(null);
  const [replyConv, setReplyConv] = useState<Conversation | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function syncTelegram() {
    setSyncing(true);
    try {
      const r = await api<{ received: number; matched: number }>("POST", "/api/channels/telegram/sync");
      toast("success", `Telegram: получено обновлений ${r.received}, сопоставлено с клиентами ${r.matched}`);
      await reload();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setSyncing(false);
    }
  }

  if (loading && !data) return <SkeletonBlock rows={5} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const tg = data!.channels.find((c) => c.channel === "telegram");

  return (
    <div className="space-y-4">
      <ChannelsBar channels={data!.channels} />
      <ConsentsSection />

      <section>
        <SectionTitle
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={syncing} disabledReason={tg?.state === "connected" ? undefined : "Telegram не подключён"} onClick={syncTelegram}>
                Синхронизировать Telegram
              </Button>
              <Button size="sm" icon={<Inbox className="h-3.5 w-3.5" />} onClick={() => setLogOpen(true)}>
                Внести вручную
              </Button>
            </div>
          }
        >
          Переписка
        </SectionTitle>
        {!data!.conversations.length ? (
          <EmptyState title="Переписки пока нет" text="Подготовьте сообщение в AI Message Studio — оно появится здесь со статусом «Ожидает подтверждения»." />
        ) : (
          <div className="space-y-3">
            {data!.conversations.map((conv) => (
              <article key={conv.id} className="card space-y-3 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {conv.channel === "email" ? <Mail className="h-4 w-4 text-muted" /> : <MessageCircle className="h-4 w-4 text-muted" />}
                  <span className="font-medium">{CHANNELS[conv.channel]}</span>
                  <span className="text-sm text-muted">{conv.contact?.value ?? "контакт удалён"}</span>
                  {conv.lastInboundAt && <Badge tone="info">последний ответ {fmtDate(conv.lastInboundAt, true)}</Badge>}
                  {conv.items.some((i) => i.direction === "inbound") && (
                    <Button size="sm" variant="ghost" className="ml-auto" icon={<Reply className="h-3.5 w-3.5" />} onClick={() => setReplyConv(conv)}>
                      Ответить
                    </Button>
                  )}
                </div>
                <ol className="space-y-2">
                  {conv.items.map((it) => (
                    <li key={it.id} className={clsx("rounded-lg border p-2.5 text-sm", it.direction === "inbound" ? "mr-6 border-accent2/30 bg-accent2/5" : "ml-6 border-border/60 bg-surface2/40")}>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span>{it.direction === "inbound" ? "Клиент" : "Мы"}</span>
                        <Badge tone={STATUS_TONE[it.status]}>{DELIVERY_STATUSES[it.status] ?? it.status}</Badge>
                        <span>{fmtDate(it.sentAt ?? it.createdAt, true)}</span>
                      </div>
                      {it.subject && <p className="font-medium">{it.subject}</p>}
                      <p className="whitespace-pre-line">{it.body}</p>
                      {it.status === "failed" && it.error && <InlineError text={`Причина: ${it.error}`} />}
                      {(it.status === "pending_approval" || it.status === "failed") && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={() => setSendItem({ item: it, conv })}>
                            {it.status === "failed" ? "Повторить отправку" : "Подтвердить и отправить"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={async () => {
                              try {
                                await api("DELETE", `/api/outbound/${it.id}`);
                                toast("success", "Отменено");
                                await reload();
                              } catch (e) {
                                toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
                              }
                            }}
                          >
                            Отменить
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        )}
      </section>

      <ConfirmSendModal
        target={sendItem}
        channels={data!.channels}
        onClose={() => setSendItem(null)}
        onDone={async () => {
          setSendItem(null);
          await Promise.all([reload(), reloadBundle()]);
        }}
      />
      <ReplyModal
        conv={replyConv}
        onClose={() => setReplyConv(null)}
        onQueued={async () => {
          setReplyConv(null);
          await reload();
        }}
      />
      <ManualLogModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onSaved={async () => {
          setLogOpen(false);
          await Promise.all([reload(), reloadBundle()]);
        }}
      />
    </div>
  );
}

function ChannelsBar({ channels }: { channels: ChannelStatus[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {channels.map((c) => (
        <div key={c.channel} className="card space-y-1.5 p-3">
          <div className="flex items-center gap-2">
            {c.state === "connected" ? <CheckCircle2 className="h-4 w-4 text-ok" /> : c.state === "unavailable" ? <CircleOff className="h-4 w-4 text-muted" /> : <XCircle className="h-4 w-4 text-warn" />}
            <span className="text-sm font-medium">{CHANNELS[c.channel]}</span>
            <Badge tone={c.state === "connected" ? "ok" : c.state === "unavailable" ? "neutral" : "warn"} className="ml-auto">
              {c.state === "connected" ? "подключён" : c.state === "unavailable" ? "недоступно" : "не подключено"}
            </Badge>
          </div>
          <p className="text-xs text-muted">{c.detail}</p>
          {c.state !== "connected" && <p className="text-[11px] text-muted">{c.setupHint}</p>}
          {c.state === "connected" && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Plug className="h-3.5 w-3.5" />}
              loading={busy === c.channel}
              onClick={async () => {
                setBusy(c.channel);
                try {
                  const r = await api<{ ok: boolean; detail: string }>("POST", `/api/channels/${c.channel}/verify`);
                  toast(r.ok ? "success" : "error", r.detail);
                } catch (e) {
                  toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Проверить подключение
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}

function ConsentsSection() {
  const { clientId, bundle } = useClient();
  const toast = useToast();
  const { data, reload } = useApi<{ consents: Consent[] }>(`/api/clients/${clientId}/consents`);
  const [f, setF] = useState({ basis: "legitimate_interest", contactId: "", note: "", sourceUrl: "", validDays: "" });
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <SectionTitle action={<Button size="sm" icon={<Scale className="h-3.5 w-3.5" />} onClick={() => setOpen((o) => !o)}>{open ? "Скрыть" : "Зафиксировать основание"}</Button>}>
        Правовые основания для обращения
      </SectionTitle>
      {data?.consents.length ? (
        <ul className="space-y-1.5 text-sm">
          {data.consents.map((c) => {
            const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
            const active = !c.revokedAt && !expired;
            return (
              <li key={c.id} className={`flex flex-wrap items-center gap-2 ${active ? "" : "opacity-60"}`}>
                <Badge tone={active ? "ok" : "neutral"}>{CONSENT_BASES[c.basis]}</Badge>
                {c.revokedAt && <Badge tone="danger">Отозвано {fmtDate(c.revokedAt)}</Badge>}
                {expired && !c.revokedAt && <Badge tone="warn">Истекло</Badge>}
                <span className="text-muted">{c.contact ? c.contact.value : "все контакты клиента"}</span>
                <span className="min-w-0 flex-1">
                  {c.note}
                  {c.sourceUrl && (
                    <a className="ml-1 text-accent hover:underline" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                      источник
                    </a>
                  )}
                </span>
                <span className="text-xs text-muted">
                  {fmtDate(c.createdAt)}
                  {c.expiresAt && active ? ` · до ${fmtDate(c.expiresAt)}` : ""}
                </span>
                {active && (
                  <button
                    className="text-muted hover:text-danger"
                    aria-label="Отозвать основание"
                    title="Отозвать (запись останется в журнале)"
                    onClick={async () => {
                      await api("DELETE", `/api/clients/${clientId}/consents?id=${c.id}`).catch(() => {});
                      await reload();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <Notice tone="warn">Основание не зафиксировано — отправка будет заблокирована. Укажите, на каком основании вы обращаетесь (например, опубликованный заказ или деловой адрес для B2B-предложений).</Notice>
      )}
      {open && (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await api("POST", `/api/clients/${clientId}/consents`, {
                basis: f.basis,
                note: f.note,
                sourceUrl: f.sourceUrl,
                contactId: f.contactId || null,
                validDays: f.validDays ? Number(f.validDays) : null,
              });
              toast("success", "Основание зафиксировано");
              setF({ ...f, note: "", sourceUrl: "" });
              setOpen(false);
              await reload();
            } catch (e) {
              setErr(e instanceof ApiClientError ? e.message : "Ошибка");
            }
          }}
        >
          <Field label="Основание">{(id) => <Select id={id} value={f.basis} onChange={(v) => setF({ ...f, basis: v })} options={CONSENT_BASES} />}</Field>
          <Field label="Контакт">
            {(id) => <Select id={id} value={f.contactId} onChange={(v) => setF({ ...f, contactId: v })} options={[{ value: "", label: "Все контакты" }, ...bundle.client.contacts.map((c) => ({ value: c.id, label: c.value }))]} />}
          </Field>
          <Field label="Обоснование *">{(id) => <input id={id} className="input" required minLength={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Например: заказ опубликован на бирже 10.11" />}</Field>
          <Button type="submit" variant="primary">
            Сохранить
          </Button>
          <Field label="Ссылка на источник">{(id) => <input id={id} className="input" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} placeholder="https://… (где опубликован контакт)" />}</Field>
          <Field label="Срок действия, дней">{(id) => <input id={id} className="input" inputMode="numeric" value={f.validDays} onChange={(e) => setF({ ...f, validDays: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="бессрочно" />}</Field>
          <div className="sm:col-span-4">
            <InlineError text={err} />
          </div>
        </form>
      )}
      <p className="mt-2 text-[11px] text-muted">Учитывайте 152-ФЗ, GDPR, правила прямого маркетинга и законодательство страны получателя. Отправка из карточки подтверждается вручную; пакетная отправка — только через одобренную кампанию с лимитами.</p>
    </section>
  );
}

function ConfirmSendModal({ target, channels, onClose, onDone }: { target: { item: Item; conv: Conversation } | null; channels: ChannelStatus[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  if (!target) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const ch = channels.find((c) => c.channel === target.conv.channel);
  const connected = ch?.state === "connected";
  return (
    <Modal open onClose={onClose} title="Подтверждение отправки" wide>
      <div className="space-y-3">
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 text-muted">Канал</dt>
            <dd>{CHANNELS[target.conv.channel]}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 text-muted">Получатель</dt>
            <dd className="break-all">{target.conv.contact?.value}</dd>
          </div>
        </dl>
        {target.item.subject && <p className="text-sm font-medium">Тема: {target.item.subject}</p>}
        <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface2/50 p-3 font-sans text-sm">{target.item.body}</pre>
        {!connected && <Notice tone="warn">{ch ? `${ch.detail}. ${ch.setupHint}` : "Канал не подключён"}</Notice>}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          Я проверил текст, получателя и основание для обращения. Отправка выполняется от моего имени.
        </label>
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            icon={<Send className="h-4 w-4" />}
            loading={busy}
            disabledReason={!connected ? "Канал не подключён" : !checked ? "Подтвердите проверку" : undefined}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                // Ключ идемпотентности защищает от двойной отправки при повторном клике/сбое сети
                const r = await api<{ item: Item }>("POST", `/api/outbound/${target.item.id}/send`, { confirm: true, idempotencyKey: crypto.randomUUID() });
                if (r.item.status === "failed") setErr(`Не отправлено: ${r.item.error}. Черновик сохранён — устраните причину и повторите.`);
                else {
                  toast("success", "Сообщение отправлено");
                  setChecked(false);
                  onDone();
                }
              } catch (e) {
                setErr(e instanceof ApiClientError ? e.message : "Ошибка отправки");
              } finally {
                setBusy(false);
              }
            }}
          >
            Отправить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ReplyModal({ conv, onClose, onQueued }: { conv: Conversation | null; onClose: () => void; onQueued: () => void }) {
  const { clientId, bundle } = useClient();
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!conv) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  return (
    <Modal open onClose={onClose} title={`Ответ · ${CHANNELS[conv.channel]}`} wide>
      <div className="space-y-3">
        <Button
          size="sm"
          loading={busy === "ai"}
          disabledReason={bundle.ai.configured ? undefined : "AI не подключён"}
          onClick={async () => {
            setBusy("ai");
            setErr(null);
            try {
              const r = await api<{ draft: { subject: string; body: string; assumptions: string[]; suggestedNextStep: string } }>("POST", `/api/clients/${clientId}/conversations/${conv.id}/reply-draft`);
              setSubject(r.draft.subject);
              setBody(r.draft.body);
              setNotes([...r.draft.assumptions.map((a) => `Предположение: ${a}`), r.draft.suggestedNextStep && `Следующий шаг: ${r.draft.suggestedNextStep}`].filter(Boolean) as string[]);
            } catch (e) {
              setErr(e instanceof ApiClientError ? e.message : "Ошибка");
            } finally {
              setBusy(null);
            }
          }}
        >
          Подготовить ответ с AI
        </Button>
        {conv.channel === "email" && <Field label="Тема">{(id) => <input id={id} className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>}
        <Field label="Текст ответа">{(id) => <textarea id={id} rows={8} className="input" value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        {notes.length > 0 && (
          <ul className="space-y-1 text-xs text-warn">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={busy === "queue"}
            disabledReason={body.trim() ? undefined : "Введите текст"}
            onClick={async () => {
              setBusy("queue");
              setErr(null);
              try {
                await api("POST", `/api/clients/${clientId}/conversations/${conv.id}/outbound`, { subject, body });
                toast("success", "Ответ ожидает подтверждения отправки");
                setBody("");
                setSubject("");
                setNotes([]);
                onQueued();
              } catch (e) {
                if (e instanceof ApiClientError && e.code === "compliance_blocked")
                  setErr((e.details as { issues: { message: string; blocking: boolean }[] }).issues.filter((i) => i.blocking).map((i) => i.message).join(" "));
                else setErr(e instanceof ApiClientError ? e.message : "Ошибка");
              } finally {
                setBusy(null);
              }
            }}
          >
            Подготовить к отправке
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ManualLogModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { clientId, bundle } = useClient();
  const toast = useToast();
  const [f, setF] = useState({ channel: "email", direction: "inbound", contactId: "", body: "", subject: "" });
  const [err, setErr] = useState<string | null>(null);
  const contacts = bundle.client.contacts.filter((c) => CHANNEL_CONTACT[f.channel]?.includes(c.type));
  return (
    <Modal open={open} onClose={onClose} title="Внести сообщение вручную">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await api("POST", `/api/clients/${clientId}/conversations`, f);
            toast("success", "Сохранено");
            setF({ ...f, body: "", subject: "" });
            onSaved();
          } catch (e) {
            setErr(e instanceof ApiClientError ? e.message : "Ошибка");
          }
        }}
      >
        <p className="text-xs text-muted">Для каналов без API входящих (email, WhatsApp, LinkedIn) внесите ответ клиента или отметьте сообщение, отправленное вручную. Ответ «отписаться» автоматически внесёт контакт в список запрета.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Канал">{(id) => <Select id={id} value={f.channel} onChange={(v) => setF({ ...f, channel: v, contactId: "" })} options={CHANNELS} />}</Field>
          <Field label="Направление">{(id) => <Select id={id} value={f.direction} onChange={(v) => setF({ ...f, direction: v })} options={{ inbound: "Ответ клиента (входящее)", outbound: "Отправлено мной вручную" }} />}</Field>
        </div>
        <Field label="Контакт">
          {(id) => (
            <Select id={id} value={f.contactId} onChange={(v) => setF({ ...f, contactId: v })} options={[{ value: "", label: contacts.length ? "Выберите контакт" : "Нет контактов этого типа" }, ...contacts.map((c) => ({ value: c.id, label: c.value }))]} />
          )}
        </Field>
        <Field label="Текст *">{(id) => <textarea id={id} rows={5} className="input" required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" disabledReason={f.contactId ? undefined : "Выберите контакт"}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

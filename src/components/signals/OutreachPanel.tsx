"use client";
import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, ExternalLink, Languages, Mail, Minimize2, RefreshCw, Save, Send, Smile, Sparkles, Briefcase, Wand2, X } from "lucide-react";
import { Badge, Button, Field, InlineError, Modal, Notice, Select, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";

export type Draft = { id: string; generationId: string; variant: string; language: string; subject: string; body: string; evidence: string[] | null; warnings: string[] | null; origin: string; status: string; version: number; createdAt: string };
export type Attempt = { id: string; mode: string; channel: string; target: string; subject: string; body: string; status: string; outcome: string; error: string; preparedAt: string; openedAt: string | null; sentAt: string | null; repliedAt: string | null };
type Issue = { code: string; message: string; blocking: boolean };
type Option = { mode: "api" | "open_dialog" | "platform_reply"; channel: string; label: string; target: string; available: boolean; reason: string; issues: Issue[] };

const ORDER = ["friendly", "business", "short", "manual"];
const VARIANT_LABEL: Record<string, string> = { friendly: "Дружелюбное", business: "Деловое", short: "Краткое", manual: "Своё" };
const ATTEMPT: Record<string, { label: string; tone: "info" | "ok" | "warn" | "danger" | "neutral" }> = {
  prepared: { label: "Подготовлено (не отправлено)", tone: "neutral" },
  opened: { label: "Диалог открыт — ждём подтверждения", tone: "info" },
  confirmed_sent: { label: "Отправлено вручную (подтверждено вами)", tone: "ok" },
  sent: { label: "Отправлено через официальный канал", tone: "ok" },
  failed: { label: "Ошибка отправки", tone: "danger" },
  queued: { label: "Одобрено — в очереди автоотправки", tone: "info" },
  sending: { label: "Отправляется…", tone: "info" },
  cancelled: { label: "Отменено", tone: "neutral" },
};
const OUTCOME: Record<string, string> = { none: "", replied: "Ответил", positive: "Положительный ответ", negative: "Отказ", no_response: "Нет ответа" };
const LANGS: Record<string, string> = { ru: "Русский", en: "English", de: "Deutsch", fr: "Français", es: "Español" };

export function OutreachPanel({ leadId, drafts, attempts, ai, profileFilled, blocked, onChange }: { leadId: string; drafts: Draft[]; attempts: Attempt[]; ai: boolean; profileFilled: boolean; blocked: string | null; onChange: () => Promise<unknown> }) {
  const toast = useToast();
  const latestGen = drafts[0]?.generationId;
  const current = useMemo(() => drafts.filter((d) => d.generationId === latestGen || d.status === "saved").sort((a, b) => ORDER.indexOf(a.variant) - ORDER.indexOf(b.variant)), [drafts, latestGen]);
  const [sel, setSel] = useState<string | null>(null);
  const draft = current.find((d) => d.id === sel) ?? current[0];
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [lang, setLang] = useState("ru");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data: opts, reload: reloadOpts } = useApi<{ options: Option[] }>(`/api/signals/leads/${leadId}/attempts`);
  const [mode, setMode] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ attempt: Attempt; issues: Issue[] } | null>(null);

  useEffect(() => {
    if (draft) {
      setSubject(draft.subject);
      setBody(draft.body);
      setLang(draft.language);
    }
  }, [draft?.id, draft?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mode && opts?.options.length) {
      const o = opts.options.find((x) => x.available && x.channel === "threads" && x.mode === "api") ?? opts.options.find((x) => x.available && x.mode !== "api") ?? opts.options.find((x) => x.available) ?? opts.options[0];
      setMode(`${o.mode}:${o.channel}`);
    }
  }, [opts, mode]);
  const option = opts?.options.find((o) => `${o.mode}:${o.channel}` === mode);
  const isThreadsApi = option?.mode === "api" && option.channel === "threads";
  const chars = [...body.trim()].length;
  const dirty = draft && (draft.body !== body || draft.subject !== subject);

  async function run(kind: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(kind);
    setErr(null);
    try {
      await fn();
      if (ok) toast("success", ok);
      await onChange();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message + (e.details && typeof e.details === "object" && "issues" in e.details ? ": " + (e.details as { issues: Issue[] }).issues.filter((i) => i.blocking).map((i) => i.message).join("; ") : "") : "Ошибка";
      setErr(msg);
    } finally {
      setBusy(null);
    }
  }

  const generate = (m: "ai" | "template") => run(`gen-${m}`, () => api("POST", `/api/signals/leads/${leadId}/drafts`, { mode: m, language: lang, instructions: instructions || undefined }), "Варианты подготовлены");
  const rewrite = (op: string, language?: string) =>
    run(op, async () => {
      if (dirty) await api("PATCH", `/api/signals/drafts/${draft!.id}`, { subject, body });
      await api("POST", `/api/signals/drafts/${draft!.id}`, { op, language });
    });
  const save = () => run("save", () => api("PATCH", `/api/signals/drafts/${draft!.id}`, { subject, body }), "Сохранено");

  async function prepare() {
    if (!mode) return;
    setBusy("prepare");
    setErr(null);
    try {
      const r = await api<{ attempt: Attempt; issues: Issue[] }>("POST", `/api/signals/leads/${leadId}/attempts`, { mode: option?.mode, channel: option?.channel, draftId: draft?.id, subject, body });
      setPreview(r);
      await onChange();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message + (e.details && typeof e.details === "object" && "issues" in e.details ? ": " + (e.details as { issues: Issue[] }).issues.filter((i) => i.blocking).map((i) => i.message).join("; ") : "") : "Ошибка";
      setErr(msg);
    } finally {
      setBusy(null);
    }
  }

  async function openDialog(a: Attempt) {
    try {
      await navigator.clipboard.writeText(a.subject && a.mode === "api" ? `${a.subject}\n\n${a.body}` : a.body);
      toast("success", "Текст скопирован — вставьте его в открывшемся окне");
    } catch {
      toast("info", "Скопируйте текст вручную");
    }
    window.open(a.target, "_blank", "noopener,noreferrer");
    await api("POST", `/api/signals/attempts/${a.id}`, { action: "open" }).catch(() => {});
    await onChange();
  }

  const attemptAct = (a: Attempt, payload: Record<string, unknown>, ok: string) =>
    run(`att-${a.id}`, async () => {
      await api("POST", `/api/signals/attempts/${a.id}`, payload);
      setPreview(null);
      await reloadOpts();
    }, ok);

  return (
    <div id="outreach" className="space-y-3">
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Персональное обращение</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <Select className="h-8 w-32 text-xs" value={lang} onChange={setLang} options={LANGS} />
            <Button size="sm" variant="primary" icon={<Sparkles className="h-3.5 w-3.5" />} loading={busy === "gen-ai"} disabledReason={ai ? undefined : "AI не подключён — используйте шаблон"} onClick={() => generate("ai")}>
              {drafts.length ? "Сгенерировать заново" : "Сгенерировать (AI)"}
            </Button>
            <Button size="sm" icon={<Wand2 className="h-3.5 w-3.5" />} loading={busy === "gen-template"} onClick={() => generate("template")}>
              Шаблон без AI
            </Button>
          </div>
        </div>
        {!profileFilled && <Notice tone="warn">Заполните профиль исполнителя в «Настройках» (специализация, портфолио) — без него сообщения не смогут рассказать о вас, а AI ничего не придумывает.</Notice>}
        {blocked && <Notice tone="danger">{blocked}</Notice>}
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted">Дополнительные указания для AI</summary>
          <textarea className="input mt-1 min-h-16" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Например: упомяни, что могу начать на этой неделе" maxLength={1000} />
        </details>

        {current.length ? (
          <>
            <div className="flex flex-wrap gap-1" role="tablist">
              {current.map((d) => (
                <button key={d.id} role="tab" aria-selected={draft?.id === d.id} onClick={() => setSel(d.id)} className={clsx("rounded-lg px-2.5 py-1 text-sm", draft?.id === d.id ? "bg-accent/15 ring-1 ring-accent/30" : "text-muted hover:bg-surface2")}>
                  {VARIANT_LABEL[d.variant] ?? d.variant}
                  {d.status === "saved" && <span className="ml-1 text-[10px] text-ok">●</span>}
                </button>
              ))}
            </div>
            {draft && (
              <div className="space-y-2">
                {option?.mode === "api" && option.channel === "email" && <Field label="Тема письма">{(id) => <input id={id} className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>}
                <textarea className="input min-h-44 font-[inherit] leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Текст сообщения" />
                {isThreadsApi && <p className={clsx("text-right text-[11px]", chars > 500 ? "text-danger" : "text-muted")}>{chars}/500 символов (лимит Threads)</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={busy === "save"} disabled={!dirty} onClick={save}>
                    Сохранить
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Smile className="h-3.5 w-3.5" />} loading={busy === "friendlier"} disabledReason={ai ? undefined : "Нужен AI"} onClick={() => rewrite("friendlier")}>
                    Дружелюбнее
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Briefcase className="h-3.5 w-3.5" />} loading={busy === "formal"} disabledReason={ai ? undefined : "Нужен AI"} onClick={() => rewrite("formal")}>
                    Деловее
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Minimize2 className="h-3.5 w-3.5" />} loading={busy === "shorter"} disabledReason={ai ? undefined : "Нужен AI"} onClick={() => rewrite("shorter")}>
                    Короче
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Languages className="h-3.5 w-3.5" />} loading={busy === "translate"} disabledReason={ai ? (lang === draft.language ? "Выберите другой язык в списке сверху" : undefined) : "Нужен AI"} onClick={() => rewrite("translate", lang)}>
                    Перевести на {LANGS[lang]}
                  </Button>
                  <span className="ml-auto text-[11px] text-muted">
                    {draft.origin === "ai" ? "AI" : draft.origin === "template" ? "шаблон" : "изменено"} · v{draft.version}
                  </span>
                </div>
                {draft.evidence?.length ? <p className="text-[11px] text-muted">Опирается на: {draft.evidence.join(" · ")}</p> : null}
                {draft.warnings?.map((w) => (
                  <p key={w} className="text-[11px] text-warn">
                    ⚠ {w}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Сгенерируйте три варианта (дружелюбный, деловой, краткий) — они ссылаются только на реальный текст публикации и ваш профиль.</p>
        )}
        <InlineError text={err} />
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="font-semibold">Способ связи</h3>
        <div className="space-y-1.5">
          {(opts?.options ?? []).map((o) => {
            const blocking = o.issues.filter((i) => i.blocking);
            return (
              <label key={`${o.mode}:${o.channel}`} className={clsx("flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm", mode === `${o.mode}:${o.channel}` ? "border-accent/60 bg-accent/5" : "border-border", (!o.available || blocking.length) && "opacity-60")}>
                <input type="radio" name="mode" className="mt-1" checked={mode === `${o.mode}:${o.channel}`} onChange={() => setMode(`${o.mode}:${o.channel}`)} disabled={!o.available} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {o.mode === "api" ? <Mail className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    {o.label}
                    <Badge>{o.mode === "api" ? (o.channel === "threads" ? "Threads API" : "официальная отправка") : o.mode === "platform_reply" ? "механизм площадки" : "ручная отправка"}</Badge>
                  </span>
                  <span className="block text-xs text-muted">{o.reason}</span>
                  {o.issues.map((i) => (
                    <span key={i.code} className={clsx("block text-xs", i.blocking ? "text-danger" : "text-warn")}>
                      {i.blocking ? "⛔" : "⚠"} {i.message}
                    </span>
                  ))}
                </span>
              </label>
            );
          })}
        </div>
        <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={busy === "prepare"} disabledReason={!draft ? "Сначала подготовьте текст" : !option?.available ? "Способ недоступен" : isThreadsApi && chars > 500 ? "Сократите текст до 500 символов" : option.issues.some((i) => i.blocking) ? "Заблокировано проверками" : undefined} onClick={prepare}>
          Проверить и подготовить
        </Button>
      </div>

      {attempts.length > 0 && (
        <div className="card space-y-2 p-4">
          <h3 className="font-semibold">История обращений</h3>
          <ul className="space-y-2">
            {attempts.map((a) => (
              <li key={a.id} className="rounded-lg border border-border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={ATTEMPT[a.status]?.tone ?? "neutral"}>{ATTEMPT[a.status]?.label ?? a.status}</Badge>
                  {a.outcome !== "none" && <Badge tone={a.outcome === "positive" ? "ok" : a.outcome === "negative" ? "danger" : "info"}>{OUTCOME[a.outcome]}</Badge>}
                  <span className="text-xs text-muted">
                    {a.mode === "api" ? (a.channel === "threads" ? "Threads API" : `Email → ${a.target}`) : a.channel} · подготовлено {fmtDate(a.preparedAt, true)}
                    {a.sentAt && ` · отправлено ${fmtDate(a.sentAt, true)}`}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-muted">{a.body}</p>
                {a.error && <p className="text-xs text-danger">{a.error}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {["prepared", "opened", "failed", "queued"].includes(a.status) && (
                    <>
                      <Button size="sm" variant="primary" onClick={() => setPreview({ attempt: a, issues: [] })}>
                        Продолжить
                      </Button>
                      <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => attemptAct(a, { action: "cancel" }, "Отменено")}>
                        Отменить
                      </Button>
                    </>
                  )}
                  {["confirmed_sent", "sent"].includes(a.status) &&
                    (["replied", "positive", "negative", "no_response"] as const).map((o) => (
                      <Button key={o} size="sm" variant={a.outcome === o ? "secondary" : "ghost"} loading={busy === `att-${a.id}`} onClick={() => (o !== "negative" || confirm("Отметить отказ? Человек будет внесён в Do Not Contact, повторные обращения станут невозможны.")) && attemptAct(a, { action: "outcome", outcome: o }, "Результат сохранён")}>
                        {OUTCOME[o]}
                      </Button>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title="Предварительный просмотр и подтверждение">
        {preview && (
          <div className="space-y-3">
            <p className="text-sm">
              {preview.attempt.mode === "api" && preview.attempt.channel === "threads" ? (
                <>
                  Ответ будет опубликован <b>под вашим профилем Threads</b> через официальный API под постом автора. Перед отправкой повторно проверяются Do Not Contact, отказ и «один ответ одному автору»; соблюдаются дневной лимит и пауза между ответами.
                </>
              ) : preview.attempt.mode === "api" ? (
                <>
                  Email будет отправлен на <b>{preview.attempt.target}</b> через ваш SMTP (центр коммуникаций CRM) с повторной проверкой ограничений.
                </>
              ) : (
                <>
                  Сообщение <b>не отправляется автоматически</b>. Нажмите «Скопировать и открыть» — откроется {preview.attempt.mode === "platform_reply" ? "страница заказа, где можно откликнуться штатным механизмом площадки" : "публикация/профиль автора"}. Отправьте текст сами и вернитесь, чтобы подтвердить.
                </>
              )}
            </p>
            {preview.issues.filter((i) => !i.blocking).map((i) => (
              <Notice key={i.code} tone="warn">
                {i.message}
              </Notice>
            ))}
            <div className="max-h-60 overflow-y-auto whitespace-pre-line rounded-lg border border-border bg-surface2/50 p-3 text-sm">
              {preview.attempt.subject && preview.attempt.mode === "api" && <p className="mb-2 font-medium">Тема: {preview.attempt.subject}</p>}
              {preview.attempt.body}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {preview.attempt.mode === "api" && preview.attempt.channel === "threads" ? (
                <>
                  <Button loading={busy === `att-${preview.attempt.id}`} onClick={() => attemptAct(preview.attempt, { action: "queue", confirm: true }, "Одобрено — уйдёт автоматически с учётом лимитов")}>
                    В очередь автоотправки
                  </Button>
                  <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={busy === `att-${preview.attempt.id}`} onClick={() => attemptAct(preview.attempt, { action: "send", confirm: true }, "Ответ опубликован в Threads")}>
                    Опубликовать сейчас
                  </Button>
                </>
              ) : preview.attempt.mode === "api" ? (
                <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={busy === `att-${preview.attempt.id}`} onClick={() => attemptAct(preview.attempt, { action: "send", confirm: true, idempotencyKey: `signal:${preview.attempt.id}` }, "Письмо отправлено")}>
                  Подтвердить и отправить
                </Button>
              ) : (
                <>
                  <Button icon={<ClipboardCopy className="h-4 w-4" />} onClick={() => openDialog(preview.attempt)}>
                    Скопировать и открыть
                  </Button>
                  <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={busy === `att-${preview.attempt.id}`} onClick={() => attemptAct(preview.attempt, { action: "confirm", confirm: true }, "Отправка подтверждена")}>
                    Я отправил(а) сообщение
                  </Button>
                </>
              )}
            </div>
            <p className="text-[11px] text-muted">
              <RefreshCw className="mr-1 inline h-3 w-3" />
              Отправленным считается только подтверждённое сообщение. Прочтение не отслеживается — площадки его не подтверждают.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

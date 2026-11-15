"use client";
import { useEffect, useState } from "react";
import { Download, FileCode2, FolderOpen, Mail, RefreshCw, ScanSearch, Send, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, Notice, SectionTitle, Select, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { AuditView } from "@/components/discovery/AuditView";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import type { ReferenceConcept } from "@/lib/ai/schemas";
import { useClient } from "./context";
import { AINotConfigured } from "./AINotConfigured";

type Ref = {
  id: string;
  title: string;
  concept: ReferenceConcept;
  emailSubject: string;
  emailBody: string;
  model: string;
  status: "draft" | "approved";
  createdAt: string;
  hasPrototype: boolean;
};
const IMPACT: Record<string, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  high: { label: "высокий эффект", tone: "ok" },
  medium: { label: "средний эффект", tone: "warn" },
  low: { label: "небольшой эффект", tone: "neutral" },
};

export function ReferencePanel() {
  const { clientId, bundle, reloadBundle } = useClient();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ references: Ref[] }>(`/api/clients/${clientId}/references`);
  const [auditing, setAuditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [selected, setSelected] = useState("");
  const audit = bundle.client.siteAudit;

  async function runAudit() {
    setAuditing(true);
    try {
      const r = await api<{ emailsAdded: number; fetchError: string | null }>("POST", `/api/clients/${clientId}/site-audit`);
      toast(r.fetchError ? "error" : "success", r.fetchError ? `Сайт не загрузился: ${r.fetchError}` : `Аудит готов${r.emailsAdded ? `, найдено email: ${r.emailsAdded}` : ""}`);
      await reloadBundle();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка аудита");
    } finally {
      setAuditing(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setGenError(null);
    try {
      const r = await api<{ reference: Ref }>("POST", `/api/clients/${clientId}/references`, { instructions });
      toast("success", "Референс готов");
      setSelected(r.reference.id);
      await reload();
    } catch (e) {
      setGenError(e instanceof ApiClientError ? e.message : "Ошибка генерации");
    } finally {
      setGenerating(false);
    }
  }

  const refs = data?.references ?? [];
  const current = refs.find((r) => r.id === selected) ?? refs[0];

  return (
    <div className="space-y-4">
      <section className="card">
        <SectionTitle
          action={
            <Button size="sm" icon={<ScanSearch className="h-3.5 w-3.5" />} loading={auditing} onClick={runAudit}>
              {audit ? "Проверить заново" : "Проверить сайт"}
            </Button>
          }
        >
          Что можно улучшить
        </SectionTitle>
        {audit ? (
          <AuditView audit={audit} />
        ) : (
          <p className="text-sm text-muted">
            {bundle.client.website
              ? "Сайт ещё не проверялся. Аудит найдёт проблемы (мобильная версия, HTTPS, скорость, меню, онлайн-запись и т.д.) и опубликованные на сайте email."
              : "Сайт не указан — аудит отметит это как главную возможность (сайт с нуля). Нажмите «Проверить сайт»."}
          </p>
        )}
      </section>

      <section className="card">
        <SectionTitle>Референс для клиента</SectionTitle>
        <p className="mb-3 text-sm text-muted">
          AI готовит концепцию улучшений на основе аудита и профиля исполнителя (Настройки), письмо от вашего имени и, по кнопке, HTML-прототип главной страницы. PDF с концепцией прикладывается к письму.
        </p>
        {!bundle.ai.configured && <AINotConfigured />}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Пожелания (необязательно)" className="flex-1">
            {(id) => (
              <input id={id} className="input" value={instructions} maxLength={1500} onChange={(e) => setInstructions(e.target.value)} placeholder="Например: акцент на онлайн-меню и доставку, тон дружелюбный" />
            )}
          </Field>
          <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} loading={generating} disabledReason={bundle.ai.configured ? undefined : "AI не подключён"} onClick={generate}>
            {refs.length ? "Новый вариант" : "Сгенерировать референс"}
          </Button>
        </div>
        {generating && <p className="mt-2 text-xs text-muted">Генерация занимает 30–90 секунд…</p>}
        <InlineError text={genError} />
        {!audit && refs.length === 0 && bundle.ai.configured && <Notice tone="info">Совет: сначала проверьте сайт — без аудита концепция будет общей.</Notice>}
      </section>

      {loading && !data ? (
        <SkeletonBlock rows={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !current ? (
        <EmptyState title="Референсов пока нет" text="Сгенерируйте первый вариант — он появится здесь." />
      ) : (
        <>
          {refs.length > 1 && (
            <Select
              value={current.id}
              onChange={setSelected}
              options={refs.map((r) => ({ value: r.id, label: `${fmtDate(r.createdAt)} — ${r.title}` }))}
              className="sm:w-96"
            />
          )}
          <ReferenceView key={current.id} r={current} onChanged={reload} />
        </>
      )}
      <WorkspaceSection />
    </div>
  );
}

function ReferenceView({ r, onChanged }: { r: Ref; onChanged: () => void }) {
  const { bundle } = useClient();
  const toast = useToast();
  const c = r.concept;
  const [subject, setSubject] = useState(r.emailSubject);
  const [body, setBody] = useState(r.emailBody);
  const [saving, setSaving] = useState(false);
  const [proto, setProto] = useState<string | null>(null);
  const [protoBusy, setProtoBusy] = useState(false);
  const [protoErr, setProtoErr] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const dirty = subject !== r.emailSubject || body !== r.emailBody;

  useEffect(() => {
    if (!r.hasPrototype) return;
    let alive = true;
    api<{ reference: { html: string } }>("GET", `/api/references/${r.id}`)
      .then((d) => alive && setProto(d.reference.html))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [r.id, r.hasPrototype]);

  async function save() {
    setSaving(true);
    try {
      await api("PATCH", `/api/references/${r.id}`, { emailSubject: subject, emailBody: body });
      toast("success", "Письмо сохранено");
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }
  async function makePrototype() {
    setProtoBusy(true);
    setProtoErr(null);
    try {
      const d = await api<{ reference: { html: string } }>("POST", `/api/references/${r.id}/prototype`);
      setProto(d.reference.html);
      toast("success", "HTML-прототип готов");
      onChanged();
    } catch (e) {
      setProtoErr(e instanceof ApiClientError ? e.message : "Ошибка генерации прототипа");
    } finally {
      setProtoBusy(false);
    }
  }
  async function remove() {
    if (!confirm("Удалить этот референс?")) return;
    await api("DELETE", `/api/references/${r.id}`).catch(() => {});
    onChanged();
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{c.title}</h3>
            <p className="text-xs text-muted">
              {fmtDate(r.createdAt)} · {r.model}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface2/70 px-2.5 text-xs font-medium hover:border-accent/60" href={`/api/references/${r.id}/file?format=pdf`}>
              <Download className="h-3.5 w-3.5" /> PDF
            </a>
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={remove} aria-label="Удалить референс" />
          </div>
        </div>
        <p className="text-sm">{c.diagnosis}</p>

        {c.problems.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">Что заметили</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {c.problems.map((p, i) => (
                <li key={i}>
                  <span className="font-medium">{p.title}</span> <span className="text-muted">— {p.evidence}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="mb-1 text-sm font-medium">Что предлагаем</p>
          <ol className="space-y-2">
            {c.improvements.map((i, n) => (
              <li key={n} className="rounded-lg border border-border/70 bg-surface2/40 p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {n + 1}. {i.title}
                  </span>
                  <Badge tone={IMPACT[i.impact]?.tone ?? "neutral"}>{IMPACT[i.impact]?.label ?? i.impact}</Badge>
                </div>
                <p className="text-muted">{i.why}</p>
                <p className="text-xs">Как: {i.how}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium">Структура</p>
            <ul className="space-y-1 text-sm">
              {c.structure.map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{s.section}</span> <span className="text-muted">— {s.purpose}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Стиль</p>
            <p className="text-sm text-muted">
              {c.style.mood}. {c.style.typography}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {c.style.palette.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 text-xs">
                  <span className="h-5 w-5 rounded border border-border" style={{ background: /^#[0-9a-f]{6}$/i.test(p.hex) ? p.hex : "transparent" }} />
                  {p.name}
                </span>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-border p-3">
              <p className="font-semibold">{c.copy.heroTitle}</p>
              <p className="text-sm text-muted">{c.copy.heroSubtitle}</p>
              <span className="mt-2 inline-block rounded-md bg-accent/20 px-2 py-1 text-xs text-accent">{c.copy.cta}</span>
            </div>
          </div>
        </div>
        {c.assumptions.length > 0 && <p className="text-xs text-muted">Допущения: {c.assumptions.join("; ")}</p>}
      </section>

      <section className="card space-y-3">
        <SectionTitle
          action={
            <div className="flex gap-1.5">
              {proto && (
                <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface2/70 px-2.5 text-xs font-medium hover:border-accent/60" href={`/api/references/${r.id}/file?format=html`}>
                  <Download className="h-3.5 w-3.5" /> HTML
                </a>
              )}
              <Button size="sm" icon={proto ? <RefreshCw className="h-3.5 w-3.5" /> : <FileCode2 className="h-3.5 w-3.5" />} loading={protoBusy} disabledReason={bundle.ai.configured ? undefined : "AI не подключён"} onClick={makePrototype}>
                {proto ? "Пересоздать" : "Сделать HTML-прототип"}
              </Button>
            </div>
          }
        >
          Прототип главной страницы
        </SectionTitle>
        {protoBusy && <p className="text-xs text-muted">Вёрстка прототипа занимает 1–4 минуты…</p>}
        <InlineError text={protoErr} />
        {proto ? (
          // sandbox без allow-scripts: прототип не может выполнить код или обратиться к приложению
          <iframe title="HTML-прототип" sandbox="" srcDoc={proto} className="h-[560px] w-full rounded-lg border border-border bg-white" />
        ) : (
          <p className="text-sm text-muted">Прототип — наглядный «как могло бы быть» по концепции. Можно приложить к письму HTML-файлом или использовать как отправную точку проекта.</p>
        )}
      </section>

      <section className="card space-y-3">
        <SectionTitle
          action={
            <Button size="sm" variant="primary" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => setSendOpen(true)}>
              Подготовить письмо
            </Button>
          }
        >
          Письмо клиенту
        </SectionTitle>
        <Field label="Тема">{(id) => <input id={id} className="input" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Текст" hint="Строка об отказе от писем добавится автоматически">
          {(id) => <textarea id={id} className="input min-h-[180px]" value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <Button size="sm" loading={saving} disabledReason={dirty ? undefined : "Нет изменений"} onClick={save}>
          Сохранить текст
        </Button>
      </section>
      <SendModal open={sendOpen} onClose={() => setSendOpen(false)} r={r} subject={subject} body={body} hasPrototype={Boolean(proto)} />
    </div>
  );
}

function SendModal({ open, onClose, r, subject, body, hasPrototype }: { open: boolean; onClose: () => void; r: Ref; subject: string; body: string; hasPrototype: boolean }) {
  const { bundle, goTab, reloadBundle } = useClient();
  const toast = useToast();
  const emails = bundle.client.contacts.filter((c) => c.type === "email" && !c.doNotContact && c.verificationStatus !== "invalid");
  const [contactId, setContactId] = useState(emails[0]?.id ?? "");
  const [pdf, setPdf] = useState(true);
  const [html, setHtml] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  async function submit() {
    setBusy(true);
    setErr(null);
    setIssues([]);
    try {
      await api("POST", `/api/references/${r.id}/queue`, { contactId, subject, body, attachPdf: pdf, attachHtml: html });
      toast("success", "Письмо подготовлено — подтвердите отправку в «Переписке»");
      onClose();
      await reloadBundle();
      goTab("conversations");
    } catch (e) {
      if (e instanceof ApiClientError) {
        setErr(e.message);
        const d = e.details as { issues?: { message: string }[] } | undefined;
        if (d?.issues) setIssues(d.issues.map((i) => i.message));
      } else setErr("Ошибка");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Письмо с референсом">
      {emails.length === 0 ? (
        <Notice tone="warn">У клиента нет пригодного email. Добавьте его во вкладке «Контакты» или запустите аудит сайта — он ищет опубликованные адреса.</Notice>
      ) : (
        <div className="space-y-3">
          <Field label="Получатель">{(id) => <Select id={id} value={contactId} onChange={setContactId} options={emails.map((e) => ({ value: e.id, label: `${e.value} (${e.verificationStatus})` }))} />}</Field>
          <p className="text-sm">
            <span className="text-muted">Тема:</span> {subject || "—"}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} /> Приложить PDF с концепцией
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={html} disabled={!hasPrototype} onChange={(e) => setHtml(e.target.checked)} /> Приложить HTML-прототип {!hasPrototype && <span className="text-xs text-muted">(не создан)</span>}
          </label>
          <p className="text-xs text-muted">Письмо попадёт в «Переписку» со статусом «Ожидает подтверждения». Перед подготовкой проверяются список запрета, «Не связываться» и правовое основание.</p>
          <InlineError text={err} />
          {issues.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-danger">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Отмена</Button>
            <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={busy} disabledReason={contactId && subject.trim() && body.trim() ? undefined : "Заполните тему и текст"} onClick={submit}>
              Подготовить
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function WorkspaceSection() {
  const { clientId, bundle, reloadBundle } = useClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ path: string; command: string } | null>(bundle.client.workspacePath ? { path: bundle.client.workspacePath, command: `cd "${bundle.client.workspacePath}" && claude` } : null);
  async function create() {
    setBusy(true);
    try {
      const r = await api<{ path: string; command: string }>("POST", `/api/clients/${clientId}/workspace`);
      setRes(r);
      toast("success", "Рабочий проект создан");
      await reloadBundle();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  const agreed = ["negotiating", "won"].includes(bundle.client.status);
  return (
    <section className="card space-y-2">
      <SectionTitle
        action={
          <Button size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />} loading={busy} onClick={create}>
            {res ? "Обновить файлы" : "Создать рабочий проект"}
          </Button>
        }
      >
        Клиент согласился — работа над проектом
      </SectionTitle>
      <p className="text-sm text-muted">
        Создаёт папку проекта с брифом, концепцией, прототипом и файлом CLAUDE.md. Откройте её в Claude Code — и продолжайте делать сайт уже в отдельной сессии с полным контекстом.
        {!agreed && " Обычно это делают, когда статус клиента — «Переписка/Переговоры» или «Сделка»."}
      </p>
      {res && (
        <div className="space-y-1.5 rounded-lg border border-border bg-surface2/40 p-2.5 text-sm">
          <p className="break-all">
            <span className="text-muted">Папка:</span> {res.path}
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-bg px-2 py-1 text-xs">{res.command}</code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(res.command).then(() => toast("success", "Команда скопирована"));
              }}
            >
              Копировать
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

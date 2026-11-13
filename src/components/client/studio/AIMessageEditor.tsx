"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, History, Languages, Link2, Paperclip, PenLine, Save, Send, Signature, Tag, Wand2 } from "lucide-react";
import { Badge, Button, Field, InlineError, Modal, Notice, SectionTitle, Select, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import { CHANNELS, LANGUAGES, REWRITE_COMMANDS, TONES, type RewriteCommand } from "@/lib/domain";
import { useClient } from "../context";
import type { AIMessage } from "../types";
import { AIPersonalizationEvidence } from "./AIPersonalizationEvidence";
import { CHANNEL_CONTACT } from "./constants";

type Profile = { signature: string; website: string; portfolioUrl: string; pricingNotes: string } | null;
type Version = { id: string; version: number; subject: string; body: string; origin: string; note: string; createdAt: string };

const ORIGIN: Record<string, string> = { generated: "сгенерировано", edited: "правка", rewrite: "AI-правка", restore: "восстановление" };
const QUICK: RewriteCommand[] = ["shorten", "expand", "naturalize", "simplify", "more_expert", "regenerate"];

export function AIMessageEditor({ message, onUpdated, onReload }: { message: AIMessage; onUpdated: (m: AIMessage) => void; onReload: () => void }) {
  const { clientId, bundle, goTab } = useClient();
  const toast = useToast();
  const draftKey = `lh-msg-draft:${message.id}`;
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [restoredLocal, setRestoredLocal] = useState(false);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tone, setTone] = useState<keyof typeof TONES>((message.tone as keyof typeof TONES) || "business_friendly");
  const [lang, setLang] = useState("en");
  const [modal, setModal] = useState<null | "versions" | "template" | "send" | "price">(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const { data: prof } = useApi<{ profile: Profile }>("/api/profile");
  const profile = prof?.profile ?? null;
  const dirty = body !== message.body || subject !== message.subject;

  // Восстановление несохранённого локального черновика (переживает перезагрузку и сбои)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { body: string; subject: string; baseVersion: number };
        if (d.baseVersion === message.version && (d.body !== message.body || d.subject !== message.subject)) {
          setBody(d.body);
          setSubject(d.subject);
          setRestoredLocal(true);
        }
      }
    } catch {
      /* недоступно */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(draftKey, JSON.stringify({ body, subject, baseVersion: message.version }));
      else localStorage.removeItem(draftKey);
    } catch {
      /* недоступно */
    }
  }, [body, subject, dirty, draftKey, message.version]);

  const trackSel = () => {
    const el = ta.current;
    if (!el) return;
    setSel(el.selectionEnd > el.selectionStart ? { start: el.selectionStart, end: el.selectionEnd } : null);
  };

  async function rewrite(command: RewriteCommand) {
    setBusy(command);
    setErr(null);
    try {
      const r = await api<{ message: AIMessage; note: string; replaced: { start: number; end: number } | null }>(
        "POST",
        `/api/clients/${clientId}/ai/messages/${message.id}/rewrite`,
        { command, body, subject, selection: sel, tone, targetLanguage: lang },
      );
      setBody(r.message.body);
      setSubject(r.message.subject);
      onUpdated(r.message);
      toast("success", `${REWRITE_COMMANDS[command]}${sel ? " (фрагмент)" : ""}: готово`);
      if (r.replaced)
        requestAnimationFrame(() => {
          ta.current?.focus();
          ta.current?.setSelectionRange(r.replaced!.start, r.replaced!.end);
        });
      setSel(null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? `${e.message} Ваш текст не изменён.` : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function save(status?: "saved") {
    setBusy("save");
    setErr(null);
    try {
      const r = await api<{ message: AIMessage }>("PATCH", `/api/messages/${message.id}`, { body, subject, ...(status ? { status } : {}) });
      onUpdated(r.message);
      toast("success", dirty ? `Сохранено как версия ${r.message.version}` : "Черновик сохранён в карточке");
      setRestoredLocal(false);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(null);
    }
  }

  function insert(text: string) {
    const el = ta.current;
    const pos = el ? el.selectionEnd : body.length;
    const next = body.slice(0, pos) + text + body.slice(pos);
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + text.length, pos + text.length);
    });
  }

  const aiOff = bundle.ai.configured ? undefined : "AI не подключён";
  const sent = message.status === "sent" || message.status === "queued";

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="card space-y-3">
        <SectionTitle
          action={
            <div className="flex items-center gap-2">
              {dirty && <Badge tone="warn">есть несохранённые изменения</Badge>}
              <Badge>v{message.version}</Badge>
            </div>
          }
        >
          Редактор · {CHANNELS[message.channel as keyof typeof CHANNELS] ?? message.channel}
        </SectionTitle>
        {restoredLocal && <Notice tone="info">Восстановлен несохранённый локальный черновик.</Notice>}
        {sent && <Notice tone="warn">Это сообщение уже подготовлено к отправке или отправлено. Правки создадут новую версию, но не изменят отправленное.</Notice>}
        {message.channel === "email" && (
          <Field label="Тема письма">{(id) => <input id={id} className="input" value={subject} maxLength={500} onChange={(e) => setSubject(e.target.value)} />}</Field>
        )}
        <div>
          <label htmlFor="msg-body" className="label">
            Текст {sel ? <span className="text-accent">— выделено {sel.end - sel.start} симв.: команды применятся к фрагменту</span> : <span>— команды применяются ко всему тексту (выделите фрагмент для точечной правки)</span>}
          </label>
          <textarea
            id="msg-body"
            ref={ta}
            className="input min-h-[260px] font-[450] leading-relaxed"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onSelect={trackSel}
            onKeyUp={trackSel}
            onMouseUp={trackSel}
          />
          <p className="mt-1 text-right text-[11px] text-muted">{body.length} симв.</p>
        </div>

        <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="AI-команды">
          {QUICK.map((c) => (
            <Button key={c} size="sm" icon={<Wand2 className="h-3.5 w-3.5" />} loading={busy === c} disabledReason={aiOff ?? (busy ? "Выполняется другая команда" : undefined)} onClick={() => rewrite(c)}>
              {REWRITE_COMMANDS[c]}
            </Button>
          ))}
          <div className="flex items-center gap-1">
            <Select value={tone} onChange={setTone} options={TONES} className="h-8 w-auto py-0 text-xs" />
            <Button size="sm" icon={<PenLine className="h-3.5 w-3.5" />} loading={busy === "change_tone"} disabledReason={aiOff ?? (busy ? "Выполняется другая команда" : undefined)} onClick={() => rewrite("change_tone")}>
              Изменить тон
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Select value={lang} onChange={setLang} options={Object.fromEntries(Object.entries(LANGUAGES).filter(([k]) => k !== "auto"))} className="h-8 w-auto py-0 text-xs" />
            <Button size="sm" icon={<Languages className="h-3.5 w-3.5" />} loading={busy === "translate"} disabledReason={aiOff ?? (busy ? "Выполняется другая команда" : undefined)} onClick={() => rewrite("translate")}>
              Перевести
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
          <Button size="sm" variant="ghost" icon={<Signature className="h-3.5 w-3.5" />} disabledReason={profile?.signature ? undefined : "Подпись не задана в Настройках"} onClick={() => insert(`\n\n${profile!.signature}`)}>
            Подпись
          </Button>
          <Button size="sm" variant="ghost" icon={<Link2 className="h-3.5 w-3.5" />} disabledReason={profile?.website ? undefined : "Сайт не указан в профиле"} onClick={() => insert(` ${profile!.website} `)}>
            Ссылка на сайт
          </Button>
          <Button size="sm" variant="ghost" icon={<Link2 className="h-3.5 w-3.5" />} disabledReason={profile?.portfolioUrl ? undefined : "Портфолио не указано в профиле"} onClick={() => insert(` ${profile!.portfolioUrl} `)}>
            Портфолио
          </Button>
          <Button size="sm" variant="ghost" icon={<Tag className="h-3.5 w-3.5" />} onClick={() => setModal("price")}>
            Стоимость
          </Button>
          <Button size="sm" variant="ghost" icon={<Paperclip className="h-3.5 w-3.5" />} disabledReason="Вложения пока не поддерживаются адаптерами отправки — добавьте ссылку на файл">
            Вложение
          </Button>
        </div>

        <InlineError text={err} />
        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={busy === "save"} disabledReason={!dirty && message.status !== "draft" ? "Нет изменений" : undefined} onClick={() => save(message.status === "draft" ? "saved" : undefined)}>
            {dirty ? "Сохранить версию" : "Сохранить черновик"}
          </Button>
          <Button
            icon={<Copy className="h-4 w-4" />}
            onClick={() =>
              navigator.clipboard.writeText(message.channel === "email" && subject ? `${subject}\n\n${body}` : body).then(
                () => toast("success", "Текст скопирован"),
                () => toast("error", "Буфер обмена недоступен"),
              )
            }
          >
            Копировать
          </Button>
          <Button icon={<History className="h-4 w-4" />} onClick={() => setModal("versions")}>
            Версии
          </Button>
          <Button icon={<Save className="h-4 w-4" />} onClick={() => setModal("template")}>
            Как шаблон
          </Button>
          <Button
            variant="primary"
            className="sm:ml-auto"
            icon={<Send className="h-4 w-4" />}
            disabledReason={dirty ? "Сначала сохраните изменения" : message.channel === "linkedin" ? "LinkedIn: скопируйте текст и отправьте вручную, затем отметьте во вкладке «Переписка»" : undefined}
            onClick={() => setModal("send")}
          >
            Подготовить к отправке
          </Button>
        </div>
      </section>

      <AIPersonalizationEvidence message={message} />

      <VersionsModal
        open={modal === "versions"}
        message={message}
        current={body}
        onClose={() => setModal(null)}
        onRestored={(m) => {
          setBody(m.body);
          setSubject(m.subject);
          onUpdated(m);
          setModal(null);
        }}
      />
      <TemplateModal open={modal === "template"} message={message} onClose={() => setModal(null)} />
      <PriceModal open={modal === "price"} pricingNotes={profile?.pricingNotes ?? ""} onClose={() => setModal(null)} onInsert={(t) => (insert(t), setModal(null))} />
      <PrepareSendModal
        open={modal === "send"}
        message={message}
        onClose={() => setModal(null)}
        onQueued={() => {
          setModal(null);
          onReload();
          goTab("conversations");
        }}
      />
    </div>
  );
}

function VersionsModal({ open, message, current, onClose, onRestored }: { open: boolean; message: AIMessage; current: string; onClose: () => void; onRestored: (m: AIMessage) => void }) {
  const toast = useToast();
  const { data, reload } = useApi<{ message: { versions: Version[] } }>(open ? `/api/messages/${message.id}` : null);
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    if (open) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, message.version]);
  const versions = data?.message.versions ?? [];
  const shown = versions.find((v) => v.version === view) ?? versions[0];
  return (
    <Modal open={open} onClose={onClose} title="Версии сообщения" wide>
      <div className="grid gap-3 md:grid-cols-[200px_1fr]">
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {versions.map((v) => (
            <li key={v.id}>
              <button onClick={() => setView(v.version)} className={clsx("w-full rounded-lg px-2 py-1.5 text-left text-xs", shown?.version === v.version ? "bg-accent/15" : "hover:bg-surface2")}>
                <span className="font-medium">v{v.version}</span> · {ORIGIN[v.origin] ?? v.origin}
                <br />
                <span className="text-muted">{fmtDate(v.createdAt, true)}</span>
              </button>
            </li>
          ))}
        </ul>
        {shown && (
          <div className="space-y-2">
            {shown.note && <p className="text-xs text-muted">{shown.note}</p>}
            {shown.subject && <p className="text-sm font-medium">Тема: {shown.subject}</p>}
            <div className="grid gap-2 lg:grid-cols-2">
              <div>
                <p className="label">v{shown.version}</p>
                <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface2/50 p-2 font-sans text-sm">{shown.body}</pre>
              </div>
              <div>
                <p className="label">Сейчас в редакторе</p>
                <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface2/50 p-2 font-sans text-sm">{current}</pre>
              </div>
            </div>
            <Button
              disabledReason={shown.version === message.version ? "Это текущая версия" : undefined}
              onClick={async () => {
                try {
                  const r = await api<{ message: AIMessage }>("POST", `/api/messages/${message.id}/restore`, { version: shown.version });
                  toast("success", `Восстановлена версия ${shown.version}`);
                  onRestored(r.message);
                } catch (e) {
                  toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
                }
              }}
            >
              Восстановить эту версию
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function TemplateModal({ open, message, onClose }: { open: boolean; message: AIMessage; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Сохранить как шаблон">
      <div className="space-y-3">
        <p className="text-xs text-muted">Будет сохранена последняя сохранённая версия. Название компании заменится переменной {"{{company}}"}.</p>
        <Field label="Название шаблона *">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Категория">{(id) => <input id={id} className="input" value={category} onChange={(e) => setCategory(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabledReason={name.trim() ? undefined : "Введите название"}
            onClick={async () => {
              setSaving(true);
              try {
                await api("POST", `/api/messages/${message.id}/template`, { name, category });
                toast("success", "Шаблон сохранён");
                onClose();
              } catch (e) {
                toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
              } finally {
                setSaving(false);
              }
            }}
          >
            Сохранить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PriceModal({ open, pricingNotes, onClose, onInsert }: { open: boolean; pricingNotes: string; onClose: () => void; onInsert: (t: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Добавить стоимость">
      <div className="space-y-3">
        <Notice tone="info">Стоимость добавляется только из ваших данных — ИИ не придумывает цены.</Notice>
        {pricingNotes && (
          <div>
            <p className="label">Из профиля исполнителя</p>
            <button className="w-full rounded-lg border border-border p-2 text-left text-sm hover:border-accent" onClick={() => setText(pricingNotes)}>
              {pricingNotes}
            </button>
          </div>
        )}
        <Field label="Текст о стоимости">{(id) => <textarea id={id} rows={3} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: стоимость разработки лендинга — от 60 000 ₽" />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" disabledReason={text.trim() ? undefined : "Введите текст"} onClick={() => onInsert(`\n\n${text.trim()}`)}>
            Вставить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PrepareSendModal({ open, message, onClose, onQueued }: { open: boolean; message: AIMessage; onClose: () => void; onQueued: () => void }) {
  const { bundle } = useClient();
  const toast = useToast();
  const contacts = bundle.client.contacts.filter((c) => CHANNEL_CONTACT[message.channel]?.includes(c.type));
  const [contactId, setContactId] = useState(message.contactId ?? contacts[0]?.id ?? "");
  const [issues, setIssues] = useState<{ message: string; blocking: boolean }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setIssues([]);
      setErr(null);
    }
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Подготовка к отправке">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Будут выполнены проверки: список запрета, отметка «Не связываться», правовое основание, статус контакта. После подготовки отправку нужно подтвердить вручную во вкладке «Переписка».
        </p>
        <Field label="Получатель">
          {(id) => (
            <Select
              id={id}
              value={contactId}
              onChange={setContactId}
              options={contacts.length ? contacts.map((c) => ({ value: c.id, label: `${c.value}${c.doNotContact ? " (запрет)" : ""}` })) : [{ value: "", label: "Нет подходящих контактов" }]}
            />
          )}
        </Field>
        {issues.length > 0 && (
          <ul className="space-y-1 text-xs">
            {issues.map((i, k) => (
              <li key={k} className={i.blocking ? "text-danger" : "text-warn"}>
                {i.blocking ? "⛔" : "⚠"} {i.message}
              </li>
            ))}
          </ul>
        )}
        {issues.some((i) => i.message.includes("правовое основание")) && (
          <Notice tone="info">Зафиксируйте основание для обращения во вкладке «Переписка» → «Правовые основания».</Notice>
        )}
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabledReason={contactId ? undefined : "Добавьте контакт для этого канала"}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              setIssues([]);
              try {
                const r = await api<{ warnings: { message: string; blocking: boolean }[] }>("POST", `/api/messages/${message.id}/approve`, { contactId });
                toast("success", "Сообщение ожидает подтверждения отправки");
                if (r.warnings.length) toast("info", r.warnings.map((w) => w.message).join(" "));
                onQueued();
              } catch (e) {
                if (e instanceof ApiClientError && e.code === "compliance_blocked") {
                  setIssues((e.details as { issues: { message: string; blocking: boolean }[] }).issues);
                  setErr("Отправка заблокирована проверками");
                } else setErr(e instanceof ApiClientError ? e.message : "Ошибка");
              } finally {
                setBusy(false);
              }
            }}
          >
            Подготовить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

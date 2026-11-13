"use client";
import { useMemo, useState } from "react";
import { FilePlus2, LayoutTemplate, Sparkles } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, Notice, SectionTitle, Select, SkeletonBlock, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate, useApi, useLocalDraft } from "@/lib/client-api";
import { CHANNELS, GOALS, LANGUAGES, LENGTHS, SERVICES, TONES } from "@/lib/domain";
import { useClient } from "../context";
import { AINotConfigured } from "../AINotConfigured";
import type { AIMessage } from "../types";
import { AIMessageVariants } from "./AIMessageVariants";
import { AIMessageEditor } from "./AIMessageEditor";

export type StudioParams = {
  channel: keyof typeof CHANNELS;
  service: keyof typeof SERVICES;
  customService: string;
  tone: keyof typeof TONES;
  goal: keyof typeof GOALS;
  length: keyof typeof LENGTHS;
  language: keyof typeof LANGUAGES;
  instructions: string;
  contactId: string;
};

const DEFAULTS: StudioParams = {
  channel: "email",
  service: "website",
  customService: "",
  tone: "business_friendly",
  goal: "start_dialog",
  length: "medium",
  language: "auto",
  instructions: "",
  contactId: "",
};

import { CHANNEL_CONTACT } from "./constants";

export function AIMessageStudio() {
  const { clientId, bundle } = useClient();
  const toast = useToast();
  // Параметры и инструкции хранятся локально — не теряются при ошибке AI и перезагрузке
  const [p, setP] = useLocalDraft<StudioParams>(`lh-studio-params:${clientId}`, DEFAULTS);
  const { data, error, loading, reload, setData } = useApi<{ messages: AIMessage[] }>(`/api/clients/${clientId}/messages`);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [activeGen, setActiveGen] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const contacts = bundle.client.contacts.filter((c) => CHANNEL_CONTACT[p.channel]?.includes(c.type));
  const messages = useMemo(() => data?.messages ?? [], [data]);
  const generations = useMemo(() => {
    const m = new Map<string, AIMessage[]>();
    for (const x of messages) m.set(x.generationId, [...(m.get(x.generationId) ?? []), x]);
    return [...m.entries()].map(([id, items]) => ({ id, items: items.sort((a, b) => order(a.variantKey) - order(b.variantKey)), createdAt: items[0].createdAt }));
  }, [messages]);
  const currentGen = generations.find((g) => g.id === activeGen) ?? generations[0];
  const editing = messages.find((m) => m.id === editingId) ?? null;

  async function generate() {
    setGenerating(true);
    setGenError(null);
    try {
      const r = await api<{ generationId: string; messages: AIMessage[] }>("POST", `/api/clients/${clientId}/ai/messages/generate`, {
        ...p,
        customService: p.service === "custom" ? p.customService : undefined,
        contactId: p.contactId || null,
      });
      setData((d) => ({ messages: [...r.messages, ...(d?.messages ?? [])] }));
      setActiveGen(r.generationId);
      setEditingId(null);
      toast("success", "Готово: три варианта сообщения");
    } catch (e) {
      setGenError(e instanceof ApiClientError ? e.message : "Ошибка генерации");
    } finally {
      setGenerating(false);
    }
  }

  const onUpdated = (m: AIMessage) => setData((d) => ({ messages: (d?.messages ?? []).map((x) => (x.id === m.id ? { ...x, ...m } : x)) }));

  return (
    <div className="space-y-4">
      {!bundle.ai.configured && <AINotConfigured />}
      {bundle.client.doNotContact && <Notice tone="danger">Клиент отмечен «Не связываться» — сообщения можно готовить, но отправка будет заблокирована.</Notice>}

      <section className="card">
        <SectionTitle>Параметры обращения</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Канал">{(id) => <Select id={id} value={p.channel} onChange={(v) => setP({ ...p, channel: v, contactId: "" })} options={CHANNELS} />}</Field>
          <Field label="Получатель" hint={contacts.length ? undefined : "Нет контактов этого типа"}>
            {(id) => (
              <Select
                id={id}
                value={p.contactId}
                onChange={(v) => setP({ ...p, contactId: v })}
                options={[{ value: "", label: contacts.length ? "Выбрать позже" : "—" }, ...contacts.map((c) => ({ value: c.id, label: c.value }))]}
              />
            )}
          </Field>
          <Field label="Услуга">{(id) => <Select id={id} value={p.service} onChange={(v) => setP({ ...p, service: v })} options={SERVICES} />}</Field>
          {p.service === "custom" ? (
            <Field label="Какая услуга">{(id) => <input id={id} className="input" value={p.customService} maxLength={300} onChange={(e) => setP({ ...p, customService: e.target.value })} />}</Field>
          ) : (
            <Field label="Тон">{(id) => <Select id={id} value={p.tone} onChange={(v) => setP({ ...p, tone: v })} options={TONES} />}</Field>
          )}
          {p.service === "custom" && <Field label="Тон">{(id) => <Select id={id} value={p.tone} onChange={(v) => setP({ ...p, tone: v })} options={TONES} />}</Field>}
          <Field label="Цель">{(id) => <Select id={id} value={p.goal} onChange={(v) => setP({ ...p, goal: v })} options={GOALS} />}</Field>
          <Field label="Длина">{(id) => <Select id={id} value={p.length} onChange={(v) => setP({ ...p, length: v })} options={LENGTHS} />}</Field>
          <Field label="Язык">{(id) => <Select id={id} value={p.language} onChange={(v) => setP({ ...p, language: v })} options={LANGUAGES} />}</Field>
          <Field label="Дополнительные инструкции" className="sm:col-span-2 xl:col-span-4" hint="Ограничения, акценты, стиль: «без скидок», «упомянуть портфолио», «на вы».">
            {(id) => <textarea id={id} rows={2} maxLength={2000} className="input" value={p.instructions} onChange={(e) => setP({ ...p, instructions: e.target.value })} />}
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={generating} icon={<Sparkles className="h-4 w-4" />} disabledReason={bundle.ai.configured ? undefined : "AI не подключён"} onClick={generate}>
            Сгенерировать 3 варианта
          </Button>
          <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setManualOpen(true)}>
            Вручную / из шаблона
          </Button>
          {generating && <span className="text-xs text-muted">Модель готовит варианты с учётом источников…</span>}
        </div>
        {genError && (
          <div className="mt-3 space-y-2">
            <InlineError text={`${genError} Параметры и инструкции сохранены.`} />
            <Button size="sm" onClick={generate} disabledReason={bundle.ai.configured ? undefined : "AI не подключён"}>
              Повторить
            </Button>
          </div>
        )}
      </section>

      {loading && !data ? (
        <SkeletonBlock rows={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !generations.length ? (
        <EmptyState title="Сообщений пока нет" text="Задайте параметры и сгенерируйте три варианта или создайте сообщение вручную." />
      ) : (
        <>
          {generations.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Генерации:</span>
              {generations.slice(0, 8).map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    setActiveGen(g.id);
                    setEditingId(null);
                  }}
                  className={clsx("rounded-full border px-2.5 py-1", g.id === currentGen?.id ? "border-accent bg-accent/15" : "border-border text-muted hover:text-text")}
                >
                  {fmtDate(g.createdAt, true)} · {CHANNELS[g.items[0].channel as keyof typeof CHANNELS] ?? g.items[0].channel}
                  {g.items.some((i) => i.status === "sent") && " ✓"}
                </button>
              ))}
            </div>
          )}
          {currentGen && <AIMessageVariants items={currentGen.items} selectedId={editingId} onSelect={setEditingId} />}
          {editing ? (
            <AIMessageEditor key={editing.id} message={editing} onUpdated={onUpdated} onReload={reload} />
          ) : (
            <p className="text-center text-sm text-muted">Выберите вариант, чтобы отредактировать, сохранить и подготовить к отправке.</p>
          )}
        </>
      )}
      <ManualMessageModal
        open={manualOpen}
        channel={p.channel}
        onClose={() => setManualOpen(false)}
        onCreated={(m) => {
          setManualOpen(false);
          setData((d) => ({ messages: [m, ...(d?.messages ?? [])] }));
          setActiveGen(m.generationId);
          setEditingId(m.id);
        }}
      />
    </div>
  );
}

const order = (k: string) => ({ recommended: 0, short: 1, expert: 2 })[k] ?? 3;

function ManualMessageModal({ open, onClose, onCreated, channel }: { open: boolean; onClose: () => void; onCreated: (m: AIMessage) => void; channel: string }) {
  const { clientId } = useClient();
  const { data } = useApi<{ items: { id: string; name: string; channel: string; category: string }[] }>(open ? "/api/templates" : null);
  const [ch, setCh] = useState(channel);
  const [templateId, setTemplateId] = useState("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Новое сообщение" wide>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Канал">{(id) => <Select id={id} value={ch} onChange={setCh} options={CHANNELS} />}</Field>
          <Field label="Шаблон" hint="Переменные {{company}}, {{city}}, {{website}}, {{industry}} подставятся автоматически.">
            {(id) => (
              <Select
                id={id}
                value={templateId}
                onChange={setTemplateId}
                options={[{ value: "", label: data?.items.length ? "Без шаблона" : "Шаблонов нет" }, ...(data?.items ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.channel})` }))]}
              />
            )}
          </Field>
        </div>
        {!templateId && (
          <>
            {ch === "email" && <Field label="Тема">{(id) => <input id={id} className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>}
            <Field label="Текст">{(id) => <textarea id={id} rows={8} className="input" value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
          </>
        )}
        {templateId && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <LayoutTemplate className="h-4 w-4" /> Текст будет взят из шаблона, затем его можно отредактировать.
          </p>
        )}
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              setErr(null);
              try {
                const r = await api<{ message: AIMessage }>("POST", `/api/clients/${clientId}/messages`, { channel: ch, subject, body, templateId: templateId || undefined });
                onCreated(r.message);
                setBody("");
                setSubject("");
                setTemplateId("");
              } catch (e) {
                setErr(e instanceof ApiClientError ? e.message : "Ошибка");
              } finally {
                setSaving(false);
              }
            }}
          >
            Создать
          </Button>
        </div>
        <Badge className="w-fit">Без AI — сообщение не содержит автоматической персонализации</Badge>
      </div>
    </Modal>
  );
}

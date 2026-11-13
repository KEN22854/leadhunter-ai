"use client";
import { useState } from "react";
import { StickyNote } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Select, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import { useClient } from "./context";

// Подписи типов событий (синхронно с INTERACTION_TYPES на сервере)
const TYPES: Record<string, string> = {
  lead_discovered: "Лид обнаружен",
  client_updated: "Профиль",
  status_changed: "Статус",
  contact_added: "Контакт",
  contact_updated: "Контакт",
  contact_verified: "Проверка контакта",
  source_added: "Источник",
  data_checked: "Проверка данных",
  analysis_created: "AI-анализ",
  score_changed: "Lead Score",
  message_generated: "Генерация",
  message_edited: "Редактирование",
  message_queued: "К отправке",
  message_sent: "Отправка",
  message_failed: "Ошибка отправки",
  reply_received: "Ответ",
  proposal_created: "КП",
  proposal_updated: "КП",
  task_created: "Задача",
  task_updated: "Задача",
  note: "Заметка",
  suppression: "Запрет",
  consent: "Основание",
};
const tone = (t: string) =>
  t.includes("failed") || t === "suppression" ? "danger" : t.includes("sent") || t === "reply_received" ? "ok" : t.startsWith("analysis") || t.startsWith("message_gen") ? "accent" : "neutral";

type Event = { id: string; type: string; summary: string; actorLabel: string; createdAt: string };

export function ClientTimeline() {
  const { clientId } = useClient();
  const toast = useToast();
  const [type, setType] = useState("");
  const { data, error, loading, reload } = useApi<{ events: Event[] }>(`/api/clients/${clientId}/timeline${type ? `?type=${type}` : ""}`);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-3">
      <form
        className="card flex flex-col gap-2 p-3 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!note.trim()) return;
          setSaving(true);
          try {
            await api("POST", `/api/clients/${clientId}/timeline`, { text: note });
            setNote("");
            await reload();
          } catch (e) {
            toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
          } finally {
            setSaving(false);
          }
        }}
      >
        <input className="input flex-1" placeholder="Заметка по клиенту…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Заметка" />
        <Button type="submit" icon={<StickyNote className="h-4 w-4" />} loading={saving} disabledReason={note.trim() ? undefined : "Введите текст"}>
          Добавить заметку
        </Button>
        <Select value={type} onChange={setType} options={[{ value: "", label: "Все события" }, ...Object.entries(TYPES).map(([value, label]) => ({ value, label: `${label} (${value})` }))]} className="sm:w-56" />
      </form>
      {loading && !data ? (
        <SkeletonBlock rows={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data!.events.length ? (
        <EmptyState title="Событий нет" />
      ) : (
        <ol className="relative space-y-3 border-l border-border/70 pl-5">
          {data!.events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-bg" aria-hidden />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <time dateTime={e.createdAt}>{fmtDate(e.createdAt, true)}</time>
                <Badge tone={tone(e.type)}>{TYPES[e.type] ?? e.type}</Badge>
                <span>{e.actorLabel}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-sm">{e.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

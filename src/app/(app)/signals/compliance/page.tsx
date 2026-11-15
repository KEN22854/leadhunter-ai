"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, ErrorState, Field, InlineError, Notice, Select, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { SignalsHeader } from "@/components/signals/shared";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";

type Entry = { id: string; value: string; type: string; reason: string; createdAt: string };
type LogRow = { id: string; leadId: string | null; subject: string; action: string; basis: string; sourceUrl: string; note: string; createdAt: string };

const TYPES = { email: "Email", domain: "Домен", phone: "Телефон", telegram: "Telegram", profile: "Профиль (URL)", other: "Другое" };
const ACTION: Record<string, string> = { collected: "Сбор", merged: "Объединение", contacted: "Обращение", converted: "В CRM", opted_out: "Запрет", deleted: "Удаление" };
const BASIS: Record<string, string> = { published_request: "Опубликованный запрос", legitimate_interest: "Законный интерес", consent: "Согласие", user_request: "Решение пользователя" };

export default function CompliancePage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ items: Entry[] }>("/api/suppression");
  const [action, setAction] = useState("");
  const { data: log } = useApi<{ items: LogRow[] }>(`/api/signals/log${action ? `?action=${action}` : ""}`);
  const [f, setF] = useState({ type: "email", value: "", reason: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("POST", "/api/suppression", f);
      setF({ ...f, value: "", reason: "" });
      toast("success", "Добавлено в Do Not Contact");
      await reload();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <SignalsHeader title="Do Not Contact и журнал" text="Глобальный список запрета обращений (общий для CRM и модуля «Спрос») и журнал оснований обработки персональных данных." />
      <Notice tone="info">Отказ в ответ на обращение автоматически вносит человека в список. Адреса из списка не собираются повторно и блокируются при подготовке любого сообщения. Удаление данных лида оставляет в журнале только обезличенную запись.</Notice>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Do Not Contact</h2>
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[160px_1fr_1fr_auto] sm:items-end">
          <Field label="Тип">{(id) => <Select id={id} value={f.type} onChange={(v) => setF({ ...f, type: v })} options={TYPES} />}</Field>
          <Field label="Значение">{(id) => <input id={id} className="input" required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder={f.type === "profile" ? "https://vk.com/user" : f.type === "domain" ? "example.com" : "user@example.com"} />}</Field>
          <Field label="Причина">{(id) => <input id={id} className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Попросил не писать" />}</Field>
          <Button type="submit" variant="primary" loading={busy} icon={<Plus className="h-4 w-4" />}>
            Добавить
          </Button>
        </form>
        <InlineError text={err} />
        {loading && !data ? (
          <SkeletonBlock rows={3} />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <p className="text-sm text-muted">Список пуст.</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {data.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="w-24 shrink-0 text-xs text-muted">{TYPES[i.type as keyof typeof TYPES] ?? i.type}</span>
                <span className="min-w-0 flex-1 break-all">{i.value}</span>
                <span className="text-xs text-muted">
                  {i.reason} · {fmtDate(i.createdAt)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  aria-label="Убрать из списка"
                  onClick={async () => {
                    if (!confirm("Убрать из списка запрета? Делайте это только если человек сам разрешил связь.")) return;
                    await api("DELETE", `/api/suppression?id=${i.id}`).catch(() => {});
                    await reload();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Журнал оснований обработки</h2>
          <Select className="w-44" value={action} onChange={setAction} options={{ "": "Все действия", ...ACTION }} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Когда</th>
                <th className="py-1 pr-2 font-medium">Субъект</th>
                <th className="py-1 pr-2 font-medium">Действие</th>
                <th className="py-1 pr-2 font-medium">Основание</th>
                <th className="py-1 font-medium">Детали</th>
              </tr>
            </thead>
            <tbody>
              {(log?.items ?? []).map((l) => (
                <tr key={l.id} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-2 text-xs text-muted">{fmtDate(l.createdAt, true)}</td>
                  <td className="py-1.5 pr-2">{l.leadId && l.action !== "deleted" && !l.subject.startsWith("удалён:") ? <a className="hover:underline" href={`/signals/leads/${l.leadId}`}>{l.subject}</a> : l.subject}</td>
                  <td className="py-1.5 pr-2">{ACTION[l.action] ?? l.action}</td>
                  <td className="py-1.5 pr-2">{BASIS[l.basis] ?? l.basis}</td>
                  <td className="py-1.5 text-xs text-muted">
                    {l.note}
                    {l.sourceUrl && (
                      <>
                        {" "}
                        <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
                          источник
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

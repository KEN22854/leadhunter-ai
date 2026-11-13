"use client";
import { useState } from "react";
import { AlertTriangle, ExternalLink, Plus } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, SectionTitle, Select, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, daysAgo, fmtDate, useApi } from "@/lib/client-api";
import { SOURCE_TYPES, STALE_DAYS } from "@/lib/domain";
import { useClient } from "./context";
import type { Source } from "./types";

type Prov = { id: string; field: string; value: string; selected: boolean; capturedAt: string; source: { id: string; sourceUrl: string; title: string; sourceType: string } | null };
const FIELD: Record<string, string> = { companyName: "Название", website: "Сайт", industry: "Отрасль", city: "Город", country: "Страна", description: "Описание" };
const METHOD: Record<string, string> = { manual: "вручную", fetch: "загрузка страницы", import: "импорт" };

export function ClientSources() {
  const { clientId, reloadBundle } = useClient();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ sources: (Source & { _count: { contacts: number } })[]; provenance: Prov[] }>(`/api/clients/${clientId}/sources`);
  const [adding, setAdding] = useState(false);

  if (loading && !data) return <SkeletonBlock rows={5} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  // Группировка происхождения по полю, выявление конфликтов
  const byField = new Map<string, Prov[]>();
  for (const p of data!.provenance) byField.set(p.field, [...(byField.get(p.field) ?? []), p]);
  const fields = [...byField.entries()].map(([field, items]) => {
    const distinct = new Set(items.map((i) => i.value.trim().toLowerCase()));
    return { field, items, conflict: distinct.size > 1 };
  });

  return (
    <div className="space-y-4">
      <section>
        <SectionTitle action={<Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Добавить источник</Button>}>
          Источники
        </SectionTitle>
        {!data!.sources.length ? (
          <EmptyState title="Источников нет" text="Укажите, откуда получены данные о клиенте." />
        ) : (
          <ul className="space-y-2">
            {data!.sources.map((s) => {
              const age = daysAgo(s.checkedAt ?? s.capturedAt);
              return (
                <li key={s.id} className="card space-y-1.5 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{SOURCE_TYPES[s.sourceType as keyof typeof SOURCE_TYPES] ?? s.sourceType}</Badge>
                    <span className="min-w-0 flex-1 font-medium">{s.title || s.sourceUrl || "Без названия"}</span>
                    {age !== null && age > STALE_DAYS && <Badge tone="warn">возможно устарел ({age} дн.)</Badge>}
                  </div>
                  {s.sourceUrl && (
                    <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-xs text-accent2 hover:underline">
                      <ExternalLink className="h-3 w-3" /> {s.sourceUrl}
                    </a>
                  )}
                  {s.evidence && <p className="text-xs">Подтверждает: {s.evidence}</p>}
                  <p className="text-xs text-muted">
                    Получено {fmtDate(s.capturedAt, true)} · способ: {METHOD[s.method] ?? s.method} · проверено {fmtDate(s.checkedAt)} · контактов из источника: {s._count.contacts}
                  </p>
                  {s.rawReference && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted">Выдержка</summary>
                      <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-line rounded bg-surface2/50 p-2 text-xs">{s.rawReference}</p>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <SectionTitle>Происхождение полей</SectionTitle>
        {!fields.length ? (
          <p className="text-sm text-muted">Нет данных о происхождении полей.</p>
        ) : (
          <ul className="space-y-3">
            {fields.map((f) => (
              <li key={f.field}>
                <p className="mb-1 flex items-center gap-2 text-sm font-medium">
                  {FIELD[f.field] ?? f.field}
                  {f.conflict && (
                    <Badge tone={f.items.some((i) => i.selected) ? "info" : "warn"}>
                      <AlertTriangle className="h-3 w-3" /> {f.items.some((i) => i.selected) ? "источники расходятся" : "конфликт — выберите значение"}
                    </Badge>
                  )}
                </p>
                <ul className="space-y-1">
                  {f.items.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={p.selected ? "font-medium text-ok" : ""}>{p.value.length > 120 ? p.value.slice(0, 120) + "…" : p.value}</span>
                      <span className="text-muted">
                        — {p.source ? p.source.title || p.source.sourceUrl || SOURCE_TYPES[p.source.sourceType as keyof typeof SOURCE_TYPES] : "правка пользователя"}, {fmtDate(p.capturedAt)}
                      </span>
                      {p.selected ? (
                        <Badge tone="ok">выбрано</Badge>
                      ) : (
                        f.conflict && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              try {
                                await api("POST", `/api/clients/${clientId}/provenance`, { provenanceId: p.id });
                                toast("success", "Значение выбрано");
                                await Promise.all([reload(), reloadBundle()]);
                              } catch (e) {
                                toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
                              }
                            }}
                          >
                            Выбрать это значение
                          </Button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      <AddSourceModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={async () => {
          setAdding(false);
          await Promise.all([reload(), reloadBundle()]);
        }}
      />
    </div>
  );
}

function AddSourceModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { clientId } = useClient();
  const toast = useToast();
  const [f, setF] = useState({ sourceType: "website", sourceUrl: "", title: "", evidence: "", rawReference: "" });
  const [fields, setFields] = useState<{ field: string; value: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Новый источник" wide>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await api("POST", `/api/clients/${clientId}/sources`, { ...f, fields: fields.filter((x) => x.value.trim()) });
            toast("success", "Источник добавлен");
            setF({ sourceType: "website", sourceUrl: "", title: "", evidence: "", rawReference: "" });
            setFields([]);
            onSaved();
          } catch (e) {
            setErr(e instanceof ApiClientError ? e.message : "Ошибка");
          }
        }}
      >
        <Field label="Тип">{(id) => <Select id={id} value={f.sourceType} onChange={(v) => setF({ ...f, sourceType: v })} options={SOURCE_TYPES} />}</Field>
        <Field label="Ссылка">{(id) => <input id={id} className="input" placeholder="https://" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} />}</Field>
        <Field label="Название" className="sm:col-span-2">{(id) => <input id={id} className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Что подтверждает" className="sm:col-span-2">{(id) => <input id={id} className="input" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} />}</Field>
        <Field label="Выдержка (текст со страницы)" className="sm:col-span-2" hint="Используется AI как данные. Не копируйте закрытую информацию.">
          {(id) => <textarea id={id} rows={3} className="input" value={f.rawReference} onChange={(e) => setF({ ...f, rawReference: e.target.value })} />}
        </Field>
        <div className="sm:col-span-2">
          <p className="label">Значения полей из этого источника (при расхождении появится конфликт)</p>
          {fields.map((x, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Select value={x.field} onChange={(v) => setFields(fields.map((y, k) => (k === i ? { ...y, field: v } : y)))} options={FIELD} className="w-40" />
              <input className="input" value={x.value} onChange={(e) => setFields(fields.map((y, k) => (k === i ? { ...y, value: e.target.value } : y)))} aria-label="Значение" />
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setFields([...fields, { field: "city", value: "" }])}>
            Значение поля
          </Button>
        </div>
        <div className="sm:col-span-2">
          <InlineError text={err} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary">
            Добавить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

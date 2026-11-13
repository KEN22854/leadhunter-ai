"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Archive, Globe, MapPin, Plus, Search } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, Select, SkeletonBlock, clsx } from "@/components/ui";
import { ScoreRing } from "@/components/client/ScoreRing";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import { CLIENT_STATUSES, SOURCE_TYPES } from "@/lib/domain";
import { useToast } from "@/components/ui/toast";

type Row = {
  id: string;
  companyName: string;
  industry: string;
  city: string;
  country: string;
  website: string;
  status: keyof typeof CLIENT_STATUSES;
  updatedAt: string;
  score: number | null;
  doNotContact: boolean;
  _count: { contacts: number; tasks: number };
};

export default function ClientsPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const url = `/api/clients?q=${encodeURIComponent(debounced)}&status=${status}&archived=${archived ? 1 : 0}`;
  const { data, error, loading, reload } = useApi<{ clients: Row[] }>(url);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Лиды</h1>
          <p className="text-sm text-muted">Потенциальные клиенты и их статус</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          Добавить лид
        </Button>
      </div>

      <div className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input className="input pl-9" placeholder="Поиск по названию, сайту, городу, отрасли" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        </div>
        <Select value={status} onChange={setStatus} options={[{ value: "", label: "Все статусы" }, ...Object.entries(CLIENT_STATUSES).map(([value, label]) => ({ value, label }))]} className="sm:w-52" />
        <Button variant={archived ? "primary" : "secondary"} icon={<Archive className="h-4 w-4" />} onClick={() => setArchived((a) => !a)}>
          {archived ? "Архив" : "Активные"}
        </Button>
      </div>

      {loading && !data ? (
        <SkeletonBlock rows={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.clients.length ? (
        <EmptyState
          title={debounced || status ? "Ничего не найдено" : archived ? "Архив пуст" : "Лидов пока нет"}
          text={debounced || status ? "Измените условия поиска." : "Добавьте первого потенциального клиента вручную."}
          action={!archived && <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>Добавить лид</Button>}
        />
      ) : (
        <ul className="grid gap-2">
          {data.clients.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`} className="card flex items-center gap-4 p-3 transition hover:border-accent/50">
                <ScoreRing score={c.score} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{c.companyName}</p>
                    <Badge tone="accent">{CLIENT_STATUSES[c.status] ?? c.status}</Badge>
                    {c.doNotContact && <Badge tone="danger">Не связываться</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {c.industry && <span>{c.industry}</span>}
                    {(c.city || c.country) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {[c.city, c.country].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {c.website && (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="h-3 w-3" /> {c.website.replace(/^https?:\/\//, "")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="hidden text-right text-xs text-muted sm:block">
                  <p>Контактов: {c._count.contacts}</p>
                  <p>Обновлён {fmtDate(c.updatedAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateClientModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreateClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ companyName: "", website: "", industry: "", country: "Россия", city: "", description: "", sourceType: "manual", sourceUrl: "", sourceEvidence: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const { client } = await api<{ client: { id: string } }>("POST", "/api/clients", f);
      toast("success", "Лид добавлен");
      router.push(`/clients/${client.id}`);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Новый лид" wide>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Название компании *" className="sm:col-span-2">
          {(id) => <input id={id} className="input" required maxLength={200} value={f.companyName} onChange={set("companyName")} />}
        </Field>
        <Field label="Сайт">{(id) => <input id={id} className="input" placeholder="https://" value={f.website} onChange={set("website")} />}</Field>
        <Field label="Отрасль">{(id) => <input id={id} className="input" value={f.industry} onChange={set("industry")} />}</Field>
        <Field label="Страна">{(id) => <input id={id} className="input" value={f.country} onChange={set("country")} />}</Field>
        <Field label="Город">{(id) => <input id={id} className="input" value={f.city} onChange={set("city")} />}</Field>
        <Field label="Описание" className="sm:col-span-2">
          {(id) => <textarea id={id} rows={3} className="input" value={f.description} onChange={set("description")} />}
        </Field>
        <Field label="Где найден (источник)">
          {(id) => <Select id={id} value={f.sourceType} onChange={(v) => setF({ ...f, sourceType: v })} options={SOURCE_TYPES} />}
        </Field>
        <Field label="Ссылка на источник">{(id) => <input id={id} className="input" placeholder="https://" value={f.sourceUrl} onChange={set("sourceUrl")} />}</Field>
        <Field label="Что подтверждает источник" className="sm:col-span-2" hint="Например: «опубликован заказ на редизайн сайта», «название и адрес из каталога».">
          {(id) => <input id={id} className="input" value={f.sourceEvidence} onChange={set("sourceEvidence")} />}
        </Field>
        <div className="sm:col-span-2">
          <InlineError text={err} />
        </div>
        <div className={clsx("flex justify-end gap-2 sm:col-span-2")}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Создать карточку
          </Button>
        </div>
      </form>
    </Modal>
  );
}

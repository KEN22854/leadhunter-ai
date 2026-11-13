"use client";
import { useState } from "react";
import { Ban, Copy, ExternalLink, Link2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, Select, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import { CONTACT_TYPES, VERIFICATION_STATUSES } from "@/lib/domain";
import { useClient } from "./context";
import type { Contact } from "./types";

export function verificationTone(s: string) {
  return s === "confirmed" ? "ok" : s === "formal" ? "info" : s === "invalid" ? "danger" : "warn";
}

function openLink(c: Contact): string | null {
  const v = c.value.trim();
  switch (c.type) {
    case "email":
      return `mailto:${v}`;
    case "phone":
      return `tel:${v.replace(/[^\d+]/g, "")}`;
    case "website":
    case "linkedin":
    case "social":
      return /^https?:\/\//.test(v) ? v : `https://${v}`;
    case "telegram":
      return `https://t.me/${v.replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "")}`;
    case "whatsapp":
      return `https://wa.me/${v.replace(/[^\d]/g, "")}`;
    default:
      return null;
  }
}

type Resp = { contacts: Contact[]; duplicates: { normalizedValue: string; client: { id: string; companyName: string } }[] };

export function ClientContacts() {
  const { clientId, reloadBundle } = useClient();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Resp>(`/api/clients/${clientId}/contacts`);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Contact | null>(null);

  async function patch(c: Contact, body: Record<string, unknown>, ok?: string) {
    setBusyId(c.id);
    try {
      const r = await api<{ summary: string }>("PATCH", `/api/contacts/${c.id}`, body);
      toast("success", ok ?? r.summary);
      await Promise.all([reload(), reloadBundle()]);
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !data) return <SkeletonBlock rows={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Каждое значение хранится отдельной записью с источником и статусом проверки.</p>
        <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
          Добавить контакт
        </Button>
      </div>
      {!data?.contacts.length ? (
        <EmptyState title="Контактов нет" text="Добавьте деловые контакты компании с указанием источника." action={<Button onClick={() => setAdding(true)}>Добавить контакт</Button>} />
      ) : (
        <ul className="space-y-2">
          {data.contacts.map((c) => {
            const dup = data.duplicates.filter((d) => d.normalizedValue === c.normalizedValue);
            const link = openLink(c);
            return (
              <li key={c.id} className="card space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{CONTACT_TYPES[c.type as keyof typeof CONTACT_TYPES] ?? c.type}</Badge>
                  <span className="min-w-0 flex-1 break-all font-medium">{c.value}</span>
                  {c.label && <span className="text-xs text-muted">{c.label}</span>}
                  <Badge tone={verificationTone(c.verificationStatus)}>{VERIFICATION_STATUSES[c.verificationStatus as keyof typeof VERIFICATION_STATUSES] ?? c.verificationStatus}</Badge>
                  {c.doNotContact && <Badge tone="danger">Не связываться</Badge>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>Нормализовано: {c.normalizedValue}</span>
                  <span>Обнаружен: {fmtDate(c.discoveredAt)}</span>
                  <span>Проверен: {fmtDate(c.lastCheckedAt)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Link2 className="h-3 w-3" /> Источник:{" "}
                    {c.source?.sourceUrl ? (
                      <a href={c.source.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent2 hover:underline">
                        {c.source.title || c.source.sourceUrl}
                      </a>
                    ) : (
                      c.source?.title || "не указан"
                    )}
                  </span>
                </div>
                {dup.length > 0 && (
                  <p className="text-xs text-warn">
                    Возможный дубликат: тот же контакт у {dup.map((d) => d.client.companyName).join(", ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy className="h-3.5 w-3.5" />}
                    onClick={() => navigator.clipboard.writeText(c.value).then(() => toast("success", "Скопировано"), () => toast("error", "Буфер обмена недоступен"))}
                  >
                    Копировать
                  </Button>
                  <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />} disabledReason={link ? undefined : "Нельзя открыть этот тип"} onClick={() => link && window.open(link, "_blank", "noopener,noreferrer")}>
                    Открыть
                  </Button>
                  <Button size="sm" variant="ghost" icon={<ShieldCheck className="h-3.5 w-3.5" />} loading={busyId === c.id} onClick={() => patch(c, { runFormalCheck: true })}>
                    Формальная проверка
                  </Button>
                  <Select
                    value=""
                    onChange={(v) => v && patch(c, { verificationStatus: v })}
                    options={[{ value: "", label: "Установить статус…" }, ...Object.entries(VERIFICATION_STATUSES).map(([value, label]) => ({ value, label }))]}
                    className="h-8 w-auto py-0 text-xs"
                  />
                  <Button size="sm" variant="ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => patch(c, { doNotContact: !c.doNotContact }, c.doNotContact ? "Запрет снят" : "Контакт внесён в список запрета")}>
                    {c.doNotContact ? "Снять запрет" : "Запрет обращений"}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDelete(c)}>
                    Удалить
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted">
        «Формальная проверка» — синтаксис и DNS/MX домена. Она не подтверждает владельца: статус «Подтверждён» ставьте только при реальном подтверждении от компании или источника.
      </p>
      <AddContactModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={async () => {
          setAdding(false);
          await Promise.all([reload(), reloadBundle()]);
        }}
      />
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Удалить контакт?">
        <p className="text-sm text-muted">{confirmDelete?.value} будет удалён из карточки. Чтобы запретить повторную обработку, используйте «Запрет обращений».</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              const c = confirmDelete!;
              setConfirmDelete(null);
              try {
                await api("DELETE", `/api/contacts/${c.id}`);
                toast("success", "Контакт удалён");
                await Promise.all([reload(), reloadBundle()]);
              } catch (e) {
                toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
              }
            }}
          >
            Удалить
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function AddContactModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { clientId } = useClient();
  const toast = useToast();
  const [f, setF] = useState({ type: "email", value: "", label: "", sourceUrl: "" });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Новый контакт">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setErr(null);
          try {
            await api("POST", `/api/clients/${clientId}/contacts`, f);
            toast("success", "Контакт добавлен");
            setF({ type: f.type, value: "", label: "", sourceUrl: "" });
            onSaved();
          } catch (e) {
            setErr(e instanceof ApiClientError ? e.message : "Ошибка");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Тип">{(id) => <Select id={id} value={f.type} onChange={(v) => setF({ ...f, type: v })} options={CONTACT_TYPES} />}</Field>
        <Field label="Значение *">{(id) => <input id={id} className="input" required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>
        <Field label="Подпись (отдел, имя роли)" hint="Не указывайте лишних персональных данных.">
          {(id) => <input id={id} className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />}
        </Field>
        <Field label="Где найден (ссылка на страницу)">{(id) => <input id={id} className="input" placeholder="https://" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} />}</Field>
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Добавить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

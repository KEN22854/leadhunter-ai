"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Field, InlineError, Modal, Select } from "@/components/ui";
import { api, ApiClientError } from "@/lib/client-api";
import type { SignalsMeta } from "./shared";

export function ManualSignalModal({ open, onClose, meta, onAdded }: { open: boolean; onClose: () => void; meta: SignalsMeta | null; onAdded: (leadId: string) => void }) {
  const [f, setF] = useState({ source: "manual", url: "", text: "", authorName: "", authorUrl: "", service: "website", publishedAt: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ leadId: string; status: string }>("POST", "/api/signals/leads", { ...f, publishedAt: f.publishedAt ? new Date(f.publishedAt).toISOString() : "" });
      onAdded(r.leadId);
      onClose();
      setF({ ...f, url: "", text: "", authorName: "", authorUrl: "" });
    } catch (e) {
      setErr(e instanceof ApiClientError ? `${e.message}${Array.isArray(e.details) ? ": " + (e.details as { message: string }[]).map((d) => d.message).join("; ") : ""}` : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  const sourceOpts = [{ value: "manual", label: "Другая площадка" }, ...(meta?.sources ?? []).filter((s) => s.key !== "manual").map((s) => ({ value: s.key, label: s.label }))];
  return (
    <Modal open={open} onClose={onClose} title="Добавить публикацию вручную">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">Для площадок без разрешённого API (LinkedIn, Facebook, Upwork…): вставьте публикацию, которую нашли сами. Система определит намерение, оценит лид и объединит с дубликатами.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Площадка">{(id) => <Select id={id} value={f.source} onChange={(v) => setF({ ...f, source: v })} options={sourceOpts} />}</Field>
          <Field label="Ваша услуга">{(id) => <Select id={id} value={f.service} onChange={(v) => setF({ ...f, service: v })} options={Object.fromEntries(Object.entries(meta?.services ?? {}).map(([k, v]) => [k, v.label]))} />}</Field>
        </div>
        <Field label="Ссылка на публикацию *">{(id) => <input id={id} className="input" type="url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />}</Field>
        <Field label="Текст публикации *">{(id) => <textarea id={id} className="input min-h-28" required minLength={15} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Ищу дизайнера для лендинга кофейни, бюджет до 40 000 ₽…" />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Автор">{(id) => <input id={id} className="input" value={f.authorName} onChange={(e) => setF({ ...f, authorName: e.target.value })} />}</Field>
          <Field label="Профиль автора">{(id) => <input id={id} className="input" type="url" value={f.authorUrl} onChange={(e) => setF({ ...f, authorUrl: e.target.value })} placeholder="https://…" />}</Field>
          <Field label="Дата публикации">{(id) => <input id={id} className="input" type="date" value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} />}</Field>
        </div>
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy} icon={<Plus className="h-4 w-4" />}>
            Добавить и оценить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

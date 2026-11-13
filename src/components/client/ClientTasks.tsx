"use client";
import { useEffect, useState } from "react";
import { Bot, CalendarClock, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, Select, SkeletonBlock, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import { PRIORITIES, TASK_KINDS, TASK_STATUSES } from "@/lib/domain";
import { useClient } from "./context";
import type { Task } from "./types";

export function ClientTasks({ refreshKey }: { refreshKey: number }) {
  const { clientId, openTask, reloadBundle } = useClient();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ tasks: Task[] }>(`/api/clients/${clientId}/tasks`);
  const [editing, setEditing] = useState<Task | null>(null);
  useEffect(() => {
    if (refreshKey) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function patch(t: Task, body: Record<string, unknown>) {
    try {
      await api("PATCH", `/api/tasks/${t.id}`, body);
      await Promise.all([reload(), reloadBundle()]);
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    }
  }

  if (loading && !data) return <SkeletonBlock rows={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const open = data!.tasks.filter((t) => t.status === "new" || t.status === "in_progress");
  const closed = data!.tasks.filter((t) => t.status === "done" || t.status === "cancelled");

  const row = (t: Task) => {
    const overdue = t.dueAt && new Date(t.dueAt) < new Date() && (t.status === "new" || t.status === "in_progress");
    return (
      <li key={t.id} className={clsx("card flex flex-wrap items-center gap-3 p-3", (t.status === "done" || t.status === "cancelled") && "opacity-60")}>
        <button
          onClick={() => patch(t, { status: t.status === "done" ? "new" : "done" })}
          className={clsx("flex h-5 w-5 shrink-0 items-center justify-center rounded border", t.status === "done" ? "border-ok bg-ok/20 text-ok" : "border-border hover:border-accent")}
          aria-label={t.status === "done" ? "Вернуть в работу" : "Отметить выполненной"}
        >
          {t.status === "done" && <Check className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className={clsx("text-sm font-medium", t.status === "done" && "line-through")}>{t.title}</p>
          {t.description && <p className="text-xs text-muted">{t.description}</p>}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>{TASK_KINDS[t.kind as keyof typeof TASK_KINDS] ?? t.kind}</Badge>
            <Badge tone={t.priority === "very_high" || t.priority === "high" ? "warn" : "neutral"}>{PRIORITIES[t.priority as keyof typeof PRIORITIES]}</Badge>
            {t.dueAt && (
              <Badge tone={overdue ? "danger" : "info"}>
                <CalendarClock className="h-3 w-3" /> {fmtDate(t.dueAt, true)}
                {overdue && " · просрочено"}
              </Badge>
            )}
            {t.source === "ai" && (
              <Badge tone="accent">
                <Bot className="h-3 w-3" /> из AI
              </Badge>
            )}
          </div>
        </div>
        <Select value={t.status} onChange={(v) => patch(t, { status: v })} options={TASK_STATUSES} className="h-8 w-auto py-0 text-xs" />
        <button className="text-muted hover:text-text" onClick={() => setEditing(t)} aria-label="Изменить">
          <Pencil className="h-4 w-4" />
        </button>
        <button
          className="text-muted hover:text-danger"
          aria-label="Удалить"
          onClick={async () => {
            try {
              await api("DELETE", `/api/tasks/${t.id}`);
              await Promise.all([reload(), reloadBundle()]);
            } catch (e) {
              toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Напоминания, follow-up, встречи и следующие шаги.</p>
        <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => openTask()}>
          Новая задача
        </Button>
      </div>
      {!data!.tasks.length ? (
        <EmptyState title="Задач нет" text="Создайте задачу вручную или из AI-рекомендации на вкладке «AI-анализ»." />
      ) : (
        <>
          <ul className="space-y-2">{open.map(row)}</ul>
          {closed.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-muted">Закрытые ({closed.length})</summary>
              <ul className="mt-2 space-y-2">{closed.map(row)}</ul>
            </details>
          )}
        </>
      )}
      <p className="text-xs text-muted">Follow-up планируйте с учётом согласия получателя и истории коммуникации: повторные обращения после отказа блокируются списком запрета.</p>
      <TaskModal
        open={!!editing}
        task={editing}
        prefill={{}}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await Promise.all([reload(), reloadBundle()]);
        }}
      />
    </div>
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function TaskModal({
  open,
  task,
  prefill,
  onClose,
  onSaved,
}: {
  open: boolean;
  task?: Task | null;
  prefill: { title?: string; description?: string; source?: "manual" | "ai" };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { clientId } = useClient();
  const toast = useToast();
  const [f, setF] = useState({ title: "", description: "", dueAt: "", priority: "medium", kind: "task" });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(
      task
        ? { title: task.title, description: task.description, dueAt: toLocalInput(task.dueAt), priority: task.priority, kind: task.kind }
        : { title: prefill.title ?? "", description: prefill.description ?? "", dueAt: "", priority: "medium", kind: "task" },
    );
  }, [open, task, prefill.title, prefill.description]);
  return (
    <Modal open={open} onClose={onClose} title={task ? "Задача" : "Новая задача"}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setErr(null);
          const body = { ...f, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null };
          try {
            if (task) await api("PATCH", `/api/tasks/${task.id}`, body);
            else await api("POST", `/api/clients/${clientId}/tasks`, { ...body, source: prefill.source ?? "manual" });
            toast("success", task ? "Задача обновлена" : "Задача создана");
            onSaved();
          } catch (e) {
            setErr(e instanceof ApiClientError ? e.message : "Ошибка");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Название *" className="sm:col-span-2">{(id) => <input id={id} className="input" required maxLength={300} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Описание" className="sm:col-span-2">{(id) => <textarea id={id} rows={3} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Field label="Дата и время">{(id) => <input id={id} type="datetime-local" className="input" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />}</Field>
        <Field label="Тип">{(id) => <Select id={id} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={TASK_KINDS} />}</Field>
        <Field label="Приоритет">{(id) => <Select id={id} value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={PRIORITIES} />}</Field>
        <div className="sm:col-span-2">
          <InlineError text={err} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

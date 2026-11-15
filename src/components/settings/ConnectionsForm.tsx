"use client";
import { useEffect, useState } from "react";
import { ChevronDown, KeyRound, Save } from "lucide-react";
import { Badge, Button, InlineError, Notice, SectionTitle, SkeletonBlock, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, useApi } from "@/lib/client-api";
import { GroupSourceTests } from "@/components/signals/SourceTest";

type Field = { key: string; label: string; secret?: boolean; hint?: string; placeholder?: string; type?: "text" | "number" | "bool"; value: string; isSet: boolean; source: "db" | "env" | "none" };
type Group = { id: string; title: string; description: string; fields: Field[] };

function GroupForm({ g, onSaved }: { g: Group; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setVals(Object.fromEntries(g.fields.filter((f) => !f.secret).map((f) => [f.key, f.value])));
    setClear({});
  }, [g]);
  const configured = g.fields.filter((f) => f.isSet).length;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const values: Record<string, string> = {};
    for (const f of g.fields) {
      if (f.secret) {
        if (clear[f.key]) values[f.key] = "";
        else if (vals[f.key]) values[f.key] = vals[f.key];
      } else if ((vals[f.key] ?? "") !== f.value) values[f.key] = vals[f.key] ?? "";
    }
    try {
      if (Object.keys(values).length) await api("PUT", "/api/settings/connections", { values });
      toast("success", Object.keys(values).length ? "Сохранено и применено" : "Изменений нет");
      setVals((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !g.fields.find((f) => f.key === k)?.secret)));
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 p-3 text-left" aria-expanded={open}>
        <KeyRound className="h-4 w-4 text-accent" />
        <span className="min-w-0 flex-1 font-medium">{g.title}</span>
        <Badge tone={configured ? "ok" : "neutral"}>{configured ? `задано ${configured}/${g.fields.length}` : "не настроено"}</Badge>
        <ChevronDown className={clsx("h-4 w-4 text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <form onSubmit={save} className="space-y-3 border-t border-border p-3">
          <p className="text-xs text-muted">{g.description}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.fields.map((f) => (
              <div key={f.key}>
                <label className="label" htmlFor={`cfg-${f.key}`}>
                  {f.label} {f.source === "env" && <span className="text-[10px] text-muted">(из .env)</span>}
                </label>
                {f.type === "bool" ? (
                  <select id={`cfg-${f.key}`} className="input" value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>
                    <option value="">По умолчанию</option>
                    <option value="true">Да</option>
                    <option value="false">Нет</option>
                  </select>
                ) : f.secret ? (
                  <>
                    <input
                      id={`cfg-${f.key}`}
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      disabled={clear[f.key]}
                      value={vals[f.key] ?? ""}
                      onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                      placeholder={f.isSet ? `задан ${f.value} — оставьте пустым, чтобы не менять` : f.placeholder ?? "не задан"}
                    />
                    {f.source === "db" && (
                      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                        <input type="checkbox" checked={Boolean(clear[f.key])} onChange={(e) => setClear({ ...clear, [f.key]: e.target.checked })} />
                        Удалить сохранённое значение
                      </label>
                    )}
                  </>
                ) : (
                  <input id={`cfg-${f.key}`} className="input" inputMode={f.type === "number" ? "numeric" : undefined} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} placeholder={f.placeholder} />
                )}
                {f.hint && <p className="mt-1 text-[11px] text-muted">{f.hint}</p>}
              </div>
            ))}
          </div>
          <InlineError text={err} />
          <Button type="submit" variant="primary" size="sm" loading={busy} icon={<Save className="h-3.5 w-3.5" />}>
            Сохранить
          </Button>
          <GroupSourceTests groupId={g.id} />
        </form>
      )}
    </div>
  );
}

export function ConnectionsForm({ onChanged }: { onChanged?: () => void }) {
  const { data, error, reload } = useApi<{ groups: Group[] }>("/api/settings/connections");
  if (error?.status === 403) return null; // не администратор — раздел скрыт
  return (
    <section className="card">
      <SectionTitle>Подключения</SectionTitle>
      <p className="mb-3 text-sm text-muted">Почта, мессенджеры и ключи API источников. Секреты шифруются в базе (AES-256-GCM) и никогда не показываются целиком; изменения применяются сразу, без перезапуска. Значение здесь важнее, чем в .env.</p>
      {error ? (
        <Notice tone="danger">{error.message}</Notice>
      ) : !data ? (
        <SkeletonBlock rows={4} />
      ) : (
        <div className="space-y-2">
          {data.groups.map((g) => (
            <GroupForm
              key={g.id}
              g={g}
              onSaved={async () => {
                await reload();
                onChanged?.();
                window.dispatchEvent(new Event("lh-connections-changed"));
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

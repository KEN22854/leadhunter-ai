"use client";
import { useState } from "react";
import { CheckCircle2, PlugZap, XCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { api, ApiClientError } from "@/lib/client-api";

export type TestResult = { key: string; ok: boolean; detail: string; checkedAt: string };

export async function runSourceTest(key: string): Promise<TestResult> {
  try {
    return await api<TestResult>("POST", `/api/signals/sources/${key}/test`);
  } catch (e) {
    return { key, ok: false, detail: e instanceof ApiClientError ? e.message : "Ошибка проверки", checkedAt: new Date().toISOString() };
  }
}

export function TestResultLine({ r }: { r: TestResult }) {
  return (
    <p className={r.ok ? "flex items-start gap-1 text-xs text-ok" : "flex items-start gap-1 text-xs text-danger"}>
      {r.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />}
      <span>{r.detail}</span>
    </p>
  );
}

/** Кнопка проверки одного источника с результатом под ней. */
export function SourceTestButton({ sourceKey, label = "Проверить" }: { sourceKey: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestResult | null>(null);
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        icon={<PlugZap className="h-3.5 w-3.5" />}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setRes(await runSourceTest(sourceKey));
          setBusy(false);
        }}
      >
        {label}
      </Button>
      {res && <TestResultLine r={res} />}
    </div>
  );
}

const GROUP_SOURCES: Record<string, { key: string; label: string }[]> = {
  social: [
    { key: "threads", label: "Threads" },
    { key: "instagram", label: "Instagram" },
    { key: "vk", label: "VK" },
    { key: "reddit", label: "Reddit" },
    { key: "x", label: "X (Twitter)" },
    { key: "discord", label: "Discord" },
  ],
  search: [
    { key: "google_search", label: "Google Search" },
    { key: "yandex_search", label: "Яндекс Поиск" },
    { key: "google_maps", label: "Google Maps" },
    { key: "yandex_maps", label: "Яндекс Карты" },
    { key: "2gis", label: "2ГИС" },
    { key: "crunchbase", label: "Crunchbase" },
  ],
};

/** Проверка всех источников группы настроек (Подключения → соцсети / поиск). */
export function GroupSourceTests({ groupId }: { groupId: string }) {
  const list = GROUP_SOURCES[groupId];
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Record<string, TestResult>>({});
  if (!list) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Проверка подключений</p>
        <Button
          size="sm"
          icon={<PlugZap className="h-3.5 w-3.5" />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const out: Record<string, TestResult> = {};
            for (const s of list) {
              out[s.key] = await runSourceTest(s.key);
              setRes({ ...out });
            }
            setBusy(false);
          }}
        >
          Проверить все
        </Button>
      </div>
      <ul className="space-y-1">
        {list.map((s) => (
          <li key={s.key} className="grid gap-0.5 sm:grid-cols-[140px_1fr] sm:gap-3">
            <span className="text-xs font-medium">{s.label}</span>
            {res[s.key] ? <TestResultLine r={res[s.key]} /> : <span className="text-xs text-muted">{busy ? "…" : "не проверялось"}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

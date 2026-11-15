"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Flame, ListChecks, Plug, Send, ShieldBan, Sparkles } from "lucide-react";
import { Badge, clsx } from "@/components/ui";

export const TEMP_UI: Record<string, { label: string; tone: "danger" | "warn" | "info" | "neutral"; hint: string }> = {
  hot: { label: "Горячий", tone: "danger", hint: "Конкретный запрос исполнителя по вашей услуге, свежий" },
  warm: { label: "Тёплый", tone: "warn", hint: "Ищет исполнителя/рекомендации, но меньше конкретики" },
  potential: { label: "Потенциальный", tone: "info", hint: "Запуск проекта, интерес или компания без явного запроса" },
  cold: { label: "Нет интереса", tone: "neutral", hint: "Обсуждение без намерения заказать" },
};

export const INTENT_UI: Record<string, string> = {
  order: "Конкретный заказ",
  hire: "Ищет исполнителя",
  ongoing: "Подрядчик на постоянной основе",
  recommendation: "Ищет рекомендации",
  partner: "Ищет партнёра",
  launch: "Планирует запуск",
  interest: "Интересуется услугой",
  none: "Нет коммерческого интереса",
  unknown: "—",
};

export function TempBadge({ t }: { t: string }) {
  const u = TEMP_UI[t] ?? TEMP_UI.potential;
  return (
    <Badge tone={u.tone} title={u.hint}>
      {t === "hot" && <Flame className="h-3 w-3" />}
      {u.label}
    </Badge>
  );
}

export function ScorePill({ score }: { score: number }) {
  const tone = score >= 75 ? "text-ok border-ok/40 bg-ok/10" : score >= 50 ? "text-warn border-warn/40 bg-warn/10" : "text-muted border-border bg-surface2";
  return <span className={clsx("inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums", tone)} title="Lead Score">{score}</span>;
}

const TABS = [
  { href: "/signals", label: "Лиды", icon: Sparkles, exact: true },
  { href: "/signals/campaigns", label: "Кампании поиска", icon: ListChecks },
  { href: "/signals/outbox", label: "Исходящие", icon: Send },
  { href: "/signals/sources", label: "Источники", icon: Plug },
  { href: "/signals/analytics", label: "Аналитика", icon: BarChart3 },
  { href: "/signals/compliance", label: "Do Not Contact и журнал", icon: ShieldBan },
];

export function SignalsHeader({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted">{text}</p>
        </div>
        {action}
      </div>
      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Разделы модуля «Спрос»">
        {TABS.map((t) => {
          const active = t.exact ? path === t.href || path.startsWith("/signals/leads") : path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={clsx("flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition", active ? "bg-accent text-on-accent" : "text-muted hover:bg-surface2 hover:text-text")}>
              <t.icon className="h-4 w-4" /> {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export type SourceMetaUI = {
  key: string;
  label: string;
  group: string;
  kind: string;
  access: "public" | "api_key" | "manual" | "closed";
  env?: string[];
  quality: number;
  reply: string[];
  replyHint: string;
  note: string;
  searchUrl?: string;
  docs?: string;
  readiness: { ready: boolean; reason: string; missing: string[] };
  health: { lastOkAt: string | null; lastErrorAt: string | null; lastError: string; consecutiveFails: number; backoffUntil: string | null; requestsToday: number } | null;
};

export type SignalsMeta = {
  groups: Record<string, string>;
  sources: SourceMetaUI[];
  services: Record<string, { label: string; queries: Record<string, string[]> }>;
  languages: Record<string, string>;
  ai: boolean;
};

export const ACCESS_UI: Record<string, { label: string; tone: "ok" | "info" | "warn" | "neutral" }> = {
  public: { label: "Открытые данные", tone: "ok" },
  api_key: { label: "Официальный API", tone: "info" },
  manual: { label: "Ручной режим", tone: "warn" },
  closed: { label: "API закрыт", tone: "neutral" },
};

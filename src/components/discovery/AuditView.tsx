"use client";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge, clsx } from "@/components/ui";
import type { AuditSeverity, SiteAudit } from "@/lib/discovery/audit";

const SEV: Record<AuditSeverity, { label: string; tone: "danger" | "warn" | "info" | "ok"; icon: typeof Info }> = {
  critical: { label: "Критично", tone: "danger", icon: AlertOctagon },
  major: { label: "Важно", tone: "warn", icon: AlertTriangle },
  minor: { label: "Можно улучшить", tone: "info", icon: Info },
  ok: { label: "В порядке", tone: "ok", icon: CheckCircle2 },
};

export const OPPORTUNITY: Record<SiteAudit["opportunity"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  high: { label: "Много что улучшить", tone: "ok" },
  medium: { label: "Есть что улучшить", tone: "warn" },
  low: { label: "Сайт в порядке", tone: "neutral" },
};

export function AuditScore({ score, size = "md" }: { score: number | null | undefined; size?: "sm" | "md" }) {
  if (score === null || score === undefined) return <span className="text-xs text-muted">—</span>;
  const tone = score >= 75 ? "text-ok border-ok/40" : score >= 45 ? "text-warn border-warn/40" : "text-danger border-danger/40";
  return (
    <span
      className={clsx("inline-flex shrink-0 items-center justify-center rounded-full border-2 font-semibold tabular-nums", tone, size === "sm" ? "h-8 w-8 text-[11px]" : "h-11 w-11 text-sm")}
      title="Состояние сайта по автоматическим проверкам (100 — улучшать почти нечего)"
    >
      {score}
    </span>
  );
}

export function AuditView({ audit, compact }: { audit: SiteAudit; compact?: boolean }) {
  const problems = audit.items.filter((i) => i.severity !== "ok");
  const oks = audit.items.filter((i) => i.severity === "ok");
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <AuditScore score={audit.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={OPPORTUNITY[audit.opportunity].tone}>{OPPORTUNITY[audit.opportunity].label}</Badge>
            {audit.url && (
              <a href={audit.url} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-accent2 hover:underline">
                {audit.url.replace(/^https?:\/\//, "")}
              </a>
            )}
            <span className="text-xs text-muted">проверено {new Date(audit.checkedAt).toLocaleDateString("ru-RU")}</span>
          </div>
          <p className="mt-1 text-sm">{audit.summary}</p>
        </div>
      </div>
      {problems.length > 0 && (
        <ul className="space-y-2">
          {problems.map((i) => {
            const s = SEV[i.severity];
            return (
              <li key={i.key} className="rounded-lg border border-border/70 bg-surface2/40 p-2.5">
                <div className="flex items-start gap-2">
                  <s.icon className={clsx("mt-0.5 h-4 w-4 shrink-0", { "text-danger": s.tone === "danger", "text-warn": s.tone === "warn", "text-accent2": s.tone === "info" })} />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      {i.title} <span className="ml-1 text-[11px] font-normal text-muted">{s.label}</span>
                    </p>
                    {!compact && <p className="text-muted">{i.detail}</p>}
                    {i.recommendation && <p className="mt-0.5 text-xs">→ {i.recommendation}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!compact && oks.length > 0 && (
        <p className="flex flex-wrap gap-1.5 text-xs text-muted">
          {oks.map((o) => (
            <span key={o.key} className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-ok" /> {o.title}
            </span>
          ))}
        </p>
      )}
      <p className="text-[11px] text-muted">Аудит автоматический: проверяются главная и до двух страниц «контакты/о нас» по тексту и разметке (без скриншотов). Пункты — наблюдения, их стоит проверить глазами.</p>
    </div>
  );
}

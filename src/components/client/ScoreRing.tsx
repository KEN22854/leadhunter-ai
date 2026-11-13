"use client";
import { scoreCategory } from "@/lib/domain";

export function ScoreRing({ score, size = 56 }: { score: number | null; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : score / 100;
  const color = score === null ? "rgb(var(--muted))" : score >= 70 ? "rgb(var(--ok))" : score >= 40 ? "rgb(var(--warn))" : "rgb(var(--danger))";
  const label = score === null ? "Lead Score не рассчитан" : `Lead Score ${score} из 100 — ${scoreCategory(score).label}`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label} title={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--border))" strokeWidth={4} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={4} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold" style={{ fontSize: size * 0.3 }}>
        {score ?? "—"}
      </span>
    </div>
  );
}

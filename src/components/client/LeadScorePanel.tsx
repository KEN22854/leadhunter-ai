"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button, EmptyState, Notice } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate } from "@/lib/client-api";
import { scoreCategory } from "@/lib/domain";
import { useClient } from "./context";
import { ScoreRing } from "./ScoreRing";

const CONF: Record<string, string> = { high: "высокая", medium: "средняя", low: "низкая" };

export function LeadScorePanel({ compact }: { compact?: boolean }) {
  const { bundle, clientId, reloadBundle } = useClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const s = bundle.score;

  async function recalc() {
    setBusy(true);
    try {
      await api("POST", `/api/clients/${clientId}/score/recalculate`);
      await reloadBundle();
      toast("success", "Lead Score пересчитан");
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (!s)
    return (
      <EmptyState
        title="Lead Score не рассчитан"
        text="Оценка строится по данным карточки: контакты, источники, свежесть, AI-анализ."
        action={<Button onClick={recalc} loading={busy} icon={<RefreshCw className="h-4 w-4" />}>Рассчитать</Button>}
      />
    );

  const cat = scoreCategory(s.score);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={s.score} size={compact ? 56 : 72} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{cat.label}</p>
          <p className="text-sm text-muted">{cat.hint}</p>
          <p className="mt-1 text-xs text-muted">Рассчитано {fmtDate(s.calculatedAt, true)}</p>
        </div>
        <Button size="sm" onClick={recalc} loading={busy} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Пересчитать
        </Button>
      </div>
      <Notice tone="info">Эвристическая оценка соответствия критериям и качества данных. Это не вероятность покупки.</Notice>
      <ul className="space-y-2.5">
        {s.factors.map((f) => (
          <li key={f.key} className="rounded-lg border border-border/60 bg-surface2/40 p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{f.label}</span>
              <span className="tabular-nums">
                {f.points} / {f.max}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60" aria-hidden>
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent2" style={{ width: `${(f.points / f.max) * 100}%` }} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="flex-1">{f.basis}</span>
              <Badge tone={f.confidence === "high" ? "ok" : f.confidence === "medium" ? "warn" : "neutral"}>уверенность: {CONF[f.confidence]}</Badge>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{s.explanation}</p>
    </div>
  );
}

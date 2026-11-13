"use client";
import { useState } from "react";
import { AlertTriangle, Columns3, Pencil } from "lucide-react";
import { Badge, Button, SectionTitle, clsx } from "@/components/ui";
import { CHANNELS, LANGUAGES, TONES } from "@/lib/domain";
import type { AIMessage } from "../types";

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "info" }> = {
  draft: { label: "черновик", tone: "neutral" },
  saved: { label: "сохранено", tone: "info" },
  queued: { label: "к отправке", tone: "warn" },
  sent: { label: "отправлено", tone: "ok" },
};

export function AIMessageVariants({ items, selectedId, onSelect }: { items: AIMessage[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [compare, setCompare] = useState(false);
  return (
    <section>
      <SectionTitle
        action={
          items.length > 1 && (
            <Button size="sm" variant="ghost" icon={<Columns3 className="h-3.5 w-3.5" />} onClick={() => setCompare((c) => !c)}>
              {compare ? "Свернуть" : "Сравнить полностью"}
            </Button>
          )
        }
      >
        Варианты
      </SectionTitle>
      <div className="grid gap-3 lg:grid-cols-3">
        {items.map((m) => {
          const st = STATUS[m.status] ?? STATUS.draft;
          return (
            <article key={m.id} className={clsx("card flex flex-col gap-2 p-3", selectedId === m.id && "border-accent ring-2 ring-accent/30")}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{m.label || m.variantKey}</span>
                {m.variantKey === "recommended" && <Badge tone="accent">рекомендуемый</Badge>}
                <Badge tone={st.tone}>{st.label}</Badge>
                <span className="ml-auto text-[11px] text-muted">v{m.version}</span>
              </div>
              <p className="text-[11px] text-muted">
                {CHANNELS[m.channel as keyof typeof CHANNELS] ?? m.channel}
                {m.tone && ` · ${TONES[m.tone as keyof typeof TONES] ?? m.tone}`} · {LANGUAGES[m.language as keyof typeof LANGUAGES] ?? m.language}
              </p>
              {m.subject && <p className="text-sm font-medium">Тема: {m.subject}</p>}
              <p className={clsx("whitespace-pre-line text-sm", !compare && "line-clamp-6")}>{m.body}</p>
              {m.personalization.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.personalization.slice(0, compare ? 20 : 3).map((x, i) => (
                    <Badge key={i} tone={x.confidence === "high" ? "ok" : "info"} title={x.claim}>
                      {x.claim.length > 40 ? x.claim.slice(0, 40) + "…" : x.claim}
                    </Badge>
                  ))}
                </div>
              )}
              {(m.assumptions.length > 0 || m.warnings.length > 0) && (
                <p className="flex items-start gap-1 text-[11px] text-warn">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {m.assumptions.length > 0 && `Предположений: ${m.assumptions.length}. `}
                  {m.warnings.length > 0 && `Предупреждений: ${m.warnings.length}.`}
                </p>
              )}
              <Button size="sm" className="mt-auto" variant={selectedId === m.id ? "primary" : "secondary"} icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onSelect(m.id)}>
                {selectedId === m.id ? "В редакторе" : "Редактировать"}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

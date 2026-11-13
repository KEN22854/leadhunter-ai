"use client";
import { AlertTriangle, CheckCircle2, HelpCircle, Link2, ShieldAlert } from "lucide-react";
import { Badge, SectionTitle } from "@/components/ui";
import { useApi } from "@/lib/client-api";
import { SERVICES } from "@/lib/domain";
import { useClient } from "../context";
import type { AIMessage, Source } from "../types";

const CONF: Record<string, string> = { high: "высокая", medium: "средняя", low: "низкая" };

/** Блок «Почему ИИ составил именно это сообщение?» */
export function AIPersonalizationEvidence({ message }: { message: AIMessage }) {
  const { clientId, bundle } = useClient();
  const { data } = useApi<{ sources: Source[] }>(`/api/clients/${clientId}/sources`);
  const srcById = new Map((data?.sources ?? []).map((s) => [s.id, s]));
  const contact = bundle.client.contacts.find((c) => c.id === message.contactId);
  const isAI = message.variantKey !== "manual";

  if (!isAI)
    return (
      <section className="card">
        <SectionTitle>Почему ИИ составил именно это сообщение?</SectionTitle>
        <p className="text-sm text-muted">Сообщение создано вручную или из шаблона — автоматической персонализации нет. Проверьте факты перед отправкой.</p>
      </section>
    );

  return (
    <section className="card space-y-4">
      <SectionTitle>Почему ИИ составил именно это сообщение?</SectionTitle>
      <div>
        <p className="mb-2 text-xs font-semibold text-muted">Использованные факты о компании</p>
        {message.personalization.length ? (
          <ul className="space-y-2 text-sm">
            {message.personalization.map((p, i) => {
              const src = p.sourceDbId ? srcById.get(p.sourceDbId) : undefined;
              return (
                <li key={i} className="flex items-start gap-2">
                  {src ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
                  <div className="min-w-0">
                    <p>{p.claim}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge tone={p.confidence === "high" ? "ok" : p.confidence === "medium" ? "warn" : "neutral"}>уверенность: {CONF[p.confidence] ?? p.confidence}</Badge>
                      {src ? (
                        <span className="inline-flex items-center gap-1">
                          <Link2 className="h-3 w-3" />
                          {src.sourceUrl ? (
                            <a className="text-accent2 hover:underline" href={src.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                              {src.title || src.sourceUrl}
                            </a>
                          ) : (
                            src.title || "внесено вручную"
                          )}
                        </span>
                      ) : (
                        <span className="text-warn">источник не найден — считать предположением</span>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Модель не использовала конкретных фактов о компании.</p>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-muted">Выбранная услуга</p>
        <p className="text-sm">
          <b>{SERVICES[message.service as keyof typeof SERVICES] ?? message.service}</b>
          {message.evidence?.serviceRationale && <span className="text-muted"> — {message.evidence.serviceRationale}</span>}
        </p>
      </div>
      {message.assumptions.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted">Предположения (не подтверждены)</p>
          <ul className="space-y-1 text-sm">
            {message.assumptions.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> {a}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(message.evidence?.toVerify?.length || message.warnings.length || (contact && contact.verificationStatus !== "confirmed" && contact.verificationStatus !== "formal")) ? (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted">Проверить перед отправкой</p>
          <ul className="space-y-1 text-sm">
            {contact && contact.verificationStatus !== "confirmed" && contact.verificationStatus !== "formal" && (
              <li className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> Контакт {contact.value} не проверен.
              </li>
            )}
            {(message.evidence?.toVerify ?? []).map((t, i) => (
              <li key={`v${i}`} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> {t}
              </li>
            ))}
            {message.warnings.map((w, i) => (
              <li key={`w${i}`} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[11px] text-muted">
        Модель: {message.model || "—"} · промпт: {message.promptVersion || "—"}
      </p>
    </section>
  );
}

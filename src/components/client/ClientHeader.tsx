"use client";
import { useState } from "react";
import { Archive, ArchiveRestore, Copy, ExternalLink, FileText, Globe, ListPlus, MapPin, MessageSquarePlus } from "lucide-react";
import { Badge, Button, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError } from "@/lib/client-api";
import { CLIENT_STATUSES, CONTACT_TYPES, PRIORITIES, scoreCategory } from "@/lib/domain";
import { useClient } from "./context";
import { ScoreRing } from "./ScoreRing";
import { LeadScorePanel } from "./LeadScorePanel";

export function ClientHeader() {
  const { bundle, clientId, reloadBundle, goTab, openTask } = useClient();
  const { client, score } = bundle;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [logoOk, setLogoOk] = useState(true);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const usable = client.contacts.filter((c) => !c.doNotContact && c.verificationStatus !== "invalid" && c.type !== "website");
  const primary = usable.find((c) => c.type === "email") ?? usable[0];

  async function patch(data: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      await api("PATCH", `/api/clients/${clientId}`, data);
      toast("success", ok);
      await reloadBundle();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function copyContact() {
    if (!primary) return;
    try {
      await navigator.clipboard.writeText(primary.value);
      toast("success", `Скопировано: ${primary.value}`);
    } catch {
      toast("error", "Буфер обмена недоступен");
    }
  }

  const initials = client.companyName.replace(/[«»"()]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const cat = score ? scoreCategory(score.score) : null;
  const site = client.website ? (/^https?:\/\//.test(client.website) ? client.website : `https://${client.website}`) : "";

  return (
    <section className="card space-y-4" aria-label="Заголовок карточки клиента">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {client.logoUrl && logoOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={client.logoUrl} alt="" onError={() => setLogoOk(false)} className="h-14 w-14 shrink-0 rounded-xl border border-border object-cover" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent/40 to-accent2/30 text-lg font-semibold" aria-hidden>
              {initials || "?"}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold leading-tight">{client.companyName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {client.industry && <span>{client.industry}</span>}
              {(client.city || client.country) && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {[client.city, client.region, client.country].filter(Boolean).join(", ")}
                </span>
              )}
              {site && (
                <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent2 hover:underline">
                  <Globe className="h-3 w-3" /> {client.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cat && <Badge tone={score!.score >= 70 ? "ok" : score!.score >= 40 ? "warn" : "danger"}>{cat.label}</Badge>}
              {!cat && <Badge>{PRIORITIES[client.priority as keyof typeof PRIORITIES] ?? client.priority}</Badge>}
              {client.archived && <Badge tone="warn">В архиве</Badge>}
              {client.doNotContact && <Badge tone="danger">Не связываться</Badge>}
              {bundle.conflicts > 0 && (
                <button onClick={() => goTab("sources")}>
                  <Badge tone="warn">Конфликтов данных: {bundle.conflicts}</Badge>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:flex-col sm:items-end">
          <button onClick={() => setScoreOpen(true)} className="flex items-center gap-2 rounded-xl p-1 hover:bg-surface2" aria-label="Подробнее о Lead Score">
            <ScoreRing score={score?.score ?? null} size={58} />
            <span className="text-left text-xs text-muted sm:hidden">Lead Score</span>
          </button>
          <div className="w-full min-w-[180px] sm:w-48">
            <label className="sr-only" htmlFor="status">
              Статус лида
            </label>
            <Select id="status" value={client.status} disabled={busy} onChange={(v) => patch({ status: v }, "Статус изменён")} options={CLIENT_STATUSES} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" icon={<MessageSquarePlus className="h-3.5 w-3.5" />} onClick={() => goTab("messages")}>
          Создать сообщение
        </Button>
        <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => goTab("proposals")}>
          Создать КП
        </Button>
        <Button size="sm" icon={<ListPlus className="h-3.5 w-3.5" />} onClick={() => openTask()}>
          Добавить задачу
        </Button>
        <Button size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />} disabledReason={site ? undefined : "Сайт не указан"} onClick={() => window.open(site, "_blank", "noopener,noreferrer")}>
          Открыть сайт
        </Button>
        <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} disabledReason={primary ? undefined : "Нет пригодных контактов"} onClick={copyContact} title={primary ? `${CONTACT_TYPES[primary.type as keyof typeof CONTACT_TYPES]}: ${primary.value}` : undefined}>
          Скопировать контакт
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          icon={client.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
          onClick={() => (client.archived ? patch({ archived: false }, "Восстановлено из архива") : setConfirmArchive(true))}
        >
          {client.archived ? "Из архива" : "Архивировать"}
        </Button>
      </div>

      <Modal open={scoreOpen} onClose={() => setScoreOpen(false)} title="Lead Score" wide>
        <LeadScorePanel />
      </Modal>
      <Modal open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Архивировать карточку?">
        <p className="text-sm text-muted">Карточка пропадёт из списка активных лидов. Данные сохранятся, восстановить можно из раздела «Архив».</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmArchive(false)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              setConfirmArchive(false);
              await patch({ archived: true }, "Карточка архивирована");
            }}
          >
            Архивировать
          </Button>
        </div>
      </Modal>
    </section>
  );
}

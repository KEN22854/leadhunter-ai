"use client";
import Link from "next/link";
import { Megaphone, Search } from "lucide-react";
import { Badge, EmptyState, ErrorState, SkeletonBlock } from "@/components/ui";
import { fmtDate, useApi } from "@/lib/client-api";
import { CAMPAIGN_STATUS } from "@/components/campaigns/status";

type Row = { id: string; name: string; status: string; createdAt: string; dailyLimit: number; stats: Record<string, number> };

export default function CampaignsPage() {
  const { data, error, loading, reload } = useApi<{ campaigns: Row[] }>("/api/campaigns");
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">Кампании</h1>
        <p className="text-sm text-muted">Пакетная отправка писем с референсами: одобряете один раз — письма уходят сами, с паузами и дневным лимитом.</p>
      </div>
      {loading && !data ? (
        <SkeletonBlock rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.campaigns.length ? (
        <EmptyState
          icon={<Megaphone className="h-6 w-6" />}
          title="Кампаний пока нет"
          text="Найдите заведения в «Поиске лидов», добавьте их в CRM и создайте кампанию."
          action={
            <Link href="/discover" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm hover:border-accent/60">
              <Search className="h-4 w-4" /> К поиску лидов
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-2">
          {data.campaigns.map((c) => {
            const total = Object.values(c.stats).reduce((a, b) => a + b, 0);
            const st = CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.draft;
            return (
              <li key={c.id}>
                <Link href={`/campaigns/${c.id}`} className="card flex flex-wrap items-center gap-3 p-3 transition hover:border-accent/50">
                  <Megaphone className="h-5 w-5 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{c.name}</p>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <p className="text-xs text-muted">
                      Создана {fmtDate(c.createdAt)} · писем {total} · отправлено {c.stats.sent ?? 0} · ответили {c.stats.replied ?? 0} · в очереди {c.stats.queued ?? 0}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

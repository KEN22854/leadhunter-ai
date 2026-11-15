"use client";
import { useState } from "react";
import { ErrorState, Notice, Select, SkeletonBlock } from "@/components/ui";
import { SignalsHeader } from "@/components/signals/shared";
import { useApi } from "@/lib/client-api";

type Bucket = { key: string; label: string; leads: number; hot: number; contacted: number; replies: number; positive: number; conversion: number };
type Data = {
  periodDays: number;
  totals: { leads: number; hot: number; warm: number; signals: number; draftsPrepared: number; attemptsPrepared: number; confirmedSends: number; leadsContacted: number; replies: number; positive: number; declined: number; failed: number; conversion: number; avgHoursToContact: number | null };
  bySource: Bucket[];
  byService: Bucket[];
  byCountry: Bucket[];
  signalsBySource: { key: string; label: string; count: number }[];
};

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-3" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: Bucket[] }) {
  const max = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <section className="card p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {!rows.length ? (
        <p className="text-sm text-muted">Нет данных</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Сегмент</th>
                <th className="py-1 pr-2 font-medium">Лиды</th>
                <th className="py-1 pr-2 text-right font-medium">Горячие</th>
                <th className="py-1 pr-2 text-right font-medium">Связались</th>
                <th className="py-1 pr-2 text-right font-medium">Ответы</th>
                <th className="py-1 pr-2 text-right font-medium">Положит.</th>
                <th className="py-1 text-right font-medium">Конверсия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border/60">
                  <td className="py-1.5 pr-2">{r.label}</td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface2">
                        <div className="h-full bg-accent" style={{ width: `${(r.leads / max) * 100}%` }} />
                      </div>
                      <span className="tabular-nums">{r.leads}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.hot}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.contacted}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.replies}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.positive}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.contacted ? `${r.conversion}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState("90");
  const { data, error, loading, reload } = useApi<Data>(`/api/signals/analytics?days=${days}`);
  const t = data?.totals;
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <SignalsHeader title="Аналитика обращений" text="Воронка от обнаружения до ответа. Учитываются только подтверждённые факты." action={<Select className="w-40" value={days} onChange={setDays} options={{ "7": "7 дней", "30": "30 дней", "90": "90 дней", "365": "Год" }} />} />
      {loading && !data ? (
        <SkeletonBlock rows={6} />
      ) : error || !data || !t ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
            <Stat label="Найдено лидов" value={t.leads} hint={`${t.signals} публикаций`} />
            <Stat label="Горячих заказов" value={t.hot} hint={`тёплых: ${t.warm}`} />
            <Stat label="Подготовлено сообщений" value={t.draftsPrepared} hint={`обращений подготовлено: ${t.attemptsPrepared}`} />
            <Stat label="Подтверждённых отправок" value={t.confirmedSends} hint={`лидов: ${t.leadsContacted}${t.failed ? `, ошибок: ${t.failed}` : ""}`} />
            <Stat label="Ответов" value={t.replies} hint={`положительных: ${t.positive}, отказов: ${t.declined}`} />
            <Stat label="Конверсия" value={t.leadsContacted ? `${t.conversion}%` : "—"} hint={t.avgHoursToContact !== null ? `до первого контакта ≈ ${t.avgHoursToContact < 48 ? `${t.avgHoursToContact} ч` : `${Math.round(t.avgHoursToContact / 24)} дн.`}` : "нет контактов"} />
          </div>
          <Notice tone="info">Подготовленные сообщения не считаются отправленными: отправка засчитывается после вашего подтверждения (ручной канал) или ответа SMTP (email). Прочтение не учитывается — площадки его не подтверждают. Конверсия = положительные ответы / лиды, с которыми связались.</Notice>
          <Table title="По источникам" rows={data.bySource} />
          <Table title="По услугам" rows={data.byService} />
          <Table title="По странам" rows={data.byCountry} />
        </>
      )}
    </div>
  );
}

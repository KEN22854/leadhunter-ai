"use client";
import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import { Badge, Button, Field, InlineError, Modal, Notice, Select, clsx } from "@/components/ui";
import { api, ApiClientError } from "@/lib/client-api";
import { ACCESS_UI, type SignalsMeta } from "./shared";

const splitList = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

export function CampaignModal({ open, onClose, meta, onCreated }: { open: boolean; onClose: () => void; meta: SignalsMeta | null; onCreated: (id: string) => void }) {
  const defaults = useMemo(() => (meta?.sources ?? []).filter((s) => s.readiness.ready && s.key !== "custom_rss" && s.key !== "telegram" && s.group !== "business").map((s) => s.key), [meta]);
  const [f, setF] = useState({
    name: "",
    service: "website",
    country: "",
    city: "",
    languages: ["ru", "en"],
    sources: null as string[] | null,
    keywords: "",
    excludeWords: "",
    businessType: "",
    orderType: "any",
    periodDays: "14",
    maxResults: "",
    minScore: "40",
    schedule: "once",
    feeds: "",
    telegram: "",
    reddit: "",
    discord: "",
    useAI: true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sources = f.sources ?? defaults;
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const svc = meta?.services[f.service];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ campaign: { id: string } }>("POST", "/api/signals/campaigns", {
        name: f.name || `${svc?.label ?? f.service}${f.city ? `, ${f.city}` : ""}`,
        service: f.service,
        country: f.country,
        city: f.city,
        languages: f.languages,
        sources,
        keywords: splitList(f.keywords),
        excludeWords: splitList(f.excludeWords),
        businessType: f.businessType,
        orderType: f.orderType,
        periodDays: Number(f.periodDays) || 14,
        maxResults: f.maxResults ? Number(f.maxResults) : null,
        minScore: Number(f.minScore) || 0,
        schedule: f.schedule,
        feeds: splitList(f.feeds),
        channels: { telegram: splitList(f.telegram), reddit: splitList(f.reddit), discord: splitList(f.discord) },
        useAI: f.useAI,
        runNow: true,
      });
      onCreated(r.campaign.id);
      onClose();
    } catch (e) {
      setErr(e instanceof ApiClientError ? `${e.message}${Array.isArray(e.details) ? ": " + (e.details as { message: string }[]).map((d) => d.message).join("; ") : ""}` : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const groups = Object.entries(meta?.groups ?? {});
  return (
    <Modal open={open} onClose={onClose} title="Новая кампания поиска спроса" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ваша услуга">{(id) => <Select id={id} value={f.service} onChange={(v) => setF({ ...f, service: v })} options={Object.fromEntries(Object.entries(meta?.services ?? {}).map(([k, v]) => [k, v.label]))} />}</Field>
          <Field label="Название" hint="Необязательно">{(id) => <input id={id} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={svc?.label} />}</Field>
          <Field label="Страна" hint="Необязательно">{(id) => <input id={id} className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} placeholder="Любая" />}</Field>
          <Field label="Город" hint="Необязательно — без гео ищем везде">{(id) => <input id={id} className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Любой" />}</Field>
          <Field label="Ключевые слова" hint="Через запятую. Добавляются к фразам услуги, учитываются в поиске и оценке">
            {(id) => <input id={id} className="input" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} placeholder="кофейня, меню, доставка" />}
          </Field>
          <Field label="Исключить слова" hint="Публикации с ними отбрасываются">{(id) => <input id={id} className="input" value={f.excludeWords} onChange={(e) => setF({ ...f, excludeWords: e.target.value })} placeholder="бесплатно, за отзыв" />}</Field>
          <Field label="Тип бизнеса" hint="Для карт и оценки соответствия ЦА">{(id) => <input id={id} className="input" value={f.businessType} onChange={(e) => setF({ ...f, businessType: e.target.value })} placeholder="кофейня" />}</Field>
          <Field label="Тип заказа">{(id) => <Select id={id} value={f.orderType} onChange={(v) => setF({ ...f, orderType: v })} options={{ any: "Любой", one_time: "Разовый проект", ongoing: "На постоянной основе", launch: "Запуск бизнеса" }} />}</Field>
        </div>

        <div>
          <p className="label">Языки публикаций</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(meta?.languages ?? {}).map(([k, v]) => (
              <label key={k} className={clsx("flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm", f.languages.includes(k) ? "border-accent/60 bg-accent/10" : "border-border")}>
                <input type="checkbox" className="sr-only" checked={f.languages.includes(k)} onChange={() => setF({ ...f, languages: toggle(f.languages, k) })} />
                {v}
              </label>
            ))}
          </div>
          {svc && <p className="mt-1 text-[11px] text-muted">Фразы поиска: {f.languages.flatMap((l) => svc.queries[l] ?? []).slice(0, 6).join(" · ") || "—"}</p>}
        </div>

        <div>
          <p className="label">Источники ({sources.length})</p>
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
            {groups.map(([g, gl]) => (
              <div key={g}>
                <p className="mb-1 text-xs font-medium text-muted">{gl}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(meta?.sources ?? [])
                    .filter((s) => s.group === g && s.key !== "manual")
                    .map((s) => (
                      <label key={s.key} title={`${s.note}${s.readiness.ready ? "" : `\n${s.readiness.reason}`}`} className={clsx("flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs", sources.includes(s.key) ? "border-accent/60 bg-accent/10" : "border-border", !s.readiness.ready && "opacity-70")}>
                        <input type="checkbox" checked={sources.includes(s.key)} onChange={() => setF({ ...f, sources: toggle(sources, s.key) })} />
                        {s.label}
                        {!s.readiness.ready && <Badge tone={ACCESS_UI[s.access].tone}>{s.access === "api_key" ? "нужен ключ" : ACCESS_UI[s.access].label.toLowerCase()}</Badge>}
                      </label>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted">Источники в ручном режиме не опрашиваются автоматически — в результатах будут готовые ссылки поиска на площадке.</p>
        </div>

        {(sources.includes("telegram") || sources.includes("reddit") || sources.includes("discord") || sources.includes("custom_rss")) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {sources.includes("telegram") && <Field label="Публичные Telegram-каналы" hint="@имя или t.me/имя, через запятую">{(id) => <input id={id} className="input" value={f.telegram} onChange={(e) => setF({ ...f, telegram: e.target.value })} placeholder="@designer_jobs, @freelance_orders" />}</Field>}
            {sources.includes("reddit") && <Field label="Сабреддиты" hint="Пусто — r/forhire, r/slavelabour, r/hiring…">{(id) => <input id={id} className="input" value={f.reddit} onChange={(e) => setF({ ...f, reddit: e.target.value })} placeholder="forhire, startups" />}</Field>}
            {sources.includes("discord") && <Field label="ID каналов Discord" hint="Каналы серверов, куда добавлен ваш бот">{(id) => <input id={id} className="input" value={f.discord} onChange={(e) => setF({ ...f, discord: e.target.value })} />}</Field>}
            {sources.includes("custom_rss") && <Field label="RSS-ленты сообществ" hint="Полные URL через запятую">{(id) => <input id={id} className="input" value={f.feeds} onChange={(e) => setF({ ...f, feeds: e.target.value })} placeholder="https://example.com/feed" />}</Field>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Период, дней">{(id) => <input id={id} className="input" inputMode="numeric" value={f.periodDays} onChange={(e) => setF({ ...f, periodDays: e.target.value.replace(/\D/g, "").slice(0, 2) })} />}</Field>
          <Field label="Макс. результатов" hint="Пусто — без лимита">{(id) => <input id={id} className="input" inputMode="numeric" placeholder="∞" value={f.maxResults} onChange={(e) => setF({ ...f, maxResults: e.target.value.replace(/\D/g, "").slice(0, 4) })} />}</Field>
          <Field label="Мин. Lead Score">{(id) => <input id={id} className="input" inputMode="numeric" value={f.minScore} onChange={(e) => setF({ ...f, minScore: e.target.value.replace(/\D/g, "").slice(0, 3) })} />}</Field>
          <Field label="Запуск">{(id) => <Select id={id} value={f.schedule} onChange={(v) => setF({ ...f, schedule: v })} options={{ once: "Однократно", daily: "Ежедневно", weekly: "Еженедельно" }} />}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.useAI} onChange={(e) => setF({ ...f, useAI: e.target.checked })} />
          Уточнять намерения с помощью AI {meta && !meta.ai && <span className="text-xs text-muted">(сейчас AI не подключён — будут работать правила)</span>}
        </label>
        <Notice tone="info">Система читает только публичные данные разрешёнными способами (официальные API, RSS, страницы, открытые robots.txt), соблюдает лимиты площадок и не отправляет сообщения сама — каждое обращение вы подтверждаете вручную.</Notice>
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy} icon={<Play className="h-4 w-4" />}>
            Создать и запустить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

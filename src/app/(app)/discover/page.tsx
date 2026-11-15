"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Globe, Globe2, Loader2, MailCheck, MapPin, Megaphone, Phone, Plus, RefreshCw, Search, SlidersHorizontal, Square, Trash2, X } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Notice, Select, SkeletonBlock, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { AuditScore, AuditView, OPPORTUNITY } from "@/components/discovery/AuditView";
import { CreateCampaignModal } from "@/components/campaigns/CreateCampaignModal";
import { Pager } from "@/components/ui/Pager";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import type { SiteAudit } from "@/lib/discovery/audit";

type SearchRow = {
  id: string;
  categoryLabel: string;
  city: string;
  country: string;
  scope: "city" | "country" | "world";
  limitN: number;
  status: "running" | "done" | "failed" | "stopped";
  error: string;
  createdAt: string;
  resultCount: number;
  withEmail: number;
};
type Email = { email: string; source: "osm" | "site"; url: string; sameDomain: boolean };
type Result = {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  website: string;
  phone: string;
  emails: Email[] | null;
  enrichStatus: "pending" | "running" | "done" | "no_site" | "failed";
  enrichError: string;
  audit: SiteAudit | null;
  auditScore: number | null;
  clientId: string | null;
  externalId: string;
  rank: number;
  rankNote: string;
};
type Detail = {
  search: SearchRow;
  results: Result[];
  page: number;
  pageSize: number;
  pages: number;
  filtered: number;
  progress: { total: number; pending: number; withEmail: number; imported: number };
  importedClientIds: string[];
  countries: { country: string; count: number }[];
};

const scopeLabel = (s: Pick<SearchRow, "scope" | "city" | "country">) => (s.scope === "world" ? "Весь мир" : s.scope === "country" ? `Вся страна: ${s.country}` : [s.city, s.country].filter(Boolean).join(", "));

export default function DiscoverPage() {
  const { data: cats } = useApi<{ categories: { key: string; label: string }[] }>("/api/discovery/categories");
  const { data: list, reload: reloadList } = useApi<{ searches: SearchRow[] }>("/api/discovery/searches");
  const [activeId, setActiveId] = useState<string | null>(null);
  const toast = useToast();
  const [f, setF] = useState({ category: "cafe", customTag: "", city: "", country: "", limit: "", onlyWithContacts: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scope = f.city.trim() ? "city" : f.country.trim() ? "country" : "world";

  useEffect(() => {
    if (!activeId && list?.searches.length) setActiveId(list.searches[0].id);
  }, [list, activeId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ search: SearchRow }>("POST", "/api/discovery/searches", {
        category: f.category,
        customTag: f.category === "custom" ? f.customTag : undefined,
        city: f.city,
        country: f.country,
        limit: f.limit ? Number(f.limit) : null,
        onlyWithContacts: f.onlyWithContacts,
      });
      setActiveId(r.search.id);
      toast("success", "Поиск запущен");
      await reloadList();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Поиск лидов</h1>
        <p className="text-sm text-muted">Предприятия из открытых карт OpenStreetMap — в городе, по всей стране или по всему миру. Email с их сайтов и автоматический аудит «что улучшить».</p>
      </div>

      <form onSubmit={submit} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_130px_auto] lg:items-end">
        <Field label="Что ищем">
          {(id) => <Select id={id} value={f.category} onChange={(v) => setF({ ...f, category: v })} options={[...(cats?.categories ?? []).map((c) => ({ value: c.key, label: c.label })), { value: "custom", label: "Своя категория (тег OSM)…" }]} />}
        </Field>
        <Field label="Страна" hint="Необязательно">
          {(id) => <input id={id} className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} placeholder="Любая" />}
        </Field>
        <Field label="Город" hint="Необязательно">
          {(id) => <input id={id} className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Любой" />}
        </Field>
        <Field label="Максимум" hint="Пусто — без лимита">
          {(id) => <input id={id} className="input" inputMode="numeric" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="∞" />}
        </Field>
        <Button type="submit" variant="primary" icon={<Search className="h-4 w-4" />} loading={busy}>
          Найти
        </Button>
        {f.category === "custom" && (
          <Field label="Тег OpenStreetMap" hint="Например: amenity=ice_cream или shop~tea|coffee (регулярные выражения — только в пределах города)" className="sm:col-span-2">
            {(id) => <input id={id} className="input" value={f.customTag} onChange={(e) => setF({ ...f, customTag: e.target.value })} placeholder="amenity=ice_cream" />}
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:col-span-2 lg:col-span-5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs">
            {scope === "world" ? <Globe2 className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
            {scope === "world" ? "Охват: весь мир" : scope === "country" ? `Охват: вся страна (${f.country})` : `Охват: город ${f.city}`}
            {!f.limit && " · без лимита, партиями"}
          </span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.onlyWithContacts} onChange={(e) => setF({ ...f, onlyWithContacts: e.target.checked })} />
            Только с сайтом или email
          </label>
        </div>
        <div className="sm:col-span-2 lg:col-span-5">
          <InlineError text={err} />
        </div>
      </form>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-2">
          <p className="h-section px-1">История поиска</p>
          {!list ? (
            <SkeletonBlock rows={3} />
          ) : !list.searches.length ? (
            <p className="px-1 text-sm text-muted">Поисков ещё не было.</p>
          ) : (
            <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {list.searches.map((s) => (
                <li key={s.id} className="shrink-0 lg:shrink">
                  <button onClick={() => setActiveId(s.id)} className={clsx("card w-60 p-3 text-left text-sm transition lg:w-full", activeId === s.id ? "ring-1 ring-accent/50" : "hover:ring-1 hover:ring-accent/20")}>
                    <p className="truncate font-medium">{s.categoryLabel}</p>
                    <p className="truncate text-xs text-muted">
                      {scopeLabel(s)} · {fmtDate(s.createdAt)}
                    </p>
                    <p className="mt-1 text-xs">
                      {s.status === "running" ? (
                        <span className="inline-flex items-center gap-1 text-text">
                          <Loader2 className="h-3 w-3 animate-spin" /> ищем… найдено {s.resultCount}
                        </span>
                      ) : s.status === "failed" ? (
                        <span className="text-danger">ошибка</span>
                      ) : (
                        <span className="text-muted">
                          {s.status === "stopped" && "остановлен · "}найдено {s.resultCount}, с email {s.withEmail}
                        </span>
                      )}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="min-w-0">
          {activeId ? (
            <SearchDetail
              key={activeId}
              id={activeId}
              onChanged={reloadList}
              onDeleted={() => {
                setActiveId(null);
                void reloadList();
              }}
            />
          ) : (
            <EmptyState title="Запустите поиск" text="Например: «Кофейни и кафе» без города и страны — по всему миру, отсортировано по популярности и возможности написать." />
          )}
        </section>
      </div>
      <p className="text-[11px] text-muted">
        Данные о заведениях © участники{" "}
        <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap
        </a>{" "}
        (ODbL). Email берутся только из открытых источников — тегов OSM и страниц сайта компании; адреса не угадываются. Рейтинг: возможность написать (email › сайт › телефон › соцсети), популярность (бренд, Wikidata, полнота карточки) и известность (importance Nominatim); отзывов и звёзд в OSM нет.
      </p>
    </div>
  );
}

type Filters = { q: string; contact: string; opportunity: string; status: string; imported: string; country: string; minRank: string; sort: string; pageSize: string };
const DEFAULT_FILTERS: Filters = { q: "", contact: "", opportunity: "", status: "", imported: "", country: "", minRank: "", sort: "rank", pageSize: "50" };

function SearchDetail({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [flt, setFlt] = useState<Filters>(DEFAULT_FILTERS);
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const params = new URLSearchParams(Object.entries({ ...flt, page: String(page) }).filter(([, v]) => v) as [string, string][]);
  const { data, error, loading, reload } = useApi<Detail>(`/api/discovery/searches/${id}?${params.toString()}`);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [campaignFor, setCampaignFor] = useState<string[] | null>(null);
  const set = (patch: Partial<Filters>) => {
    setFlt((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const activeFilters = Object.entries(flt).filter(([k, v]) => v && !["sort", "pageSize"].includes(k) && v !== DEFAULT_FILTERS[k as keyof Filters]).length;

  const active = data && (data.search.status === "running" || data.progress.pending > 0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      void reload();
      onChanged();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, params.toString()]);

  if (loading && !data) return <SkeletonBlock rows={6} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const { search, progress, results: rows } = data;

  const selectable = rows.filter((r) => !r.clientId);
  const allSel = selectable.length > 0 && selectable.every((r) => sel.has(r.id));
  const toggle = (rid: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(rid)) n.delete(rid);
      else n.add(rid);
      return n;
    });

  async function importSelected() {
    setImporting(true);
    try {
      const r = await api<{ created: string[]; skipped: unknown[] }>("POST", "/api/discovery/import", { resultIds: [...sel] });
      toast("success", `Добавлено в CRM: ${r.created.length}${r.skipped.length ? `, пропущено: ${r.skipped.length}` : ""}`);
      setSel(new Set());
      await reload();
      if (r.created.length) setCampaignFor(r.created);
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setImporting(false);
    }
  }
  async function reEnrich(rid: string) {
    try {
      await api("POST", `/api/discovery/results/${rid}/enrich`);
      await reload();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    }
  }
  async function stop() {
    await api("POST", `/api/discovery/searches/${id}/stop`).catch(() => {});
    toast("info", "Останавливаем после текущей страницы — найденное сохранится");
    await reload();
  }
  async function del() {
    if (!confirm("Удалить этот поиск и его результаты? Добавленные в CRM лиды останутся.")) return;
    await api("DELETE", `/api/discovery/searches/${id}`).catch(() => {});
    onDeleted();
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight">{search.categoryLabel}</p>
            <p className="text-sm text-muted">
              {scopeLabel(search)} · {search.limitN ? `лимит ${search.limitN}` : "без лимита"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {search.status === "running" && (
              <Button size="sm" icon={<Square className="h-3.5 w-3.5" />} onClick={stop}>
                Остановить
              </Button>
            )}
            {data.importedClientIds.length > 0 && (
              <Button size="sm" icon={<Megaphone className="h-3.5 w-3.5" />} onClick={() => setCampaignFor(data.importedClientIds)}>
                Кампания из добавленных ({data.importedClientIds.length})
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={del} aria-label="Удалить поиск" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Найдено", progress.total],
            ["С email", progress.withEmail],
            ["Проверяется сайтов", progress.pending],
            ["В CRM", progress.imported],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl border border-border px-3 py-2">
              <p className="text-[11px] text-muted">{k}</p>
              <p className="text-xl font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        {search.status === "running" && (
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> {search.scope === "city" ? "Ищем заведения в городе — обычно 10–60 секунд…" : "Собираем партиями (1 запрос в секунду, по правилам OpenStreetMap). Результаты появляются по мере поиска."}
          </p>
        )}
        {search.status === "failed" && <Notice tone="danger">{search.error || "Поиск не удался"}</Notice>}
        {search.status !== "failed" && search.error && <Notice tone="warn">{search.error}</Notice>}
        {progress.pending > 0 && progress.total > 0 && (
          <div>
            <p className="mb-1 text-xs text-muted">
              Проверка сайтов и поиск email (сначала самые перспективные): {progress.total - progress.pending} из {progress.total}
            </p>
            <div className="h-1 overflow-hidden rounded-full bg-surface2">
              <div className="h-full bg-accent transition-all" style={{ width: `${((progress.total - progress.pending) / Math.max(progress.total, 1)) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Фильтры */}
      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex min-w-[200px] flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: qInput.trim() });
            }}
          >
            <input className="input" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Название, адрес или сайт" aria-label="Поиск по результатам" />
            <Button type="submit" icon={<Search className="h-4 w-4" />} aria-label="Искать" />
          </form>
          <Select
            className="w-56"
            value={flt.sort}
            onChange={(v) => set({ sort: v })}
            options={{ rank: "По рейтингу (популярность и контакты)", worst_site: "Сначала худшие сайты", best_site: "Сначала лучшие сайты", name: "По названию", newest: "Сначала новые" }}
          />
          <Button icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setShowFilters(!showFilters)}>
            Фильтры{activeFilters ? ` (${activeFilters})` : ""}
          </Button>
          {activeFilters > 0 && (
            <Button
              variant="ghost"
              icon={<X className="h-4 w-4" />}
              onClick={() => {
                setFlt({ ...DEFAULT_FILTERS, sort: flt.sort, pageSize: flt.pageSize });
                setQInput("");
                setPage(1);
              }}
            >
              Сбросить
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["", "Все"],
            ["email", "С email"],
            ["website", "С сайтом"],
            ["phone", "С телефоном"],
            ["any_contact", "Любой контакт"],
            ["no_site", "Без сайта"],
          ].map(([v, l]) => (
            <button key={v} type="button" className="chip" data-active={flt.contact === v} onClick={() => set({ contact: v })}>
              {l}
            </button>
          ))}
        </div>
        {showFilters && (
          <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Что улучшить на сайте">
              {(fid) => <Select id={fid} value={flt.opportunity} onChange={(v) => set({ opportunity: v })} options={{ "": "Не важно", high: "Много", "high,medium": "Много или есть", medium: "Есть", low: "Мало" }} />}
            </Field>
            <Field label="Проверка сайта">
              {(fid) => <Select id={fid} value={flt.status} onChange={(v) => set({ status: v })} options={{ "": "Любая", done: "Проверен", pending: "В очереди", no_site: "Нет сайта", failed: "Не открылся" }} />}
            </Field>
            <Field label="CRM">
              {(fid) => <Select id={fid} value={flt.imported} onChange={(v) => set({ imported: v })} options={{ "": "Все", no: "Ещё не в CRM", yes: "Уже в CRM" }} />}
            </Field>
            <Field label="Минимальный рейтинг">
              {(fid) => <Select id={fid} value={flt.minRank} onChange={(v) => set({ minRank: v })} options={{ "": "Любой", "30": "от 30", "50": "от 50", "60": "от 60", "75": "от 75" }} />}
            </Field>
            {data.countries.length > 1 && (
              <Field label="Страна">
                {(fid) => <Select id={fid} value={flt.country} onChange={(v) => set({ country: v })} options={[{ value: "", label: "Все страны" }, ...data.countries.map((c) => ({ value: c.country, label: `${c.country} (${c.count})` }))]} />}
              </Field>
            )}
            <Field label="На странице">
              {(fid) => <Select id={fid} value={flt.pageSize} onChange={(v) => set({ pageSize: v })} options={{ "25": "25", "50": "50", "100": "100" }} />}
            </Field>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set([...sel, ...selectable.map((r) => r.id)]))} aria-label="Выбрать все на странице" />
            Выбрать на странице
          </label>
          <span className="text-xs text-muted">
            Показано {rows.length} из {data.filtered}
            {data.filtered !== progress.total && ` (всего ${progress.total})`}
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} loading={importing} disabledReason={sel.size ? undefined : "Выберите заведения"} onClick={importSelected}>
            В CRM ({sel.size})
          </Button>
        </div>
      </div>

      {!rows.length ? (
        <EmptyState title={search.status === "running" ? "Ищем…" : "Нет подходящих заведений"} text={activeFilters ? "Ослабьте фильтры или сбросьте их." : search.status === "running" ? "Результаты появятся через несколько секунд." : "Попробуйте другую категорию или охват."} />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const expanded = open === r.id;
            return (
              <li key={r.id} className="card p-3">
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" checked={sel.has(r.id)} disabled={Boolean(r.clientId)} onChange={() => toggle(r.id)} aria-label={`Выбрать ${r.name}`} />
                  <div className="flex shrink-0 flex-col items-center gap-1" title={`Рейтинг выдачи: ${r.rankNote}`}>
                    <span className="flex h-9 w-11 items-center justify-center rounded-xl bg-accent text-sm font-semibold tabular-nums text-on-accent">{r.rank}</span>
                    <span className="text-[9px] uppercase tracking-wider text-muted">рейтинг</span>
                  </div>
                  <AuditScore score={r.auditScore} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{r.name}</p>
                      {r.audit && <Badge tone={OPPORTUNITY[r.audit.opportunity].tone}>{OPPORTUNITY[r.audit.opportunity].label}</Badge>}
                      {(r.enrichStatus === "pending" || r.enrichStatus === "running") && r.website && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <Loader2 className="h-3 w-3 animate-spin" /> проверка сайта
                        </span>
                      )}
                      {r.enrichStatus === "failed" && (
                        <Badge tone="warn" title={r.enrichError}>
                          сайт не открылся
                        </Badge>
                      )}
                      {r.clientId && (
                        <Link href={`/clients/${r.clientId}?tab=reference`} className="text-xs underline underline-offset-2">
                          в CRM →
                        </Link>
                      )}
                    </div>
                    <p className="text-[11px] text-muted">{r.rankNote}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      {(r.address || r.city || r.country) && (
                        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                          <MapPin className="h-3 w-3" /> {[r.address, r.city, search.scope !== "city" ? r.country : ""].filter(Boolean).join(", ")}
                        </span>
                      )}
                      {r.website ? (
                        <a href={/^https?:/i.test(r.website) ? r.website : `https://${r.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 max-w-full items-center gap-1 break-all hover:text-text">
                          <Globe className="h-3 w-3 shrink-0" /> {r.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Globe className="h-3 w-3" /> нет сайта
                        </span>
                      )}
                      {r.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {r.phone}
                        </span>
                      )}
                    </div>
                    {r.emails?.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {r.emails.slice(0, 4).map((e) => (
                          <span key={e.email} className="inline-flex max-w-full items-center gap-1 break-all rounded-lg border border-border bg-surface2 px-1.5 py-0.5 text-xs" title={`${e.source === "osm" ? "Из OpenStreetMap" : "Со страницы"} ${e.url}`}>
                            <MailCheck className={clsx("h-3 w-3", e.sameDomain ? "text-ok" : "text-muted")} /> {e.email}
                          </span>
                        ))}
                      </div>
                    ) : r.enrichStatus === "done" || r.enrichStatus === "no_site" ? (
                      <p className="mt-1 text-xs text-muted">email не найден</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {r.audit && (
                      <Button size="sm" variant="ghost" icon={expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} onClick={() => setOpen(expanded ? null : r.id)}>
                        Аудит
                      </Button>
                    )}
                    {(r.enrichStatus === "failed" || r.enrichStatus === "done") && r.website && <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => reEnrich(r.id)} aria-label="Проверить заново" />}
                  </div>
                </div>
                {expanded && r.audit && (
                  <div className="mt-3 border-t border-border pt-3">
                    <AuditView audit={r.audit} compact />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data.pages > 1 && <Pager page={data.page} pages={data.pages} onPage={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}

      <CreateCampaignModal
        clientIds={campaignFor ?? []}
        defaultName={`${search.categoryLabel}, ${scopeLabel(search)}`}
        open={Boolean(campaignFor)}
        onClose={() => setCampaignFor(null)}
        onCreated={(cid) => router.push(`/campaigns/${cid}`)}
      />
    </div>
  );
}

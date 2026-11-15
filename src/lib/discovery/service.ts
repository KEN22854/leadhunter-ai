import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../api";
import type { CurrentUser } from "../auth";
import { formalCheck } from "../contacts";
import { normalizeContact, normalizeDomain } from "../normalize";
import { recalcScore } from "../scoring";
import { logInteraction } from "../timeline";
import { fetchPublicPage, type FetchedPage } from "../webfetch";
import { auditSite, socialHost, type SiteAudit } from "./audit";
import { CATEGORIES, categoryKind, customFilter, type CategoryKind } from "./categories";
import { extractEmails, rankEmails, type FoundEmail } from "./emails";
import { DiscoveryError, filtersToPairs, findPlaces, geocodeCountry, nominatimPage, nominatimRequestBudget, osmUrl, resolvePlace, type GeoArea, type Place } from "./osm";
import { contactPoints, opportunityPoints, rankPlace, WORLD_COUNTRIES } from "./rank";

// ---------- Поиск ----------
// Охват: город (Overpass по границе города, резерв — Nominatim) · страна · весь мир (Nominatim постранично).
// Лимит не обязателен: без него поиск идёт партиями, пока источник не исчерпан, пользователь не остановит
// или не исчерпан бюджет честного использования публичного Nominatim (свой инстанс — NOMINATIM_URL — снимает его).
export type SearchParams = { category: string; customTag?: string; city: string; country: string; onlyWithContacts: boolean; limit: number | null };

const HARD_CAP = 5000;

export async function startSearch(user: CurrentUser, p: SearchParams) {
  let filters: string[];
  let label: string;
  if (p.category === "custom") {
    const f = customFilter(p.customTag ?? "");
    if (!f) throw new ApiError(400, "bad_filter", "Фильтр должен быть вида amenity=cafe или shop~bakery|confectionery");
    filters = [f];
    label = p.customTag!.trim();
  } else {
    const c = CATEGORIES[p.category];
    if (!c) throw new ApiError(400, "bad_category", "Неизвестная категория");
    filters = c.filters;
    label = c.label;
  }
  const scope = p.city ? "city" : p.country ? "country" : "world";
  if (scope !== "city" && !filtersToPairs(filters).length) throw new ApiError(400, "bad_filter", "Этот фильтр работает только в пределах города (поиск по стране и миру поддерживает теги вида key=value)");
  const search = await prisma.leadSearch.create({
    data: { ownerId: user.id, category: p.category, categoryLabel: label, osmFilter: filters.join(" | "), country: p.country, city: p.city, scope, limitN: p.limit ?? 0, heartbeatAt: new Date() },
  });
  // Запрос к OSM может идти минутами — выполняем в фоне, UI опрашивает статус
  void runSearch(search.id, user.id, filters, p).catch(() => {});
  return search;
}

type Saver = { save(places: Place[], fallback: { city: string; country: string }): Promise<number>; count(): number };

async function makeSaver(searchId: string, ownerId: string, onlyWithContacts: boolean): Promise<Saver> {
  const existing = await prisma.client.findMany({ where: { ownerId }, select: { id: true, externalId: true, website: true } });
  const byExt = new Map(existing.filter((c) => c.externalId).map((c) => [c.externalId, c.id]));
  const byDomain = new Map(existing.filter((c) => c.website).map((c) => [normalizeDomain(c.website), c.id]));
  const seenDomains = new Set<string>();
  let saved = 0;
  return {
    count: () => saved,
    async save(places, fb) {
      let n = 0;
      for (const pl of places) {
        if (onlyWithContacts && !pl.website && !pl.email) continue;
        // Сети: несколько точек с одним сайтом — оставляем одну (письмо всё равно уходит на общий адрес)
        const d = pl.website && !socialHost(pl.website) ? normalizeDomain(pl.website) : "";
        if (d) {
          if (seenDomains.has(d)) continue;
          seenDomains.add(d);
        }
        const clientId = byExt.get(pl.externalId) ?? (d ? byDomain.get(d) : undefined) ?? null;
        const email = pl.email.toLowerCase();
        const osmEmails: FoundEmail[] = email ? [{ email, source: "osm", url: osmUrl(pl.externalId), sameDomain: d ? email.endsWith("@" + d) : false, role: true }] : [];
        const r = rankPlace({ hasEmail: Boolean(email), website: pl.website, websiteIsSocial: Boolean(pl.website && socialHost(pl.website)), phone: pl.phone, hasSocial: pl.hasSocial, tags: pl.tags, importance: pl.importance });
        const res = await prisma.searchResult.upsert({
          where: { searchId_externalId: { searchId, externalId: pl.externalId } },
          update: {},
          create: {
            searchId,
            ownerId,
            externalId: pl.externalId,
            name: pl.name.slice(0, 200),
            category: pl.tags.amenity || pl.tags.shop || pl.tags.tourism || pl.tags.leisure || pl.tags.office || pl.tags.craft || "",
            address: pl.address,
            city: pl.city || fb.city,
            country: pl.tags["addr:country"] || fb.country,
            lat: pl.lat,
            lon: pl.lon,
            website: pl.website,
            phone: pl.phone,
            emails: osmEmails as unknown as Prisma.InputJsonValue,
            hasEmail: Boolean(email),
            hasWebsite: Boolean(d),
            importance: pl.importance,
            rank: r.rank,
            rankNote: r.note,
            enrichStatus: "pending",
            clientId,
            hasSocial: pl.hasSocial,
          },
        });
        if (res.createdAt.getTime() > Date.now() - 60_000) n++;
      }
      saved += n;
      return n;
    },
  };
}

async function shouldStop(searchId: string) {
  const s = await prisma.leadSearch.findUnique({ where: { id: searchId }, select: { stopRequested: true } });
  return !s || s.stopRequested;
}

async function runSearch(searchId: string, ownerId: string, filters: string[], p: SearchParams) {
  const cap = p.limit ? Math.min(p.limit, HARD_CAP) : HARD_CAP;
  const saver = await makeSaver(searchId, ownerId, p.onlyWithContacts);
  const beat = (extra: Prisma.LeadSearchUpdateInput = {}) => prisma.leadSearch.update({ where: { id: searchId }, data: { heartbeatAt: new Date(), fetched: saver.count(), total: saver.count(), ...extra } });
  let note = "";
  try {
    // Поле «Город» может содержать город, регион/штат или по ошибке страну — разбираем, что это
    let area: GeoArea | null = null;
    let resolvedCountry: { code: string; name: string } | null = null;
    if (p.city) {
      const r = await resolvePlace(p.city, p.country);
      if (r.kind === "area") area = r.area;
      else {
        resolvedCountry = { code: r.code, name: r.name };
        note = `«${p.city}» — это страна, поэтому поиск идёт по всей стране.`;
        await beat({ scope: "country", city: "", country: r.name });
      }
    }
    if (area) {
      const r = await findPlaces(area, filters, p.onlyWithContacts, Math.min(cap, 2000));
      note = r.note;
      await saver.save(r.places.slice(0, cap * 2), { city: area.city, country: area.country });
      await beat({ city: area.city, country: area.country });
    } else {
      const pairs = filtersToPairs(filters);
      const budget = nominatimRequestBudget();
      let requests = 0;
      let failures = 0;
      let lastError = "";
      let country = resolvedCountry ?? { code: "", name: "" };
      if (!resolvedCountry && p.country) {
        country = await geocodeCountry(p.country);
        await beat({ country: country.name });
      }
      if (!pairs.length) throw new DiscoveryError("Этот фильтр работает только в пределах города — укажите город");
      const isCountry = Boolean(country.code);
      // Мир: по одной-две страницы на страну (крупные рынки первыми); страна: страницы подряд до конца выдачи
      const codes = isCountry ? [country.code] : WORLD_COUNTRIES;
      const pagesPerArea = isCountry ? 25 : 2;
      outer: for (let round = 0; round < (isCountry ? 1 : 3); round++) {
        for (const code of codes) {
          for (const [k, v] of pairs) {
            const exclude: number[] = [];
            for (let page = 0; page < pagesPerArea; page++) {
              if (saver.count() >= cap) break outer;
              if (requests >= budget) {
                note = `Достигнут лимит честного использования публичного Nominatim (${budget} запросов на поиск). Найденное сохранено; для больших объёмов укажите свой сервер в NOMINATIM_URL или сузьте поиск до страны/города.`;
                break outer;
              }
              if (await shouldStop(searchId)) {
                note = "Поиск остановлен пользователем.";
                break outer;
              }
              requests++;
              // Временные сбои (503, сеть) — до 3 попыток с паузой; затем страница пропускается.
              // Поиск прекращается только после нескольких сбоев подряд.
              let r: Awaited<ReturnType<typeof nominatimPage>> | null = null;
              for (let attempt = 1; attempt <= 3 && !r; attempt++) {
                try {
                  r = await nominatimPage({ key: k, value: v, countryCode: code, exclude: round ? [] : exclude });
                } catch (e) {
                  lastError = e instanceof Error ? e.message : String(e);
                  if (/429/.test(lastError)) break;
                  await new Promise((res) => setTimeout(res, attempt * 4000));
                }
              }
              if (!r) {
                if (++failures >= 4) {
                  note = `Поиск приостановлен: источник отвечает ошибками (${lastError}). Найденное сохранено — повторите позже.`;
                  break outer;
                }
                break; // к следующему тегу/стране
              }
              failures = 0;
              exclude.push(...r.placeIds);
              await saver.save(r.places, { city: "", country: country.name });
              await beat();
              if (r.done) break;
            }
          }
        }
        if (isCountry) break;
      }
    }
    const stopped = await shouldStop(searchId);
    await beat({ status: stopped ? "stopped" : "done", finishedAt: new Date(), error: note.slice(0, 500) });
  } catch (e) {
    const msg = e instanceof DiscoveryError ? e.message : e instanceof Error ? e.message : String(e);
    // Если что-то уже найдено — это частичный результат, а не провал
    await beat({ status: saver.count() ? "done" : "failed", error: (saver.count() ? `Поиск прерван: ${msg}. Найденное сохранено.` : msg).slice(0, 500), finishedAt: new Date() });
  }
}

/** Однократно: рейтинг и флаги для результатов, сохранённых до появления рейтинга. */
const gs = globalThis as unknown as { __lhRankBackfill?: boolean };
export async function backfillRanks() {
  if (gs.__lhRankBackfill) return;
  gs.__lhRankBackfill = true;
  const rows = await prisma.searchResult.findMany({ where: { rank: 0, rankNote: "" }, select: { id: true, emails: true, website: true, phone: true, hasSocial: true, audit: true } });
  for (const r of rows) {
    const hasEmail = Array.isArray(r.emails) && r.emails.length > 0;
    const opportunity = (r.audit as unknown as SiteAudit | null)?.opportunity ?? "";
    const isSocial = Boolean(r.website && socialHost(r.website));
    const x = rankPlace({ hasEmail, website: r.website, websiteIsSocial: isSocial, phone: r.phone, hasSocial: r.hasSocial, tags: {}, opportunity });
    await prisma.searchResult.update({ where: { id: r.id }, data: { hasEmail, hasWebsite: Boolean(r.website && !isSocial), opportunity, rank: x.rank, rankNote: x.note } });
  }
}

/** Поиски, прерванные перезапуском сервера (нет «пульса» > 10 минут), помечаются остановленными. */
export async function markStaleSearches() {
  await prisma.leadSearch.updateMany({
    where: { status: "running", OR: [{ heartbeatAt: { lt: new Date(Date.now() - 10 * 60_000) } }, { heartbeatAt: null, createdAt: { lt: new Date(Date.now() - 10 * 60_000) } }] },
    data: { status: "stopped", error: "Поиск прерван перезапуском сервера. Найденное сохранено." },
  });
}

// ---------- Обогащение: email с сайта + аудит ----------
const CONTACT_PAGE = /(contact|kontakt|kontakty|контакт|about|o-nas|o_nas|onas|о-нас|company|kompaniya)/i;

export type Enrichment = { emails: FoundEmail[]; audit: SiteAudit; pages: FetchedPage[]; fetchError: string | null };

export async function enrichWebsite(website: string, kind: CategoryKind, opts: { hasSocialInOsm?: boolean; maxPages?: number } = {}): Promise<Enrichment> {
  const pages: FetchedPage[] = [];
  let fetchError: string | null = null;
  const emails: FoundEmail[] = [];
  if (website && !socialHost(website)) {
    const cache = new Map<string, string>();
    try {
      const home = await fetchPublicPage(website, cache);
      pages.push(home);
      const domain = normalizeDomain(home.url);
      emails.push(...extractEmails(home.html, home.url, domain));
      const candidates = home.links.filter((l) => CONTACT_PAGE.test(decodeURIComponent(new URL(l).pathname))).slice(0, (opts.maxPages ?? 3) - 1);
      for (const c of candidates) {
        try {
          const pg = await fetchPublicPage(c, cache);
          pages.push(pg);
          emails.push(...extractEmails(pg.html, pg.url, domain));
        } catch {
          /* недоступная внутренняя страница не мешает аудиту главной */
        }
      }
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
    }
  }
  const audit = auditSite({
    kind,
    website,
    fetchError,
    pages: pages.map((p) => ({ url: p.url, html: p.html, text: p.text, elapsedMs: p.elapsedMs, bytes: p.bytes, truncated: p.truncated })),
    hasSocialInOsm: opts.hasSocialInOsm,
  });
  return { emails: rankEmails(emails), audit, pages, fetchError };
}

/** Пересчёт рейтинга после обогащения: меняются только «возможность написать» и «что улучшить», остальное сохраняется. */
function rerank(r: { website: string; phone: string; hasSocial: boolean; hasEmail: boolean; opportunity: string; rank: number; rankNote: string }, hasEmail: boolean, opportunity: string) {
  const base = { website: r.website, websiteIsSocial: Boolean(r.website && socialHost(r.website)), phone: r.phone, hasSocial: r.hasSocial };
  const rank = Math.max(0, Math.min(100, r.rank - contactPoints({ ...base, hasEmail: r.hasEmail }) - opportunityPoints(r.opportunity) + contactPoints({ ...base, hasEmail }) + opportunityPoints(opportunity)));
  const keep = r.rankNote.split(" · ").filter((x) => ["в Wikidata", "бренд/сеть", "известное место"].includes(x));
  const note = [hasEmail ? "есть email" : base.website && !base.websiteIsSocial ? "есть сайт" : base.phone ? "есть телефон" : base.hasSocial || base.websiteIsSocial ? "только соцсети" : "нет контактов", ...keep, ...(opportunity === "high" ? ["много что улучшить"] : opportunity === "medium" ? ["есть что улучшить"] : [])];
  return { rank, rankNote: note.join(" · ") };
}

/** Обогащение одного результата поиска (вызывается фоновой очередью или кнопкой). */
export async function enrichResult(resultId: string) {
  const lock = await prisma.searchResult.updateMany({ where: { id: resultId, enrichStatus: { in: ["pending", "failed"] } }, data: { enrichStatus: "running" } });
  if (!lock.count) return;
  const r = await prisma.searchResult.findUniqueOrThrow({ where: { id: resultId }, include: { search: { select: { category: true } } } });
  try {
    const e = await enrichWebsite(r.website, categoryKind(r.search.category), { hasSocialInOsm: r.hasSocial });
    const prev = (r.emails as unknown as FoundEmail[] | null) ?? [];
    const emails = rankEmails([...prev, ...e.emails]).slice(0, 10);
    await prisma.searchResult.update({
      where: { id: resultId },
      data: {
        emails: emails as unknown as Prisma.InputJsonValue,
        audit: e.audit as unknown as Prisma.InputJsonValue,
        auditScore: e.audit.score,
        hasEmail: emails.length > 0,
        opportunity: e.audit.opportunity,
        ...rerank(r, emails.length > 0, e.audit.opportunity),
        enrichStatus: !r.website || socialHost(r.website) ? "no_site" : e.fetchError ? "failed" : "done",
        enrichError: e.fetchError?.slice(0, 300) ?? "",
        enrichedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.searchResult.update({ where: { id: resultId }, data: { enrichStatus: "failed", enrichError: (err instanceof Error ? err.message : String(err)).slice(0, 300) } });
  }
}

/** Берёт следующую порцию результатов из очереди обогащения. */
export async function processEnrichmentQueue(batch = 3) {
  // Зависшие «running» (например, после перезапуска) возвращаем в очередь
  await prisma.searchResult.updateMany({ where: { enrichStatus: "running", createdAt: { lt: new Date(Date.now() - 10 * 60_000) }, enrichedAt: null }, data: { enrichStatus: "pending" } });
  await markStaleSearches();
  await backfillRanks();
  // Сначала — самые перспективные (по рейтингу выдачи)
  const next = await prisma.searchResult.findMany({ where: { enrichStatus: "pending" }, orderBy: [{ rank: "desc" }, { createdAt: "asc" }], take: batch, select: { id: true } });
  await Promise.all(next.map((n) => enrichResult(n.id)));
  return next.length;
}

// ---------- Импорт в CRM ----------
export async function importResults(user: CurrentUser, resultIds: string[]) {
  const results = await prisma.searchResult.findMany({ where: { id: { in: resultIds }, ownerId: user.id }, include: { search: true } });
  const created: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const r of results) {
    if (r.clientId && (await prisma.client.findFirst({ where: { id: r.clientId, ownerId: user.id } }))) {
      skipped.push({ id: r.id, reason: "Уже в CRM" });
      continue;
    }
    const domain = r.website ? normalizeDomain(r.website) : "";
    const dup = await prisma.client.findFirst({
      where: { ownerId: user.id, OR: [{ externalId: r.externalId }, ...(domain ? [{ website: { contains: domain } }] : [])] },
    });
    if (dup) {
      await prisma.searchResult.update({ where: { id: r.id }, data: { clientId: dup.id } });
      skipped.push({ id: r.id, reason: "Уже в CRM" });
      continue;
    }
    const audit = r.audit as unknown as SiteAudit | null;
    const catLabel = CATEGORIES[r.search.category]?.label ?? r.search.categoryLabel;
    const client = await prisma.client.create({
      data: {
        ownerId: user.id,
        companyName: r.name,
        category: catLabel,
        industry: catLabel,
        country: r.country,
        city: r.city,
        website: r.website,
        externalId: r.externalId,
        description: [r.address && `Адрес: ${r.address}`, audit?.summary].filter(Boolean).join("\n"),
        siteAudit: audit ? (audit as unknown as Prisma.InputJsonValue) : undefined,
        siteAuditScore: audit?.score ?? null,
        siteAuditAt: r.enrichedAt,
        lastCheckedAt: r.enrichedAt,
        status: "researching",
      },
    });
    const osmSource = await prisma.leadSource.create({
      data: {
        clientId: client.id,
        sourceType: "directory",
        sourceUrl: osmUrl(r.externalId),
        title: `OpenStreetMap: ${r.name}`,
        method: "import",
        checkedAt: new Date(),
        evidence: `Найдено поиском «${r.search.categoryLabel}», ${r.city}. Данные © участники OpenStreetMap (ODbL).`,
      },
    });
    let siteSource: { id: string } | null = null;
    if (r.website)
      siteSource = await prisma.leadSource.create({
        data: { clientId: client.id, sourceType: "website", sourceUrl: r.website, title: "Сайт компании", method: "fetch", checkedAt: r.enrichedAt, evidence: "Сайт проверен автоматическим аудитом; email взяты со страниц сайта" },
      });
    const emails = ((r.emails as unknown as FoundEmail[] | null) ?? []).slice(0, 5);
    for (const e of emails) {
      const check = await formalCheck("email", e.email);
      await prisma.contact.create({
        data: {
          clientId: client.id,
          type: "email",
          value: e.email,
          normalizedValue: normalizeContact("email", e.email),
          label: e.sameDomain ? "Email на сайте компании" : e.source === "osm" ? "Email из OpenStreetMap" : "Email со страницы сайта",
          sourceId: e.source === "osm" ? osmSource.id : siteSource?.id ?? osmSource.id,
          verificationStatus: check.status,
          lastCheckedAt: new Date(),
        },
      });
    }
    if (r.phone)
      await prisma.contact.create({
        data: { clientId: client.id, type: "phone", value: r.phone, normalizedValue: normalizeContact("phone", r.phone), label: "Телефон из OpenStreetMap", sourceId: osmSource.id, verificationStatus: "found" },
      });
    if (r.website)
      await prisma.contact.create({
        data: { clientId: client.id, type: "website", value: r.website, normalizedValue: normalizeContact("website", r.website), label: "Сайт", sourceId: siteSource?.id ?? osmSource.id, verificationStatus: r.enrichStatus === "done" ? "formal" : "found" },
      });
    await prisma.searchResult.update({ where: { id: r.id }, data: { clientId: client.id } });
    await logInteraction(client.id, "lead_discovered", `Добавлен из поиска «${r.search.categoryLabel}», ${r.city} (OpenStreetMap)`, user, { searchId: r.searchId });
    if (audit) await logInteraction(client.id, "site_audit", `Аудит сайта: ${audit.score}/100. ${audit.summary}`, user);
    await recalcScore(client.id, user);
    created.push(client.id);
  }
  return { created, skipped };
}

// ---------- Аудит сайта существующего клиента ----------
const KIND_BY_LABEL: [RegExp, CategoryKind][] = [
  [/коф|кафе|ресторан|бар|паб|пекар|кондитер|фастфуд|еда|food|cafe|coffee/i, "food"],
  [/салон|красот|барбер|beauty|маникюр/i, "beauty"],
  [/стомат|клиник|мед|вет|health/i, "health"],
  [/отел|хостел|гостев|hotel/i, "hospitality"],
  [/магазин|shop|одежд|цвет|мебел/i, "retail"],
];

export async function auditClientSite(user: CurrentUser, clientId: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, include: { contacts: true } });
  const label = `${client.category} ${client.industry}`;
  const kind = KIND_BY_LABEL.find(([re]) => re.test(label))?.[1] ?? "other";
  const e = await enrichWebsite(client.website, kind);
  await prisma.client.update({
    where: { id: clientId },
    data: { siteAudit: e.audit as unknown as Prisma.InputJsonValue, siteAuditScore: e.audit.score, siteAuditAt: new Date(), lastCheckedAt: new Date() },
  });
  // Новые email со страниц сайта добавляем как найденные контакты с источником
  const known = new Set(client.contacts.map((c) => c.normalizedValue));
  let added = 0;
  if (e.emails.length && client.website) {
    let src = await prisma.leadSource.findFirst({ where: { clientId, sourceType: "website" } });
    if (!src) src = await prisma.leadSource.create({ data: { clientId, sourceType: "website", sourceUrl: client.website, title: "Сайт компании", method: "fetch", checkedAt: new Date(), evidence: "Email найдены на страницах сайта" } });
    for (const em of e.emails.slice(0, 5)) {
      if (known.has(em.email)) continue;
      const check = await formalCheck("email", em.email);
      await prisma.contact.create({
        data: { clientId, type: "email", value: em.email, normalizedValue: em.email, label: `Email со страницы ${new URL(em.url).pathname}`, sourceId: src.id, verificationStatus: check.status, lastCheckedAt: new Date() },
      });
      added++;
    }
    if (added) await logInteraction(clientId, "contact_added", `Найдено email на сайте: ${added}`, user);
  }
  await logInteraction(clientId, "site_audit", `Аудит сайта: ${e.audit.score}/100. ${e.audit.summary}`, user);
  await recalcScore(clientId, user);
  return { audit: e.audit, emailsAdded: added, fetchError: e.fetchError };
}

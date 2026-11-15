import "server-only";
import { UA } from "../webfetch";

// Источник предприятий — OpenStreetMap (открытые данные, лицензия ODbL, указание авторства обязательно).
// Nominatim — геокодирование города (не чаще 1 запроса/с), Overpass — выборка заведений по тегам.
// Сервисы публичные и бесплатные; для больших объёмов используйте свой инстанс (NOMINATIM_URL, OVERPASS_URL).

const NOMINATIM = () => process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
// Публичные Overpass часто перегружены — пробуем по очереди, затем резервный поиск через Nominatim
const OVERPASS_LIST = () =>
  (process.env.OVERPASS_URL || "https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export class DiscoveryError extends Error {}

// Сервер Overpass, не ответивший недавно, пропускается на 15 минут — чтобы поиск по городу не ждал минутами
const overpassDownUntil = new Map<string, number>();
const OVERPASS_SKIP_MS = 15 * 60_000;

export type GeoArea = { displayName: string; osmType: string; osmId: number; bbox: [number, number, number, number] | null; country: string; city: string };

let lastNominatim = 0;
async function nominatimThrottle() {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
}

export async function geocodeCity(city: string, country: string): Promise<GeoArea> {
  await nominatimThrottle();
  const u = new URL("/search", NOMINATIM());
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "5");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("accept-language", "ru");
  u.searchParams.set("city", city);
  if (country) u.searchParams.set("country", country);
  const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch((e) => {
    throw new DiscoveryError(`Геокодер недоступен: ${e instanceof Error ? e.message : e}`);
  });
  if (!res.ok) throw new DiscoveryError(`Геокодер ответил ${res.status}`);
  const list = (await res.json()) as {
    osm_type: string;
    osm_id: number;
    display_name: string;
    boundingbox?: string[];
    address?: { country?: string; city?: string; town?: string; village?: string };
  }[];
  if (!list.length) throw new DiscoveryError(`Город «${city}»${country ? ` (${country})` : ""} не найден`);
  // Предпочитаем границу города (relation) — по ней Overpass ищет точнее, чем по прямоугольнику
  const best = list.find((x) => x.osm_type === "relation") ?? list[0];
  const bb = best.boundingbox?.map(Number);
  return {
    displayName: best.display_name,
    osmType: best.osm_type,
    osmId: best.osm_id,
    bbox: bb && bb.length === 4 ? [bb[0], bb[2], bb[1], bb[3]] : null, // south, west, north, east
    country: best.address?.country ?? country,
    city: best.address?.city ?? best.address?.town ?? best.address?.village ?? city,
  };
}

export type Place = {
  externalId: string;
  name: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  lat: number | null;
  lon: number | null;
  hasSocial: boolean;
  tags: Record<string, string>;
  importance: number | null;
};

export function buildOverpassQuery(area: GeoArea, filters: string[], onlyWithContacts: boolean, limit: number): string {
  const scope =
    area.osmType === "relation" ? `area(id:${3_600_000_000 + area.osmId})->.a;` : area.bbox ? "" : (() => {
      throw new DiscoveryError("У найденного места нет границ для поиска");
    })();
  const where = area.osmType === "relation" ? "(area.a)" : `(${area.bbox!.join(",")})`;
  const contactFilters = onlyWithContacts ? ['["website"]', '["contact:website"]', '["email"]', '["contact:email"]'] : [""];
  const parts = filters.flatMap((f) => contactFilters.map((c) => `nwr${f}["name"]${c}${where};`));
  return `[out:json][timeout:40];${scope}(${parts.join("")});out center tags ${Math.min(Math.max(limit, 1), 1000)};`;
}

type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string>; importance?: number; country?: string };

export type FindResult = { places: Place[]; source: "overpass" | "nominatim"; note: string };

/** Overpass (по очереди серверы) → при отказе всех — Nominatim. */
export async function findPlaces(area: GeoArea, filters: string[], onlyWithContacts: boolean, limit: number): Promise<FindResult> {
  const q = buildOverpassQuery(area, filters, onlyWithContacts, limit);
  const errors: string[] = [];
  for (const url of OVERPASS_LIST()) {
    const down = overpassDownUntil.get(url);
    if (down && down > Date.now()) {
      errors.push(`${new URL(url).host}: недавно не отвечал, пропущен`);
      continue;
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: "data=" + encodeURIComponent(q),
        signal: AbortSignal.timeout(40_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trimStart().startsWith("{")) throw new Error("сервер перегружен");
      const json = JSON.parse(text) as { elements?: OsmElement[]; remark?: string };
      if (json.remark && /runtime error|timed out/i.test(json.remark) && !json.elements?.length) throw new Error("таймаут запроса");
      overpassDownUntil.delete(url);
      return { places: elementsToPlaces(json.elements ?? [], area), source: "overpass", note: "" };
    } catch (e) {
      overpassDownUntil.set(url, Date.now() + OVERPASS_SKIP_MS);
      errors.push(`${new URL(url).host}: ${e instanceof Error ? (e.name === "TimeoutError" ? "нет ответа" : e.message) : e}`);
    }
  }
  const places = await nominatimPlaces(area, filters, onlyWithContacts, limit);
  return {
    places,
    source: "nominatim",
    note: `Серверы Overpass недоступны (${errors.join("; ")}) — использован резервный поиск через Nominatim: он находит меньше заведений. Повторите поиск позже или укажите свой сервер в OVERPASS_URL.`,
  };
}

/** Пары key=value из фильтров Overpass: ["amenity"="cafe"], ["shop"~"^(a|b)$"] → amenity=cafe, shop=a, shop=b */
export function filtersToPairs(filters: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (const f of filters) {
    const m = f.match(/^\["([^"]+)"(=|~)"([^"]+)"\]$/);
    if (!m) continue;
    if (m[2] === "=") out.push([m[1], m[3]]);
    else
      for (const v of m[3].replace(/^\^?\(?/, "").replace(/\)?\$?$/, "").split("|"))
        if (/^[\p{L}\p{N}_ -]+$/u.test(v)) out.push([m[1], v.trim()]);
  }
  return out;
}

export type ResolvedPlace = { kind: "area"; area: GeoArea } | { kind: "country"; code: string; name: string };

/**
 * Разбор поля «Город»: город → область поиска; если вписан регион/штат/район — его граница;
 * если вписана страна — поиск по всей стране. Так ошибка в поле не ломает поиск.
 */
export async function resolvePlace(text: string, country: string): Promise<ResolvedPlace> {
  try {
    return { kind: "area", area: await geocodeCity(text, country) };
  } catch (e) {
    if (!(e instanceof DiscoveryError) || !/не найден/.test(e.message)) throw e;
  }
  await nominatimThrottle();
  const u = new URL("/search", NOMINATIM());
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "5");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("accept-language", "ru");
  u.searchParams.set("q", country ? `${text}, ${country}` : text);
  const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch((e) => {
    throw new DiscoveryError(`Геокодер недоступен: ${e instanceof Error ? e.message : e}`);
  });
  if (!res.ok) throw new DiscoveryError(`Геокодер ответил ${res.status}`);
  const list = (await res.json()) as { osm_type: string; osm_id: number; display_name: string; addresstype?: string; boundingbox?: string[]; address?: Record<string, string> }[];
  const countryHit = list.find((x) => x.addresstype === "country" && x.address?.country_code);
  if (countryHit) return { kind: "country", code: countryHit.address!.country_code, name: countryHit.address!.country ?? text };
  const AREA_TYPES = ["state", "region", "province", "county", "district", "municipality", "city", "town", "village", "suburb", "borough", "city_district"];
  const hit = list.find((x) => x.osm_type === "relation" && AREA_TYPES.includes(x.addresstype ?? "")) ?? list.find((x) => AREA_TYPES.includes(x.addresstype ?? ""));
  if (!hit) throw new DiscoveryError(`Место «${text}»${country ? ` (${country})` : ""} не найдено. Проверьте написание или оставьте поле пустым для поиска по стране/миру.`);
  const bb = hit.boundingbox?.map(Number);
  return {
    kind: "area",
    area: {
      displayName: hit.display_name,
      osmType: hit.osm_type,
      osmId: hit.osm_id,
      bbox: bb && bb.length === 4 ? [bb[0], bb[2], bb[1], bb[3]] : null,
      country: hit.address?.country ?? country,
      city: hit.address?.city ?? hit.address?.town ?? hit.address?.state ?? hit.address?.region ?? text,
    },
  };
}

/** Страна → ISO-код (для поиска по всей стране) */
export async function geocodeCountry(country: string): Promise<{ code: string; name: string }> {
  await nominatimThrottle();
  const u = new URL("/search", NOMINATIM());
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "1");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("featureType", "country");
  u.searchParams.set("accept-language", "ru");
  u.searchParams.set("country", country);
  const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch((e) => {
    throw new DiscoveryError(`Геокодер недоступен: ${e instanceof Error ? e.message : e}`);
  });
  if (!res.ok) throw new DiscoveryError(`Геокодер ответил ${res.status}`);
  const [x] = (await res.json()) as { address?: { country_code?: string; country?: string } }[];
  if (!x?.address?.country_code) throw new DiscoveryError(`Страна «${country}» не найдена`);
  return { code: x.address.country_code, name: x.address.country ?? country };
}

/** Публичный Nominatim — лимит честного использования: не больше стольких запросов на один поиск. */
export function nominatimRequestBudget() {
  return process.env.NOMINATIM_URL ? 1000 : 60;
}

type NomItem = { place_id: number; osm_type: string; osm_id: number; name?: string; lat: string; lon: string; importance?: number; extratags?: Record<string, string> | null; address?: Record<string, string> };

/** Одна страница (до 40 мест) Nominatim по тегу, в стране или по всему миру. */
export async function nominatimPage(p: { key: string; value: string; countryCode?: string; exclude: number[] }): Promise<{ places: Place[]; placeIds: number[]; done: boolean }> {
  await nominatimThrottle();
  const u = new URL("/search", NOMINATIM());
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "40");
  u.searchParams.set("extratags", "1");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("accept-language", "ru");
  u.searchParams.set("q", `[${p.key}=${p.value}]`);
  if (p.countryCode) u.searchParams.set("countrycodes", p.countryCode);
  if (p.exclude.length) u.searchParams.set("exclude_place_ids", p.exclude.slice(-400).join(","));
  const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(25_000) }).catch((e) => {
    throw new DiscoveryError(`Nominatim недоступен: ${e instanceof Error ? e.message : e}`);
  });
  if (res.status === 429) throw new DiscoveryError("Nominatim ограничил частоту запросов — продолжите поиск позже");
  if (!res.ok) throw new DiscoveryError(`Nominatim ответил ${res.status}`);
  const list = (await res.json()) as NomItem[];
  const els: OsmElement[] = list
    .filter((x) => x.name)
    .map((x) => {
      const a = x.address ?? {};
      return {
        type: x.osm_type,
        id: x.osm_id,
        lat: Number(x.lat),
        lon: Number(x.lon),
        importance: x.importance,
        country: a.country ?? "",
        tags: { ...(x.extratags ?? {}), name: x.name!, "addr:street": a.road ?? "", "addr:housenumber": a.house_number ?? "", "addr:city": a.city ?? a.town ?? a.village ?? "", "addr:country": a.country ?? "", [p.key]: p.value },
      };
    });
  return { places: elementsToPlaces(els, { city: "" }), placeIds: list.map((x) => x.place_id), done: list.length < 40 };
}

async function nominatimPlaces(area: GeoArea, filters: string[], onlyWithContacts: boolean, limit: number): Promise<Place[]> {
  const pairs = filtersToPairs(filters);
  if (!pairs.length) throw new DiscoveryError("Overpass недоступен, а этот фильтр нельзя выполнить через резервный поиск. Повторите позже.");
  const els: OsmElement[] = [];
  const seen = new Set<string>();
  // Nominatim отдаёт до 40 мест за запрос; листаем через exclude_place_ids, не чаще 1 запроса/с
  const maxPages = Math.min(12, Math.ceil(limit / 20) + 1);
  for (const [k, v] of pairs) {
    const exclude: number[] = [];
    for (let page = 0; page < maxPages; page++) {
      await nominatimThrottle();
      const u = new URL("/search", NOMINATIM());
      u.searchParams.set("format", "jsonv2");
      u.searchParams.set("limit", "40");
      u.searchParams.set("extratags", "1");
      u.searchParams.set("addressdetails", "1");
      u.searchParams.set("accept-language", "ru");
      u.searchParams.set("q", `[${k}=${v}] ${area.city}`);
      if (area.bbox) {
        const [s, w, n, e] = area.bbox;
        u.searchParams.set("viewbox", `${w},${n},${e},${s}`);
        u.searchParams.set("bounded", "1");
      }
      if (exclude.length) u.searchParams.set("exclude_place_ids", exclude.join(","));
      const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(25_000) }).catch(() => null);
      if (!res?.ok) break;
      const list = (await res.json()) as {
        place_id: number;
        osm_type: string;
        osm_id: number;
        name?: string;
        lat: string;
        lon: string;
        importance?: number;
        extratags?: Record<string, string> | null;
        address?: Record<string, string>;
      }[];
      if (!list.length) break;
      for (const x of list) {
        exclude.push(x.place_id);
        const id = `${x.osm_type}/${x.osm_id}`;
        if (seen.has(id) || !x.name) continue;
        seen.add(id);
        const a = x.address ?? {};
        els.push({
          type: x.osm_type,
          id: x.osm_id,
          lat: Number(x.lat),
          lon: Number(x.lon),
          importance: x.importance,
          tags: { ...(x.extratags ?? {}), name: x.name, "addr:street": a.road ?? "", "addr:housenumber": a.house_number ?? "", "addr:city": a.city ?? a.town ?? "", [k]: v },
        });
      }
      if (list.length < 40) break;
    }
  }
  const places = elementsToPlaces(els, area);
  return (onlyWithContacts ? places.filter((p) => p.website || p.email) : places).slice(0, limit);
}

function elementsToPlaces(elements: OsmElement[], area: Pick<GeoArea, "city">): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const el of elements) {


    const t = el.tags ?? {};
    if (!t.name) continue;
    const id = `osm:${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const website = (t.website || t["contact:website"] || t.url || "").split(";")[0].trim();
    out.push({
      externalId: id,
      name: t.name,
      website,
      phone: (t.phone || t["contact:phone"] || "").split(";")[0].trim(),
      email: (t.email || t["contact:email"] || "").split(";")[0].trim(),
      address: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", "),
      city: t["addr:city"] || area.city,
      lat: el.lat ?? el.center?.lat ?? null,
      lon: el.lon ?? el.center?.lon ?? null,
      hasSocial: Boolean(t["contact:vk"] || t["contact:telegram"] || t["contact:instagram"] || t["contact:facebook"] || t["contact:whatsapp"]),
      tags: t,
      importance: el.importance ?? null,
    });
  }
  return out;
}

export function osmUrl(externalId: string) {
  const m = externalId.match(/^osm:(node|way|relation)\/(\d+)$/);
  return m ? `https://www.openstreetmap.org/${m[1]}/${m[2]}` : "";
}

import "server-only";
import { SOURCE_MAP } from "./catalog";
import { ADAPTERS, sourceReadiness } from "./adapters";

// Проверка подключения источника «Спроса»: один минимальный запрос к официальному API с сохранёнными ключами.
// Ничего не публикует и не тратит заметную часть квот.

export type SourceTest = { key: string; ok: boolean; detail: string; checkedAt: string };

const env = (k: string) => process.env[k]?.trim() ?? "";
const UA = "LeadHunterAI/0.3 (+connection test)";

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    const code = e instanceof Error ? ((e.cause as { code?: string })?.code ?? e.message) : String(e);
    throw new Error(`площадка недоступна из этой сети (${code})`);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

const errMsg = (j: Record<string, unknown>) => {
  const e = j.error as { message?: string; error_msg?: string } | string | undefined;
  if (typeof e === "string") return e;
  return e?.message ?? e?.error_msg ?? (j.message as string) ?? (j.detail as string) ?? (j.title as string) ?? JSON.stringify(j).slice(0, 200);
};

type Checker = () => Promise<string>;

const CHECKS: Record<string, Checker> = {
  async threads() {
    const r = await getJson(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(env("THREADS_ACCESS_TOKEN"))}`);
    if (r.status !== 200) throw new Error(errMsg(r.json));
    const s = await getJson(`https://graph.threads.net/v1.0/keyword_search?q=${encodeURIComponent("ищу дизайнера")}&search_type=RECENT&fields=id&limit=1&access_token=${encodeURIComponent(env("THREADS_ACCESS_TOKEN"))}`);
    const search = s.status === 200 ? "поиск по ключевым словам работает" : `поиск недоступен: ${errMsg(s.json)} (нужно разрешение threads_keyword_search)`;
    return `профиль @${r.json.username ?? r.json.id}; ${search}`;
  },
  async instagram() {
    const r = await getJson(`https://graph.facebook.com/v21.0/${encodeURIComponent(env("INSTAGRAM_USER_ID"))}?fields=id,username&access_token=${encodeURIComponent(env("INSTAGRAM_ACCESS_TOKEN"))}`);
    if (r.status !== 200) throw new Error(errMsg(r.json));
    return `бизнес-аккаунт @${r.json.username ?? r.json.id}`;
  },
  async vk() {
    const r = await getJson(`https://api.vk.com/method/users.get?v=5.199`, { headers: { Authorization: `Bearer ${env("VK_ACCESS_TOKEN")}` } });
    if (r.json.error) throw new Error(errMsg(r.json));
    const u = (r.json.response as { first_name?: string; last_name?: string }[] | undefined)?.[0];
    const s = await getJson(`https://api.vk.com/method/newsfeed.search?q=${encodeURIComponent("нужен сайт")}&count=1&v=5.199`, { headers: { Authorization: `Bearer ${env("VK_ACCESS_TOKEN")}` } });
    return `пользователь ${u ? `${u.first_name} ${u.last_name}` : "?"}; ${s.json.error ? `поиск недоступен: ${errMsg(s.json)}` : "поиск записей работает"}`;
  },
  async reddit() {
    const basic = Buffer.from(`${env("REDDIT_CLIENT_ID")}:${env("REDDIT_CLIENT_SECRET")}`).toString("base64");
    const r = await getJson("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    if (r.status !== 200 || !r.json.access_token) throw new Error(errMsg(r.json));
    return "приложение авторизовано (OAuth app-only)";
  },
  async x() {
    const r = await getJson(`https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent("hiring designer")}&max_results=10`, { headers: { Authorization: `Bearer ${env("X_BEARER_TOKEN")}` } });
    if (r.status !== 200) throw new Error(`${r.status}: ${errMsg(r.json)}${r.status === 403 ? " (поиск доступен с платного тарифа Basic)" : ""}`);
    return "recent search работает";
  },
  async discord() {
    const r = await getJson("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bot ${env("DISCORD_BOT_TOKEN")}` } });
    if (r.status !== 200) throw new Error(errMsg(r.json));
    const g = await getJson("https://discord.com/api/v10/users/@me/guilds", { headers: { Authorization: `Bot ${env("DISCORD_BOT_TOKEN")}` } });
    return `бот ${r.json.username}; серверов: ${Array.isArray(g.json) ? g.json.length : "?"}`;
  },
  async google_search() {
    const r = await getJson(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(env("GOOGLE_CSE_KEY"))}&cx=${encodeURIComponent(env("GOOGLE_CSE_CX"))}&q=test&num=1`);
    if (r.status !== 200) throw new Error(errMsg(r.json));
    return "Custom Search работает";
  },
  async yandex_search() {
    const u = `https://yandex.ru/search/xml?folderid=${encodeURIComponent(env("YANDEX_FOLDER_ID"))}&apikey=${encodeURIComponent(env("YANDEX_SEARCH_API_KEY"))}&query=test`;
    let text = "";
    try {
      text = await (await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) })).text();
    } catch (e) {
      throw new Error(`площадка недоступна (${e instanceof Error ? e.message : e})`);
    }
    const err = text.match(/<error[^>]*>([\s\S]*?)<\/error>/)?.[1];
    if (err) throw new Error(err);
    return "Yandex Search API работает";
  },
  async google_maps() {
    const r = await getJson("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env("GOOGLE_PLACES_API_KEY"), "X-Goog-FieldMask": "places.id" },
      body: JSON.stringify({ textQuery: "cafe Berlin", pageSize: 1 }),
    });
    if (r.status !== 200) throw new Error(errMsg(r.json));
    return "Places API работает";
  },
  async yandex_maps() {
    const r = await getJson(`https://search-maps.yandex.ru/v1/?apikey=${encodeURIComponent(env("YANDEX_MAPS_API_KEY"))}&text=${encodeURIComponent("кафе Москва")}&type=biz&lang=ru_RU&results=1`);
    if (r.status !== 200) throw new Error(errMsg(r.json));
    return "поиск организаций работает";
  },
  async "2gis"() {
    const r = await getJson(`https://catalog.api.2gis.com/3.0/items?q=${encodeURIComponent("кафе Москва")}&key=${encodeURIComponent(env("DGIS_API_KEY"))}&page_size=1`);
    const meta = r.json.meta as { code?: number; error?: { message?: string } } | undefined;
    if (meta?.code && meta.code >= 400) throw new Error(meta.error?.message ?? String(meta.code));
    return "Places API 2ГИС работает";
  },
  async crunchbase() {
    const r = await getJson(`https://api.crunchbase.com/api/v4/autocompletes?query=stripe&limit=1&user_key=${encodeURIComponent(env("CRUNCHBASE_API_KEY"))}`);
    if (r.status !== 200) throw new Error(errMsg(r.json));
    return "Crunchbase API работает";
  },
};

/** Открытые источники проверяются реальным чтением через их адаптер (без сохранения). */
async function publicCheck(key: string): Promise<string> {
  const a = ADAPTERS[key];
  if (!a) throw new Error("адаптер не найден");
  const posts = await a.fetch({ service: "website", languages: ["ru", "en"], keywords: [], businessType: "", country: "", city: "", since: new Date(Date.now() - 14 * 86_400_000), limit: 10, channels: { telegram: ["designer_jobs"], reddit: [], discord: [] }, feeds: [] });
  return posts.length ? `доступ есть, получено публикаций: ${posts.length}` : "доступ есть, но свежих публикаций по тестовому запросу нет";
}

export async function testSource(key: string): Promise<SourceTest> {
  const at = new Date().toISOString();
  const meta = SOURCE_MAP[key];
  if (!meta) return { key, ok: false, detail: "Неизвестный источник", checkedAt: at };
  const ready = sourceReadiness(key);
  if (meta.access === "manual" || meta.access === "closed") return { key, ok: false, detail: ready.reason, checkedAt: at };
  if (!ready.ready) return { key, ok: false, detail: ready.reason, checkedAt: at };
  try {
    const detail = CHECKS[key] ? await CHECKS[key]() : await publicCheck(key);
    return { key, ok: true, detail, checkedAt: at };
  } catch (e) {
    return { key, ok: false, detail: e instanceof Error ? e.message : String(e), checkedAt: at };
  }
}

/** Источники, для которых есть смысл проверять подключение (ключ или открытые данные). */
export const TESTABLE = Object.values(SOURCE_MAP).filter((s) => s.access === "api_key" || (s.access === "public" && s.key !== "custom_rss" && s.key !== "manual")).map((s) => s.key);

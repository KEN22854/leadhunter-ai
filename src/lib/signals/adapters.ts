import "server-only";
import { assertPublicUrl } from "../webfetch";
import { SOURCE_MAP } from "./catalog";
import { decodeEntities } from "./classify";
import { extractJsonAfter, parseFeed } from "./feeds";
import { SourceError, sourceFetch, sourceJson } from "./http";
import { SIGNAL_SERVICES, type Lang } from "./lexicon";

// Адаптеры источников. Каждый возвращает «сырые» публикации; фильтрация, классификация,
// скоринг и дедупликация общие (engine.ts). Адаптеры не выполняют вход, не обходят CAPTCHA и лимиты.

export type RawPost = {
  externalId: string;
  url: string;
  title: string;
  text: string;
  authorName?: string;
  authorId?: string;
  authorUrl?: string;
  headline?: string;
  publishedAt: Date | null;
  budget?: string;
  website?: string;
  phone?: string;
  city?: string;
  /** Для каталогов компаний: публикации нет, это карточка организации */
  listing?: boolean;
};

export type FetchCtx = {
  service: string;
  languages: Lang[];
  keywords: string[];
  businessType: string;
  country: string;
  city: string;
  since: Date;
  limit: number;
  channels: { telegram: string[]; reddit: string[]; discord: string[] };
  feeds: string[];
};

export type Adapter = {
  key: string;
  /** Нужные переменные окружения не заданы → список отсутствующих */
  missing(): string[];
  fetch(ctx: FetchCtx): Promise<RawPost[]>;
};

const env = (k: string) => process.env[k]?.trim() ?? "";
const missingEnv = (keys: string[]) => () => keys.filter((k) => !env(k));

/** Поисковые фразы: пользовательские ключи + фразы услуги на языках кампании. */
export function buildQueries(ctx: Pick<FetchCtx, "service" | "languages" | "keywords">, langs?: Lang[], max = 4): string[] {
  const def = SIGNAL_SERVICES[ctx.service];
  const out = [...ctx.keywords];
  for (const l of langs ?? ctx.languages) out.push(...(def?.queries[l] ?? []));
  return [...new Set(out.map((q) => q.trim()).filter(Boolean))].slice(0, max);
}

const within = (d: Date | null, since: Date) => !d || d >= since;

// ---------------- Открытые источники ----------------

const flRu: Adapter = {
  key: "fl_ru",
  missing: () => [],
  async fetch(ctx) {
    const xml = await sourceFetch("fl_ru", "https://www.fl.ru/rss/all.xml");
    return parseFeed(xml)
      .filter((i) => within(i.published, ctx.since))
      .map((i) => ({
        externalId: i.link.match(/projects\/(\d+)/)?.[1] ?? i.id,
        url: i.link,
        // FL.ru дописывает бюджет в заголовок: «… (Бюджет: 75 000 ₽, для всех)»
        title: i.title.replace(/\s*\(Бюджет:[^)]*\)\s*$/, ""),
        budget: i.title.match(/\(Бюджет:\s*([^),]+)/)?.[1]?.trim() ?? "",
        text: `${i.title}\n${i.description}${i.categories.length ? `\nКатегория: ${i.categories.join(", ")}` : ""}`,
        authorName: "Заказчик FL.ru",
        publishedAt: i.published,
      }));
  },
};

type KworkWant = { id: number; name: string; description: string; priceLimit?: string; possiblePriceLimit?: number; date_create?: string; lang?: string; wantUserGetProfileUrl?: string; user?: { USERID?: number; username?: string } };
const kwork: Adapter = {
  key: "kwork",
  missing: () => [],
  async fetch(ctx) {
    const html = await sourceFetch("kwork", "https://kwork.ru/projects", { html: true, headers: { Accept: "text/html" } });
    const data = extractJsonAfter(html, "wantsListData") as { pagination?: { data?: KworkWant[] } } | null;
    const list = data?.pagination?.data;
    if (!Array.isArray(list)) throw new SourceError("kwork", "Не удалось разобрать страницу проектов (изменился формат)", false);
    return list
      .map((w) => {
        const publishedAt = w.date_create ? new Date(w.date_create.replace(" ", "T") + "+03:00") : null;
        const price = w.priceLimit ? `до ${Math.round(Number(w.priceLimit))} ₽` : "";
        return {
          externalId: String(w.id),
          url: `https://kwork.ru/projects/${w.id}`,
          title: decodeEntities(w.name ?? ""),
          text: `${decodeEntities(w.name ?? "")}\n${decodeEntities(w.description ?? "")}${price ? `\nБюджет: ${price}` : ""}`,
          authorName: w.user?.username ?? "Заказчик Kwork",
          authorId: w.user?.USERID ? String(w.user.USERID) : undefined,
          authorUrl: w.wantUserGetProfileUrl,
          publishedAt,
          budget: price,
        } satisfies RawPost;
      })
      .filter((p) => within(p.publishedAt, ctx.since));
  },
};

type FlcProject = { id: number; title: string; description?: string; preview_description?: string; seo_url: string; time_submitted: number; budget?: { minimum?: number; maximum?: number }; currency?: { code?: string; sign?: string }; owner_id?: number; language?: string };
const freelancer: Adapter = {
  key: "freelancer",
  missing: () => [],
  async fetch(ctx) {
    const out: RawPost[] = [];
    const queries = buildQueries(ctx, ["en"], 3);
    for (const q of queries) {
      const u = new URL("https://www.freelancer.com/api/projects/0.1/projects/active/");
      u.searchParams.set("query", q);
      u.searchParams.set("limit", String(Math.min(50, ctx.limit)));
      u.searchParams.set("full_description", "true");
      u.searchParams.set("from_time", String(Math.floor(ctx.since.getTime() / 1000)));
      const j = await sourceJson<{ status: string; result?: { projects?: FlcProject[] } }>("freelancer", u.toString());
      for (const p of j.result?.projects ?? []) {
        const b = p.budget;
        const budget = b?.minimum ? `${p.currency?.sign ?? ""}${b.minimum}${b.maximum ? `–${b.maximum}` : ""} ${p.currency?.code ?? ""}`.trim() : "";
        out.push({
          externalId: String(p.id),
          url: `https://www.freelancer.com/projects/${p.seo_url}`,
          title: p.title,
          text: `${p.title}\n${p.description ?? p.preview_description ?? ""}${budget ? `\nBudget: ${budget}` : ""}`,
          authorName: "Заказчик Freelancer.com",
          authorId: p.owner_id ? String(p.owner_id) : undefined,
          publishedAt: new Date(p.time_submitted * 1000),
          budget,
        });
      }
    }
    return out;
  },
};

const dribbble: Adapter = {
  key: "dribbble",
  missing: () => [],
  async fetch(ctx) {
    const xml = await sourceFetch("dribbble", "https://dribbble.com/jobs.rss");
    return parseFeed(xml)
      .filter((i) => within(i.published, ctx.since))
      .map((i) => ({
        externalId: i.link.match(/jobs\/(\d+)/)?.[1] ?? i.id,
        url: i.link.replace(/\?source=feed$/, ""),
        title: i.title,
        text: `${i.title.replace(/ is hiring for a position of /i, " is hiring: ")}\n${i.description}`,
        authorName: i.author,
        authorId: i.author ? i.author.toLowerCase() : undefined,
        headline: i.author ? `Компания ${i.author} (вакансия на Dribbble)` : "",
        publishedAt: i.published,
      }));
  },
};

const productHunt: Adapter = {
  key: "product_hunt",
  missing: () => [],
  async fetch(ctx) {
    const xml = await sourceFetch("product_hunt", "https://www.producthunt.com/feed");
    return parseFeed(xml)
      .filter((i) => within(i.published, ctx.since))
      .map((i) => ({
        externalId: i.id.split("/").pop() ?? i.id,
        url: i.link,
        title: i.title,
        // Сам факт запуска — сигнал «запустил проект»; формулировка для классификатора
        text: `Launching ${i.title} — product launch on Product Hunt. ${i.description.replace(/Discussion\s*\|\s*Link/i, "").trim()}`,
        authorName: i.author,
        authorId: i.author ? i.author.toLowerCase().replace(/\s+/g, "_") : undefined,
        headline: `Мейкер продукта ${i.title}`,
        publishedAt: i.published,
      }));
  },
};

const vcRu: Adapter = {
  key: "vc_ru",
  missing: () => [],
  async fetch(ctx) {
    const xml = await sourceFetch("vc_ru", "https://vc.ru/rss/all");
    return parseFeed(xml)
      .filter((i) => within(i.published, ctx.since))
      .map((i) => ({
        externalId: i.id || i.link,
        url: i.link.replace(/\?from=rss$/, ""),
        title: i.title,
        text: `${i.title}\n${i.description}`,
        authorName: i.author || "Автор VC.ru",
        authorId: i.author ? i.author.toLowerCase() : undefined,
        publishedAt: i.published,
      }));
  },
};

const habr: Adapter = {
  key: "habr",
  missing: () => [],
  async fetch(ctx) {
    const out: RawPost[] = [];
    for (const q of buildQueries(ctx, ["ru"], 3)) {
      const xml = await sourceFetch("habr", `https://habr.com/ru/rss/search/?q=${encodeURIComponent(q)}&target_type=posts&order=date`);
      for (const i of parseFeed(xml)) {
        if (!within(i.published, ctx.since)) continue;
        out.push({
          externalId: i.link.match(/(articles|post|companies\/[^/]+\/articles)\/(\d+)/)?.[2] ?? i.id,
          url: i.id.startsWith("http") ? i.id : i.link,
          title: i.title,
          text: `${i.title}\n${i.description}`,
          authorName: i.author,
          authorId: i.author ? i.author.toLowerCase() : undefined,
          authorUrl: i.author ? `https://habr.com/ru/users/${encodeURIComponent(i.author)}/` : undefined,
          publishedAt: i.published,
        });
      }
    }
    return out;
  },
};

type HnHit = { objectID: string; title?: string | null; story_title?: string | null; comment_text?: string | null; story_text?: string | null; author: string; created_at_i: number; url?: string | null };
const hn: Adapter = {
  key: "hn",
  missing: () => [],
  async fetch(ctx) {
    const out: RawPost[] = [];
    for (const q of buildQueries(ctx, ["en"], 4)) {
      const u = new URL("https://hn.algolia.com/api/v1/search_by_date");
      u.searchParams.set("query", `"${q}"`);
      u.searchParams.set("tags", "(story,comment)");
      u.searchParams.set("numericFilters", `created_at_i>${Math.floor(ctx.since.getTime() / 1000)}`);
      u.searchParams.set("hitsPerPage", String(Math.min(50, ctx.limit)));
      const j = await sourceJson<{ hits: HnHit[] }>("hn", u.toString());
      for (const h of j.hits) {
        const body = h.comment_text ?? h.story_text ?? "";
        out.push({
          externalId: h.objectID,
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          title: h.title ?? (h.story_title ? `Комментарий в «${h.story_title}»` : "Комментарий HN"),
          text: `${h.title ?? ""}\n${decodeEntities(body).replace(/<p>/g, "\n").replace(/<[^>]+>/g, " ")}`,
          authorName: h.author,
          authorId: h.author,
          authorUrl: `https://news.ycombinator.com/user?id=${encodeURIComponent(h.author)}`,
          publishedAt: new Date(h.created_at_i * 1000),
        });
      }
    }
    return out;
  },
};

const customRss: Adapter = {
  key: "custom_rss",
  missing: () => [],
  async fetch(ctx) {
    const out: RawPost[] = [];
    for (const f of ctx.feeds.slice(0, 10)) {
      const url = await assertPublicUrl(f).catch((e) => {
        throw new SourceError("custom_rss", `Лента ${f}: ${e instanceof Error ? e.message : e}`, false);
      });
      const xml = await sourceFetch("custom_rss", url.toString());
      for (const i of parseFeed(xml)) {
        if (!within(i.published, ctx.since)) continue;
        out.push({ externalId: `${url.hostname}:${i.id || i.link}`, url: i.link, title: i.title, text: `${i.title}\n${i.description}`, authorName: i.author || url.hostname, authorId: i.author ? `${url.hostname}:${i.author.toLowerCase()}` : undefined, publishedAt: i.published });
      }
    }
    return out;
  },
};

/** Публичный канал Telegram через веб-превью t.me/s/<name>. Читаются только открытые каналы. */
export function parseTelegramPreview(html: string, channel: string): RawPost[] {
  const out: RawPost[] = [];
  const blocks = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  for (const b of blocks) {
    const post = b.match(/data-post="([^"]+)"/)?.[1];
    if (!post) continue;
    const textHtml = b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const text = decodeEntities(textHtml.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")).trim();
    if (!text) continue;
    const dt = b.match(/<time[^>]+datetime="([^"]+)"/)?.[1];
    const author = b.match(/class="tgme_widget_message_from_author"[^>]*>([\s\S]*?)<\/span>/)?.[1];
    // В каналах-агрегаторах заказов контакт заказчика указан в тексте как @username
    const handle = text.match(/(?:^|\s)@([a-z0-9_]{5,32})\b/i)?.[1];
    out.push({
      externalId: post,
      url: `https://t.me/${post}`,
      title: text.split("\n")[0].slice(0, 140),
      text,
      authorName: handle ? `@${handle}` : author ? decodeEntities(author) : `@${channel}`,
      authorId: handle ? handle.toLowerCase() : undefined,
      authorUrl: handle ? `https://t.me/${handle}` : undefined,
      headline: handle ? `Контакт из публикации в @${channel}` : `Публикация в канале @${channel}`,
      publishedAt: dt ? new Date(dt) : null,
    });
  }
  return out;
}

const telegram: Adapter = {
  key: "telegram",
  missing: () => [],
  async fetch(ctx) {
    if (!ctx.channels.telegram.length) throw new SourceError("telegram", "Не указаны публичные каналы (поле «Telegram-каналы» в кампании)", false);
    const out: RawPost[] = [];
    for (const ch of ctx.channels.telegram.slice(0, 15)) {
      const name = ch.replace(/^https?:\/\/t\.me\/(s\/)?/i, "").replace(/^@/, "").split(/[/?]/)[0];
      if (!/^[a-z0-9_]{4,32}$/i.test(name)) continue;
      const html = await sourceFetch("telegram", `https://t.me/s/${name}`, { html: true, headers: { Accept: "text/html" } });
      out.push(...parseTelegramPreview(html, name).filter((p) => within(p.publishedAt, ctx.since)));
    }
    return out;
  },
};

// ---------------- Официальные API с ключом ----------------

let redditToken: { token: string; exp: number } | null = null;
type RedditPost = { data: { id: string; name: string; title: string; selftext: string; author: string; permalink: string; created_utc: number; subreddit: string; link_flair_text?: string | null } };
const reddit: Adapter = {
  key: "reddit",
  missing: missingEnv(["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"]),
  async fetch(ctx) {
    if (!redditToken || redditToken.exp < Date.now()) {
      const basic = Buffer.from(`${env("REDDIT_CLIENT_ID")}:${env("REDDIT_CLIENT_SECRET")}`).toString("base64");
      const t = await sourceJson<{ access_token: string; expires_in: number }>("reddit", "https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });
      redditToken = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
    }
    const subs = (ctx.channels.reddit.length ? ctx.channels.reddit : ["forhire", "slavelabour", "hiring", "startups", "smallbusiness", "entrepreneur"]).map((s) => s.replace(/^\/?r\//i, "")).filter((s) => /^[a-z0-9_]{2,21}$/i.test(s));
    const out: RawPost[] = [];
    const t = Math.ceil((Date.now() - ctx.since.getTime()) / 86_400_000) <= 7 ? "week" : "month";
    for (const q of buildQueries(ctx, ["en"], 3)) {
      const j = await sourceJson<{ data: { children: RedditPost[] } }>("reddit", `https://oauth.reddit.com/r/${subs.join("+")}/search?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new&t=${t}&limit=${Math.min(100, ctx.limit)}`, {
        headers: { Authorization: `Bearer ${redditToken.token}` },
      });
      for (const { data: p } of j.data.children) {
        if (p.author === "[deleted]") continue;
        out.push({
          externalId: p.name,
          url: `https://www.reddit.com${p.permalink}`,
          title: p.title,
          text: `${p.link_flair_text ? `[${p.link_flair_text}] ` : ""}${p.title}\n${p.selftext}`,
          authorName: `u/${p.author}`,
          authorId: p.author.toLowerCase(),
          authorUrl: `https://www.reddit.com/user/${p.author}`,
          headline: `Публикация в r/${p.subreddit}`,
          publishedAt: new Date(p.created_utc * 1000),
        });
      }
    }
    return out;
  },
};

type VkItem = { id: number; owner_id: number; from_id?: number; date: number; text: string };
const vk: Adapter = {
  key: "vk",
  missing: missingEnv(["VK_ACCESS_TOKEN"]),
  async fetch(ctx) {
    const out: RawPost[] = [];
    for (const q of buildQueries(ctx, ["ru"], 3)) {
      const u = new URL("https://api.vk.com/method/newsfeed.search");
      u.searchParams.set("q", q);
      u.searchParams.set("count", String(Math.min(100, ctx.limit)));
      u.searchParams.set("start_time", String(Math.floor(ctx.since.getTime() / 1000)));
      u.searchParams.set("extended", "1");
      u.searchParams.set("v", "5.199");
      const j = await sourceJson<{ response?: { items: VkItem[]; profiles?: { id: number; first_name: string; last_name: string; screen_name?: string }[]; groups?: { id: number; name: string; screen_name?: string }[] }; error?: { error_msg: string; error_code: number } }>("vk", u.toString(), {
        headers: { Authorization: `Bearer ${env("VK_ACCESS_TOKEN")}` },
      });
      if (j.error) throw new SourceError("vk", `VK API: ${j.error.error_msg} (${j.error.error_code})`, j.error.error_code === 6);
      const profiles = new Map((j.response?.profiles ?? []).map((p) => [p.id, p]));
      const groups = new Map((j.response?.groups ?? []).map((g) => [-g.id, g]));
      for (const it of j.response?.items ?? []) {
        const authorId = it.from_id ?? it.owner_id;
        const p = profiles.get(authorId);
        const g = groups.get(authorId);
        out.push({
          externalId: `${it.owner_id}_${it.id}`,
          url: `https://vk.com/wall${it.owner_id}_${it.id}`,
          title: it.text.split("\n")[0].slice(0, 140),
          text: it.text,
          authorName: p ? `${p.first_name} ${p.last_name}` : g?.name ?? `id${authorId}`,
          authorId: String(authorId),
          authorUrl: authorId > 0 ? `https://vk.com/${p?.screen_name ?? `id${authorId}`}` : `https://vk.com/${g?.screen_name ?? `club${-authorId}`}`,
          publishedAt: new Date(it.date * 1000),
        });
      }
    }
    return out;
  },
};

const LANG_X: Record<Lang, string> = { ru: "ru", en: "en", de: "de", fr: "fr", es: "es" };
const x: Adapter = {
  key: "x",
  missing: missingEnv(["X_BEARER_TOKEN"]),
  async fetch(ctx) {
    const out: RawPost[] = [];
    for (const lang of ctx.languages.slice(0, 2)) {
      const qs = buildQueries(ctx, [lang], 3).map((q) => `"${q}"`);
      if (!qs.length) continue;
      const u = new URL("https://api.x.com/2/tweets/search/recent");
      u.searchParams.set("query", `(${qs.join(" OR ")}) -is:retweet lang:${LANG_X[lang]}`);
      u.searchParams.set("max_results", String(Math.max(10, Math.min(100, ctx.limit))));
      u.searchParams.set("start_time", new Date(Math.max(ctx.since.getTime(), Date.now() - 6.9 * 86_400_000)).toISOString());
      u.searchParams.set("tweet.fields", "created_at,lang,author_id");
      u.searchParams.set("expansions", "author_id");
      u.searchParams.set("user.fields", "username,name,description,url");
      const j = await sourceJson<{ data?: { id: string; text: string; created_at: string; author_id: string }[]; includes?: { users?: { id: string; username: string; name: string; description?: string }[] } }>("x", u.toString(), {
        headers: { Authorization: `Bearer ${env("X_BEARER_TOKEN")}` },
      });
      const users = new Map((j.includes?.users ?? []).map((usr) => [usr.id, usr]));
      for (const t of j.data ?? []) {
        const usr = users.get(t.author_id);
        out.push({
          externalId: t.id,
          url: `https://x.com/${usr?.username ?? "i"}/status/${t.id}`,
          title: t.text.slice(0, 140),
          text: t.text,
          authorName: usr ? `${usr.name} (@${usr.username})` : t.author_id,
          authorId: t.author_id,
          authorUrl: usr ? `https://x.com/${usr.username}` : undefined,
          headline: usr?.description ?? "",
          publishedAt: new Date(t.created_at),
        });
      }
    }
    return out;
  },
};

const threads: Adapter = {
  key: "threads",
  missing: missingEnv(["THREADS_ACCESS_TOKEN"]),
  async fetch(ctx) {
    const out: RawPost[] = [];
    for (const q of buildQueries(ctx, undefined, 3)) {
      const u = new URL("https://graph.threads.net/v1.0/keyword_search");
      u.searchParams.set("q", q);
      u.searchParams.set("search_type", "RECENT");
      u.searchParams.set("fields", "id,text,permalink,timestamp,username");
      u.searchParams.set("since", String(Math.floor(ctx.since.getTime() / 1000)));
      u.searchParams.set("access_token", env("THREADS_ACCESS_TOKEN"));
      const j = await sourceJson<{ data?: { id: string; text?: string; permalink: string; timestamp: string; username?: string }[] }>("threads", u.toString());
      for (const p of j.data ?? []) {
        if (!p.text) continue;
        out.push({ externalId: p.id, url: p.permalink, title: p.text.slice(0, 140), text: p.text, authorName: p.username ? `@${p.username}` : "Автор Threads", authorId: p.username, authorUrl: p.username ? `https://www.threads.net/@${p.username}` : undefined, publishedAt: new Date(p.timestamp) });
      }
    }
    return out;
  },
};

const instagram: Adapter = {
  key: "instagram",
  missing: missingEnv(["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USER_ID"]),
  async fetch(ctx) {
    const out: RawPost[] = [];
    const token = env("INSTAGRAM_ACCESS_TOKEN");
    const uid = env("INSTAGRAM_USER_ID");
    const tags = buildQueries(ctx, undefined, 3).map((q) => q.toLowerCase().replace(/[^\p{L}\d]+/gu, "")).filter(Boolean);
    for (const tag of tags) {
      const h = await sourceJson<{ data?: { id: string }[] }>("instagram", `https://graph.facebook.com/v21.0/ig_hashtag_search?user_id=${uid}&q=${encodeURIComponent(tag)}&access_token=${token}`);
      const id = h.data?.[0]?.id;
      if (!id) continue;
      const m = await sourceJson<{ data?: { id: string; caption?: string; permalink: string; timestamp: string }[] }>("instagram", `https://graph.facebook.com/v21.0/${id}/recent_media?user_id=${uid}&fields=id,caption,permalink,timestamp&limit=50&access_token=${token}`);
      for (const p of m.data ?? []) {
        if (!p.caption) continue;
        out.push({ externalId: p.id, url: p.permalink, title: p.caption.slice(0, 140), text: p.caption, authorName: `Пост с #${tag}`, publishedAt: new Date(p.timestamp) });
      }
    }
    return out.filter((p) => within(p.publishedAt, ctx.since));
  },
};

const discord: Adapter = {
  key: "discord",
  missing: missingEnv(["DISCORD_BOT_TOKEN"]),
  async fetch(ctx) {
    if (!ctx.channels.discord.length) throw new SourceError("discord", "Не указаны ID каналов Discord (бот должен быть добавлен на сервер)", false);
    const auth = { Authorization: `Bot ${env("DISCORD_BOT_TOKEN")}` };
    const out: RawPost[] = [];
    for (const ch of ctx.channels.discord.filter((c) => /^\d{10,22}$/.test(c)).slice(0, 10)) {
      const info = await sourceJson<{ guild_id?: string; name?: string }>("discord", `https://discord.com/api/v10/channels/${ch}`, { headers: auth });
      const msgs = await sourceJson<{ id: string; content: string; timestamp: string; author: { id: string; username: string; global_name?: string } }[]>("discord", `https://discord.com/api/v10/channels/${ch}/messages?limit=100`, { headers: auth });
      for (const m of msgs) {
        if (!m.content) continue;
        out.push({
          externalId: m.id,
          url: `https://discord.com/channels/${info.guild_id ?? "@me"}/${ch}/${m.id}`,
          title: m.content.slice(0, 140),
          text: m.content,
          authorName: m.author.global_name ?? m.author.username,
          authorId: m.author.id,
          headline: `Сообщение в #${info.name ?? ch}`,
          publishedAt: new Date(m.timestamp),
        });
      }
    }
    return out.filter((p) => within(p.publishedAt, ctx.since));
  },
};

const googleSearch: Adapter = {
  key: "google_search",
  missing: missingEnv(["GOOGLE_CSE_KEY", "GOOGLE_CSE_CX"]),
  async fetch(ctx) {
    const out: RawPost[] = [];
    const days = Math.max(1, Math.ceil((Date.now() - ctx.since.getTime()) / 86_400_000));
    for (const q of buildQueries(ctx, undefined, 3)) {
      const u = new URL("https://www.googleapis.com/customsearch/v1");
      u.searchParams.set("key", env("GOOGLE_CSE_KEY"));
      u.searchParams.set("cx", env("GOOGLE_CSE_CX"));
      u.searchParams.set("q", ctx.city ? `${q} ${ctx.city}` : q);
      u.searchParams.set("dateRestrict", `d${days}`);
      u.searchParams.set("num", "10");
      const j = await sourceJson<{ items?: { title: string; link: string; snippet: string }[] }>("google_search", u.toString());
      for (const it of j.items ?? []) out.push({ externalId: it.link, url: it.link, title: it.title, text: `${it.title}\n${it.snippet}`, authorName: new URL(it.link).hostname, publishedAt: null });
    }
    return out;
  },
};

const yandexSearch: Adapter = {
  key: "yandex_search",
  missing: missingEnv(["YANDEX_SEARCH_API_KEY", "YANDEX_FOLDER_ID"]),
  async fetch(ctx) {
    const out: RawPost[] = [];
    for (const q of buildQueries(ctx, ["ru"], 3)) {
      const u = new URL("https://yandex.ru/search/xml");
      u.searchParams.set("folderid", env("YANDEX_FOLDER_ID"));
      u.searchParams.set("apikey", env("YANDEX_SEARCH_API_KEY"));
      u.searchParams.set("query", ctx.city ? `${q} ${ctx.city}` : q);
      u.searchParams.set("sortby", "tm.order=descending");
      u.searchParams.set("groupby", "attr=.mode=flat.groups-on-page=20.docs-in-group=1");
      const xml = await sourceFetch("yandex_search", u.toString());
      const err = xml.match(/<error[^>]*>([\s\S]*?)<\/error>/)?.[1];
      if (err) throw new SourceError("yandex_search", `Yandex Search API: ${decodeEntities(err)}`, false);
      for (const d of xml.match(/<doc[\s>][\s\S]*?<\/doc>/g) ?? []) {
        const url = d.match(/<url>([\s\S]*?)<\/url>/)?.[1] ?? "";
        const title = decodeEntities((d.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/<[^>]+>/g, ""));
        const passage = decodeEntities((d.match(/<passage>([\s\S]*?)<\/passage>/)?.[1] ?? "").replace(/<[^>]+>/g, ""));
        if (url) out.push({ externalId: url, url, title, text: `${title}\n${passage}`, authorName: new URL(url).hostname, publishedAt: null });
      }
    }
    return out;
  },
};

function bizQuery(ctx: FetchCtx) {
  const what = ctx.businessType || ctx.keywords[0];
  if (!what) throw new SourceError("maps", "Для поиска по картам укажите «Тип бизнеса» (например: кофейня)", false);
  return `${what} ${ctx.city}`.trim();
}

const googleMaps: Adapter = {
  key: "google_maps",
  missing: missingEnv(["GOOGLE_PLACES_API_KEY"]),
  async fetch(ctx) {
    const j = await sourceJson<{ places?: { id: string; displayName?: { text: string }; formattedAddress?: string; websiteUri?: string; nationalPhoneNumber?: string; googleMapsUri?: string; primaryTypeDisplayName?: { text: string } }[] }>(
      "google_maps",
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env("GOOGLE_PLACES_API_KEY"), "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri,places.primaryTypeDisplayName" },
        body: JSON.stringify({ textQuery: bizQuery(ctx), pageSize: Math.min(20, ctx.limit) }),
      },
    );
    return (j.places ?? []).map((p) => ({
      externalId: p.id,
      url: p.googleMapsUri ?? "",
      title: p.displayName?.text ?? "Организация",
      text: `${p.displayName?.text ?? ""} — ${p.primaryTypeDisplayName?.text ?? ctx.businessType}. ${p.formattedAddress ?? ""}${p.websiteUri ? "" : ". Сайт не указан"}`,
      authorName: p.displayName?.text ?? "Организация",
      authorId: p.id,
      website: p.websiteUri,
      phone: p.nationalPhoneNumber,
      city: ctx.city,
      publishedAt: null,
      listing: true,
    }));
  },
};

const yandexMaps: Adapter = {
  key: "yandex_maps",
  missing: missingEnv(["YANDEX_MAPS_API_KEY"]),
  async fetch(ctx) {
    const u = new URL("https://search-maps.yandex.ru/v1/");
    u.searchParams.set("apikey", env("YANDEX_MAPS_API_KEY"));
    u.searchParams.set("text", bizQuery(ctx));
    u.searchParams.set("type", "biz");
    u.searchParams.set("lang", "ru_RU");
    u.searchParams.set("results", String(Math.min(50, ctx.limit)));
    const j = await sourceJson<{ features?: { properties: { CompanyMetaData?: { id: string; name: string; address?: string; url?: string; Phones?: { formatted: string }[]; Categories?: { name: string }[] } } }[] }>("yandex_maps", u.toString());
    return (j.features ?? [])
      .map((f) => f.properties.CompanyMetaData)
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({
        externalId: c.id,
        url: `https://yandex.ru/maps/org/${c.id}/`,
        title: c.name,
        text: `${c.name} — ${(c.Categories ?? []).map((k) => k.name).join(", ")}. ${c.address ?? ""}${c.url ? "" : ". Сайт не указан"}`,
        authorName: c.name,
        authorId: c.id,
        website: c.url,
        phone: c.Phones?.[0]?.formatted,
        city: ctx.city,
        publishedAt: null,
        listing: true,
      }));
  },
};

const dgis: Adapter = {
  key: "2gis",
  missing: missingEnv(["DGIS_API_KEY"]),
  async fetch(ctx) {
    const u = new URL("https://catalog.api.2gis.com/3.0/items");
    u.searchParams.set("q", bizQuery(ctx));
    u.searchParams.set("key", env("DGIS_API_KEY"));
    u.searchParams.set("type", "branch");
    u.searchParams.set("page_size", "10");
    u.searchParams.set("fields", "items.contact_groups,items.full_address_name,items.rubrics");
    const j = await sourceJson<{ meta?: { code: number; error?: { message: string } }; result?: { items?: { id: string; name: string; full_address_name?: string; rubrics?: { name: string }[]; contact_groups?: { contacts: { type: string; value: string; text?: string }[] }[] }[] } }>("2gis", u.toString());
    if (j.meta && j.meta.code >= 400 && j.meta.code !== 404) throw new SourceError("2gis", `2ГИС: ${j.meta.error?.message ?? j.meta.code}`, false);
    return (j.result?.items ?? []).map((it) => {
      const contacts = (it.contact_groups ?? []).flatMap((g) => g.contacts);
      const site = contacts.find((c) => c.type === "website");
      return {
        externalId: it.id,
        url: `https://2gis.ru/firm/${it.id.split("_")[0]}`,
        title: it.name,
        text: `${it.name} — ${(it.rubrics ?? []).map((r) => r.name).join(", ")}. ${it.full_address_name ?? ""}${site ? "" : ". Сайт не указан"}`,
        authorName: it.name,
        authorId: it.id,
        website: site ? (site.text ?? site.value) : undefined,
        phone: contacts.find((c) => c.type === "phone")?.text,
        city: ctx.city,
        publishedAt: null,
        listing: true,
      };
    });
  },
};

const crunchbase: Adapter = {
  key: "crunchbase",
  missing: missingEnv(["CRUNCHBASE_API_KEY"]),
  async fetch(ctx) {
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const j = await sourceJson<{ entities?: { uuid: string; properties: { identifier?: { value: string; permalink: string }; short_description?: string; founded_on?: { value: string }; website_url?: string } }[] }>(
      "crunchbase",
      `https://api.crunchbase.com/api/v4/searches/organizations?user_key=${env("CRUNCHBASE_API_KEY")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field_ids: ["identifier", "short_description", "founded_on", "website_url"],
          query: [{ type: "predicate", field_id: "founded_on", operator_id: "gte", values: [since] }],
          order: [{ field_id: "founded_on", sort: "desc" }],
          limit: Math.min(50, ctx.limit),
        }),
      },
    );
    return (j.entities ?? []).map((e) => ({
      externalId: e.uuid,
      url: `https://www.crunchbase.com/organization/${e.properties.identifier?.permalink ?? e.uuid}`,
      title: e.properties.identifier?.value ?? "Компания",
      text: `Starting a company ${e.properties.identifier?.value ?? ""}: ${e.properties.short_description ?? ""}. Founded ${e.properties.founded_on?.value ?? ""}`,
      authorName: e.properties.identifier?.value ?? "Компания",
      authorId: e.uuid,
      website: e.properties.website_url,
      publishedAt: e.properties.founded_on?.value ? new Date(e.properties.founded_on.value) : null,
    }));
  },
};

export const ADAPTERS: Record<string, Adapter> = Object.fromEntries(
  [flRu, kwork, freelancer, dribbble, productHunt, vcRu, habr, hn, customRss, telegram, reddit, vk, x, threads, instagram, discord, googleSearch, yandexSearch, googleMaps, yandexMaps, dgis, crunchbase].map((a) => [a.key, a]),
);

export type SourceStatus = { key: string; ready: boolean; reason: string; missing: string[] };

export function sourceReadiness(key: string): SourceStatus {
  const meta = SOURCE_MAP[key];
  if (!meta) return { key, ready: false, reason: "Неизвестный источник", missing: [] };
  if (meta.access === "closed") return { key, ready: false, reason: meta.note, missing: [] };
  if (meta.access === "manual") return { key, ready: false, reason: "Ручной режим: ссылки поиска + добавление публикации", missing: [] };
  const a = ADAPTERS[key];
  if (!a) return { key, ready: false, reason: "Адаптер не реализован", missing: [] };
  const missing = a.missing();
  return missing.length ? { key, ready: false, reason: `Нужны переменные: ${missing.join(", ")}`, missing } : { key, ready: true, reason: "Готов", missing: [] };
}

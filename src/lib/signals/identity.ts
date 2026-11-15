import { normalizeContact, normalizeDomain } from "../normalize";

// Ключи дедупликации лидов: профиль, домен, email, телефон, идентификатор источника.

export type IdentityKind = "profile" | "domain" | "email" | "phone" | "source_id";
export type Identity = { kind: IdentityKind; value: string };

// Домены площадок — не считаются «доменом лида»
const PLATFORM_DOMAINS = [
  "t.me", "telegram.me", "vk.com", "vk.ru", "reddit.com", "x.com", "twitter.com", "threads.net", "threads.com", "instagram.com", "facebook.com", "fb.com",
  "linkedin.com", "discord.com", "discord.gg", "kwork.ru", "fl.ru", "freelance.ru", "upwork.com", "fiverr.com", "peopleperhour.com", "freelancer.com",
  "google.com", "goo.gl", "maps.app.goo.gl", "yandex.ru", "ya.ru", "2gis.ru", "bing.com", "crunchbase.com", "producthunt.com", "clutch.co", "behance.net",
  "dribbble.com", "pinterest.com", "indiehackers.com", "vc.ru", "habr.com", "news.ycombinator.com", "youtube.com", "youtu.be", "wa.me", "whatsapp.com",
  "tiktok.com", "bit.ly", "github.com", "medium.com", "notion.so", "docs.google.com", "drive.google.com", "figma.com",
];

export function isPlatformDomain(domain: string) {
  return PLATFORM_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

/** Профиль: схема/www/хвостовой слэш/параметры убраны, регистр нижний. */
export function normalizeProfileUrl(url: string) {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^(www\.|old\.|m\.|mobile\.)/, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host === "twitter.com" ? "x.com" : host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+7|8|\+\d{1,3})[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

/** Контакты, которые автор сам опубликовал в тексте запроса. Закрытые данные не собираются. */
export function extractPublicContacts(text: string) {
  const emails = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(e)))].slice(0, 3);
  const phones = [...new Set((text.match(PHONE_RE) ?? []).map((p) => normalizeContact("phone", p)).filter((p) => /^\+?\d{10,15}$/.test(p)))].slice(0, 2);
  const domains = [...new Set((text.match(URL_RE) ?? []).map((u) => normalizeDomain(u.replace(/[.,;:!?»"']+$/, ""))).filter((d) => d && !isPlatformDomain(d)))].slice(0, 3);
  return { emails, phones, domains };
}

export function identitiesFor(p: { source: string; authorId?: string; authorUrl?: string; externalId: string; emails?: string[]; phones?: string[]; domains?: string[]; website?: string }): Identity[] {
  const out: Identity[] = [];
  if (p.authorUrl) out.push({ kind: "profile", value: normalizeProfileUrl(p.authorUrl) });
  // Без автора публикация сама по себе — отдельный лид (нельзя склеивать разных анонимных заказчиков)
  out.push({ kind: "source_id", value: p.authorId ? `${p.source}:author:${p.authorId.toLowerCase()}` : `${p.source}:post:${p.externalId}` });
  for (const e of p.emails ?? []) out.push({ kind: "email", value: normalizeContact("email", e) });
  for (const ph of p.phones ?? []) out.push({ kind: "phone", value: normalizeContact("phone", ph) });
  const ds = [...(p.domains ?? []), ...(p.website ? [normalizeDomain(p.website)] : [])];
  for (const d of ds) if (d && !isPlatformDomain(d)) out.push({ kind: "domain", value: d });
  const seen = new Set<string>();
  return out.filter((i) => i.value && !seen.has(i.kind + i.value) && seen.add(i.kind + i.value));
}

/** Значения для проверки по глобальному списку Do Not Contact (формат SuppressionEntry.value). */
export function dncKeys(ids: Identity[]): string[] {
  const keys: string[] = [];
  for (const i of ids) {
    if (i.kind === "email") keys.push(i.value, "@" + i.value.split("@")[1]);
    else if (i.kind === "domain") keys.push("@" + i.value, i.value);
    else if (i.kind === "profile") keys.push("profile:" + i.value);
    else if (i.kind === "phone") keys.push(i.value);
    else keys.push("source:" + i.value);
  }
  return [...new Set(keys)];
}

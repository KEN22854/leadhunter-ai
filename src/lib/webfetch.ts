import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";

// Безопасная загрузка публичных страниц для AI-анализа:
// только http(s), запрет приватных/локальных адресов (SSRF), учёт robots.txt, таймаут и лимит размера.
// Не обходит авторизацию, CAPTCHA и paywall — такие страницы просто не анализируются.

const UA = "LeadHunterAI/0.1 (+site analysis; respects robots.txt)";
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;

export type FetchedPage = { url: string; title: string; description: string; text: string; links: string[]; fetchedAt: Date };

export class FetchBlockedError extends Error {}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new FetchBlockedError("Некорректный URL");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new FetchBlockedError("Разрешены только http/https");
  if (u.username || u.password) throw new FetchBlockedError("URL с учётными данными запрещён");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new FetchBlockedError("Локальные адреса запрещены");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new FetchBlockedError("Домен не найден");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new FetchBlockedError("Адрес указывает во внутреннюю сеть");
  return u;
}

async function fetchLimited(url: URL, accept: string): Promise<{ res: Response; body: string; finalUrl: URL }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current.toString());
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(current, { redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": UA, Accept: accept } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current);
        continue;
      }
      const reader = res.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) {
            ctrl.abort();
            break;
          }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");
      return { res, body, finalUrl: current };
    } finally {
      clearTimeout(t);
    }
  }
  throw new FetchBlockedError("Слишком много перенаправлений");
}

/** Минимальная проверка robots.txt для User-agent: * и нашего UA. */
export function robotsAllows(robots: string, path: string): boolean {
  const lines = robots.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  let applies = false;
  const disallow: string[] = [];
  const allow: string[] = [];
  for (const l of lines) {
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === "user-agent") applies = v === "*" || /leadhunter/i.test(v);
    else if (applies && k === "disallow" && v) disallow.push(v);
    else if (applies && k === "allow" && v) allow.push(v);
  }
  const longest = (arr: string[]) => arr.filter((p) => path.startsWith(p)).reduce((m, p) => Math.max(m, p.length), -1);
  return longest(allow) >= longest(disallow);
}

export function htmlToText(html: string): { title: string; description: string; text: string; links: string[] } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const description = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? "";
  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title: decode(title), description: decode(description), text, links };
}

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export async function fetchPublicPage(raw: string, robotsCache?: Map<string, string>): Promise<FetchedPage> {
  const url = await assertPublicUrl(raw);
  const origin = url.origin;
  let robots = robotsCache?.get(origin);
  if (robots === undefined) {
    try {
      const r = await fetchLimited(new URL("/robots.txt", origin), "text/plain");
      robots = r.res.ok ? r.body : "";
    } catch {
      robots = "";
    }
    robotsCache?.set(origin, robots);
  }
  if (!robotsAllows(robots, url.pathname || "/")) throw new FetchBlockedError("Страница закрыта для автоматической обработки (robots.txt)");
  const { res, body, finalUrl } = await fetchLimited(url, "text/html,application/xhtml+xml");
  if (!res.ok) throw new FetchBlockedError(`Сайт ответил кодом ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/html/i.test(ct)) throw new FetchBlockedError("Страница не является HTML");
  const parsed = htmlToText(body);
  const links = parsed.links
    .map((h) => {
      try {
        return new URL(h, finalUrl).toString();
      } catch {
        return "";
      }
    })
    .filter((h) => h.startsWith(finalUrl.origin));
  return { url: finalUrl.toString(), ...parsed, text: parsed.text.slice(0, 8000), links: [...new Set(links)], fetchedAt: new Date() };
}

const INTERESTING = /(about|o-nas|o_nas|company|kompaniya|uslugi|services|service|catalog|katalog|portfolio|contacts?|kontakty)/i;

/** Главная + до 2 внутренних страниц «о компании/услуги/контакты». */
export async function fetchSitePages(website: string, maxPages = 3): Promise<{ pages: FetchedPage[]; errors: { url: string; error: string }[] }> {
  const cache = new Map<string, string>();
  const pages: FetchedPage[] = [];
  const errors: { url: string; error: string }[] = [];
  try {
    const home = await fetchPublicPage(website, cache);
    pages.push(home);
    const candidates = home.links.filter((l) => INTERESTING.test(new URL(l).pathname)).slice(0, maxPages - 1);
    for (const c of candidates) {
      try {
        pages.push(await fetchPublicPage(c, cache));
      } catch (e) {
        errors.push({ url: c, error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    errors.push({ url: website, error: e instanceof Error ? e.message : String(e) });
  }
  return { pages, errors };
}

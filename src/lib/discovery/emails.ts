// Извлечение email-адресов со страниц сайта (чистые функции, покрыты тестами).
// Берём только опубликованные адреса: mailto-ссылки и адреса в тексте, включая простую обфускацию «[at]».
// Адреса НЕ угадываются (никаких info@домен «на всякий случай»).

const EMAIL_RE = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}/gi;
const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|woff2?|ttf|avif|mp4|webm|pdf)$/i;
const JUNK_DOMAINS = /(^|\.)(example\.(com|org|net)|domain\.(com|ru)|email\.com|yourdomain\.\w+|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|sentry\.wixpress\.com|test\.com|site\.com|mysite\.\w+|ingest\.sentry\.io)$/i;
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|webmaster|wordpress|admin@wordpress|user|name|email|your-?email|ivanov|test)$/i;
const ROLE_LOCAL = /^(info|hello|contact|contacts|office|mail|sales|order|orders|booking|reserve|bron|zakaz|manager|admin|support|team|cafe|coffee)$/i;

export type FoundEmail = { email: string; source: "osm" | "site"; url: string; sameDomain: boolean; role: boolean };

function deobfuscate(text: string) {
  return text
    .replace(/\s*(\[|\(|\{)\s*(at|собака)\s*(\]|\)|\})\s*/gi, "@")
    // голое « at » не трогаем: в обычном тексте даёт ложные адреса («we are at cafe.ru»)
    .replace(/([a-z0-9._-])\s+собака\s+([a-z0-9-])/gi, "$1@$2")
    .replace(/\s*(\[|\(|\{)\s*(dot|точка)\s*(\]|\)|\})\s*/gi, ".");
}

function decodeEntities(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/g, "&");
}

export function cleanEmail(raw: string): string | null {
  let e = raw.trim().toLowerCase().replace(/^mailto:/, "");
  try {
    e = decodeURIComponent(e);
  } catch {
    /* оставляем как есть */
  }
  e = e.split("?")[0].replace(/^[.\-_]+|[.\-_]+$/g, "");
  if (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/.test(e)) return null;
  const [local, domain] = e.split("@");
  if (ASSET_EXT.test(e) || /@\d+x\./.test(e)) return null; // logo@2x.png
  if (JUNK_DOMAINS.test(domain) || JUNK_LOCAL.test(local)) return null;
  if (/\.\./.test(e) || /^[0-9a-f]{24,}$/.test(local)) return null; // хеши трекеров
  return e;
}

/** Все email со страницы. siteDomain — домен сайта компании (для пометки «на домене компании»). */
export function extractEmails(html: string, pageUrl: string, siteDomain: string): FoundEmail[] {
  const out = new Map<string, FoundEmail>();
  const add = (raw: string) => {
    const e = cleanEmail(raw);
    if (!e || out.has(e)) return;
    const domain = e.split("@")[1];
    const base = siteDomain.replace(/^www\./, "");
    out.set(e, {
      email: e,
      source: "site",
      url: pageUrl,
      sameDomain: Boolean(base) && (domain === base || domain.endsWith("." + base)),
      role: ROLE_LOCAL.test(e.split("@")[0]),
    });
  };
  const decoded = decodeEntities(html);
  for (const m of decoded.matchAll(/href\s*=\s*["']\s*mailto:([^"'?#\s]+)/gi)) add(m[1]);
  const text = deobfuscate(
    decoded
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
  for (const m of text.matchAll(EMAIL_RE)) add(m[0]);
  // JSON-LD: "email": "..."
  for (const m of decoded.matchAll(/"email"\s*:\s*"([^"]+)"/gi)) add(m[1]);
  return [...out.values()];
}

/** Сортировка: на домене компании → ролевые (info@, hello@) → остальные. */
export function rankEmails(list: FoundEmail[]): FoundEmail[] {
  const seen = new Set<string>();
  return list
    .filter((e) => (seen.has(e.email) ? false : (seen.add(e.email), true)))
    .sort((a, b) => Number(b.sameDomain) - Number(a.sameDomain) || Number(b.role) - Number(a.role) || Number(a.source === "site") - Number(b.source === "site"));
}

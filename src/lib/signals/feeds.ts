import { decodeEntities } from "./classify";

// Минимальный разбор RSS 2.0 и Atom без внешних зависимостей.

export type FeedItem = { id: string; title: string; link: string; description: string; author: string; published: Date | null; categories: string[] };

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}

function stripHtml(s: string) {
  return decodeEntities(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function date(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const rss = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const b of rss) {
    const link = tag(b, "link");
    items.push({
      id: tag(b, "guid") || link,
      title: stripHtml(tag(b, "title")),
      link,
      description: stripHtml(tag(b, "description") || tag(b, "content:encoded")),
      author: stripHtml(tag(b, "dc:creator") || tag(b, "author")),
      published: date(tag(b, "pubDate") || tag(b, "dc:date")),
      categories: [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((m) => stripHtml(m[1])),
    });
  }
  const atom = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of atom) {
    const link = b.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? "";
    items.push({
      id: tag(b, "id") || link,
      title: stripHtml(tag(b, "title")),
      link: decodeEntities(link),
      description: stripHtml(tag(b, "content") || tag(b, "summary")),
      author: stripHtml(tag(tag(b, "author") ? b.match(/<author>[\s\S]*?<\/author>/i)![0] : "", "name")),
      published: date(tag(b, "published") || tag(b, "updated")),
      categories: [...b.matchAll(/<category[^>]+term=["']([^"']+)["']/gi)].map((m) => m[1]),
    });
  }
  return items;
}

/** Извлекает JSON-объект, начинающийся сразу после `"key":` в HTML (по балансу скобок). */
export function extractJsonAfter(html: string, key: string): unknown {
  const i = html.indexOf(`"${key}":`);
  if (i < 0) return null;
  let p = html.indexOf("{", i);
  if (p < 0) return null;
  const start = p;
  let depth = 0;
  let inStr = false;
  for (; p < html.length; p++) {
    const c = html[p];
    if (inStr) {
      if (c === "\\") p++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, p + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

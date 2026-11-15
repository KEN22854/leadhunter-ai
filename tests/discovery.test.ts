import { describe, expect, it } from "vitest";
import { extractEmails, rankEmails, cleanEmail } from "@/lib/discovery/emails";
import { auditSite } from "@/lib/discovery/audit";
import { customFilter } from "@/lib/discovery/categories";
import { buildOverpassQuery } from "@/lib/discovery/osm";
import { sanitizePrototype } from "@/lib/reference/sanitize";
import { safeNextPath, clientIp } from "@/lib/net";
import { stripQuoted } from "@/lib/channels/imap";
import { inWindow } from "@/lib/campaigns";
import { slugify } from "@/lib/reference/service";

describe("Поиск email на страницах", () => {
  it("находит mailto, текст, обфускацию и JSON-LD; отбрасывает мусор", () => {
    const html = `<a href="mailto:Info@Coffee.example?subject=hi">Написать</a>
      <p>Бронь: booking [at] coffee.example</p>
      <img src="logo@2x.png"><p>user@example.com</p><p>noreply@coffee.example</p>
      <script>var x="hidden@tracker.example"</script>
      <script type="application/ld+json">{"email":"owner@gmail.com"}</script>`;
    const list = extractEmails(html, "https://coffee.example/contacts", "coffee.example").map((e) => e.email);
    expect(list).toContain("info@coffee.example");
    expect(list).toContain("booking@coffee.example");
    expect(list).toContain("owner@gmail.com");
    expect(list).not.toContain("user@example.com");
    expect(list).not.toContain("noreply@coffee.example");
    expect(list.some((e) => e.includes("png"))).toBe(false);
  });
  it("не превращает обычный текст с «at» в адрес", () => {
    expect(extractEmails("<p>we are at cafe.example every day</p>", "https://x.example", "x.example")).toHaveLength(0);
  });
  it("сортирует: домен компании → ролевые → остальные", () => {
    const ranked = rankEmails([
      { email: "anna@gmail.com", source: "site", url: "", sameDomain: false, role: false },
      { email: "info@cafe.example", source: "site", url: "", sameDomain: true, role: true },
      { email: "hello@other.example", source: "site", url: "", sameDomain: false, role: true },
    ]);
    expect(ranked.map((e) => e.email)).toEqual(["info@cafe.example", "hello@other.example", "anna@gmail.com"]);
  });
  it("cleanEmail", () => {
    expect(cleanEmail("mailto:A%40b.ru")).toBe("a@b.ru");
    expect(cleanEmail("image@3x.webp")).toBeNull();
  });
});

describe("Аудит сайта", () => {
  const now = new Date("2026-11-14T00:00:00Z");
  it("нет сайта — критично и высокий потенциал", () => {
    const a = auditSite({ kind: "food", website: "", pages: [], now });
    expect(a.items[0].key).toBe("no_website");
    expect(a.opportunity).toBe("high");
    expect(a.score).toBeLessThanOrEqual(60);
  });
  it("старый http-сайт кафе без viewport и меню — много пунктов", () => {
    const html = `<html><head><title>Кафе</title></head><body><p>Добро пожаловать</p><footer>© 2018</footer></body></html>`;
    const a = auditSite({ kind: "food", website: "http://cafe.example", pages: [{ url: "http://cafe.example/", html, text: "Добро пожаловать © 2018", elapsedMs: 3500, bytes: 2000, truncated: false }], now });
    const keys = a.items.map((i) => i.key);
    for (const k of ["no_https", "no_viewport", "slow", "no_menu", "stale", "no_contacts", "no_og"]) expect(keys).toContain(k);
    expect(a.opportunity).toBe("high");
  });
  it("хороший сайт — высокий балл", () => {
    const html = `<html><head><title>Кофейня Зерно — кофе в Казани</title><meta name="viewport" content="width=device-width"><meta name="description" content="Кофейня в центре Казани: свежая обжарка, десерты и завтраки весь день"><meta property="og:title" content="x"><link rel="icon" href="/f.ico"><script type="application/ld+json">{}</script></head>
      <body><h1>Зерно</h1><a href="tel:+79000000000">звонок</a><a href="https://t.me/zerno">tg</a><a href="https://yandex.ru/maps/1">карта</a><p>Меню, доставка, бронь столиков</p><footer>© 2026</footer></body></html>`;
    const a = auditSite({ kind: "food", website: "https://zerno.example", pages: [{ url: "https://zerno.example/", html, text: "Меню, доставка, бронь столиков", elapsedMs: 400, bytes: 3000, truncated: false }], now });
    expect(a.score).toBeGreaterThanOrEqual(90);
    expect(a.opportunity).toBe("low");
  });
});

describe("Запросы к OpenStreetMap", () => {
  it("пользовательский фильтр проверяется строго (нет инъекций в Overpass QL)", () => {
    expect(customFilter("amenity=ice_cream")).toBe('["amenity"="ice_cream"]');
    expect(customFilter("shop~tea|coffee")).toBe('["shop"~"tea|coffee"]');
    expect(customFilter('amenity=cafe"];out;')).toBeNull();
    expect(customFilter("bad key=x")).toBeNull();
  });
  it("запрос по границе города с фильтром контактов", () => {
    const q = buildOverpassQuery({ displayName: "", osmType: "relation", osmId: 123, bbox: null, country: "", city: "" }, ['["amenity"="cafe"]'], true, 50);
    expect(q).toContain("area(id:3600000123)");
    expect(q).toContain('nwr["amenity"="cafe"]["name"]["website"](area.a);');
    expect(q).toContain("out center tags 50");
  });
});

describe("Безопасность", () => {
  it("HTML-прототип очищается от скриптов, обработчиков и внешних ресурсов", () => {
    const s = sanitizePrototype(
      `<html><head><script>alert(1)</script><link rel="stylesheet" href="https://cdn.example/x.css"></head><body onload="x()"><a href="javascript:alert(1)">a</a><img src="https://t.example/p.gif"><iframe src="https://e.example"></iframe><style>@import url(https://f.example/a.css); .a{background:url(https://x.example/i.png)}</style></body></html>`,
    );
    expect(s).not.toMatch(/<script/i);
    expect(s).not.toMatch(/onload/i);
    expect(s).not.toMatch(/javascript:/i);
    expect(s).not.toMatch(/<iframe/i);
    expect(s).not.toMatch(/https:\/\//i);
    expect(s).toMatch(/Content-Security-Policy/);
  });
  it("редирект после входа — только внутренние пути", () => {
    expect(safeNextPath("/clients/1?tab=x")).toBe("/clients/1?tab=x");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "/\\/evil", "javascript:alert(1)", "/%0d%0aSet-Cookie", "\t/x"]) {
      expect(safeNextPath(bad).startsWith("//")).toBe(false);
      expect(["/", "/%0d%0aSet-Cookie"]).toContain(safeNextPath(bad));
    }
    expect(safeNextPath(null)).toBe("/");
  });
  it("X-Forwarded-For не учитывается без TRUST_PROXY", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4" });
    expect(clientIp(h)).toBe("direct");
    process.env.TRUST_PROXY = "1";
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" }))).toBe("10.0.0.1");
    delete process.env.TRUST_PROXY;
  });
});

describe("Прочее", () => {
  it("ответ без цитаты", () => {
    expect(stripQuoted("Да, интересно!\n\nOn Mon, X wrote:\n> старое")).toBe("Да, интересно!");
    expect(stripQuoted("Давайте созвонимся\n14.11.2026, Иван пишет:\nтекст")).toBe("Давайте созвонимся");
  });
  it("окно отправки", () => {
    const at = (h: number) => new Date(2026, 10, 14, h, 30);
    expect(inWindow(at(10), 9, 19)).toBe(true);
    expect(inWindow(at(20), 9, 19)).toBe(false);
    expect(inWindow(at(23), 22, 6)).toBe(true);
  });
  it("slugify", () => {
    expect(slugify("Кофейня «Зерно»")).toBe("kofeynya-zerno");
  });
});

describe("Резервный поиск", () => {
  it("фильтры Overpass переводятся в пары для Nominatim", async () => {
    const { filtersToPairs } = await import("@/lib/discovery/osm");
    expect(filtersToPairs(['["amenity"="cafe"]', '["amenity"~"^(bar|pub)$"]', '["shop"~"tea|coffee"]'])).toEqual([
      ["amenity", "cafe"],
      ["amenity", "bar"],
      ["amenity", "pub"],
      ["shop", "tea"],
      ["shop", "coffee"],
    ]);
  });
});

describe("Аудит: соцсети и недоступные сайты", () => {
  it("страница VK вместо сайта — «нет собственного сайта»", () => {
    const a = auditSite({ kind: "food", website: "http://vk.com/cafe", pages: [] });
    expect(a.items[0].key).toBe("social_only");
  });
  it("сбой загрузки — не «критично», а «проверить вручную»", () => {
    const a = auditSite({ kind: "food", website: "https://x.example", fetchError: "fetch failed", pages: [] });
    expect(a.items[0].severity).toBe("major");
  });
});

describe("Рейтинг выдачи поиска", async () => {
  const { rankPlace, contactPoints, WORLD_COUNTRIES } = await import("@/lib/discovery/rank");
  const base = { hasEmail: false, website: "", websiteIsSocial: false, phone: "", hasSocial: false, tags: {} as Record<string, string> };
  it("возможность написать: email › сайт › телефон › соцсети › ничего", () => {
    const pts = [{ ...base, hasEmail: true }, { ...base, website: "https://a.example" }, { ...base, phone: "+7900" }, { ...base, hasSocial: true }, base].map((p) => contactPoints(p));
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
    expect(pts[0]).toBeGreaterThan(pts[1]);
  });
  it("бренд, Wikidata и известность поднимают рейтинг; пояснение человекочитаемое", () => {
    const plain = rankPlace({ ...base, website: "https://a.example" });
    const famous = rankPlace({ ...base, website: "https://a.example", tags: { wikidata: "Q1", brand: "Coffee", opening_hours: "24/7" }, importance: 0.5 });
    expect(famous.rank).toBeGreaterThan(plain.rank);
    expect(famous.note).toContain("Wikidata");
    expect(famous.rank).toBeLessThanOrEqual(100);
  });
  it("список стран для поиска по миру без повторов", () => {
    expect(new Set(WORLD_COUNTRIES).size).toBe(WORLD_COUNTRIES.length);
  });
});

describe("Поле «Город»: город, регион или страна", async () => {
  const { resolvePlace } = await import("@/lib/discovery/osm");
  const { vi } = await import("vitest");
  const reply = (byParam: (u: URL) => unknown) =>
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response(JSON.stringify(byParam(u)), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);
  it("страна, вписанная в поле города, → поиск по стране", async () => {
    const spy = reply((u) => (u.searchParams.get("city") ? [] : [{ osm_type: "relation", osm_id: 1, display_name: "США", addresstype: "country", address: { country: "США", country_code: "us" } }]));
    try {
      expect(await resolvePlace("Соединённые Штаты Америки", "")).toEqual({ kind: "country", code: "us", name: "США" });
    } finally {
      spy.mockRestore();
    }
  });
  it("регион/штат → его граница", async () => {
    const spy = reply((u) => (u.searchParams.get("city") ? [] : [{ osm_type: "relation", osm_id: 165475, display_name: "Калифорния, США", addresstype: "state", boundingbox: ["32", "42", "-124", "-114"], address: { state: "Калифорния", country: "США" } }]));
    try {
      const r = await resolvePlace("Калифорния", "");
      expect(r.kind).toBe("area");
      if (r.kind === "area") expect(r.area.osmId).toBe(165475);
    } finally {
      spy.mockRestore();
    }
  });
});

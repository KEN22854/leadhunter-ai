import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Модуль 2 «Спрос»: классификация, скоринг, разбор источников, дедупликация, Do Not Contact,
// цикл обращения со статусами и аналитика. Сеть не используется (адаптеры проверяются на сохранённых фрагментах).

let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "lh_session" && sessionToken ? { value: sessionToken } : undefined) }),
}));
// Тест не зависит от DNS: любые публичные имена резолвятся в документационный адрес 203.0.113.10
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "203.0.113.10", family: 4 }] }));

const { classifyIntent, detectLanguage, matchService, extractBudget, temperatureOf } = await import("@/lib/signals/classify");
const { scoreSignal, combineLeadScore } = await import("@/lib/signals/scoring");
const { identitiesFor, extractPublicContacts, normalizeProfileUrl, dncKeys } = await import("@/lib/signals/identity");
const { parseFeed, extractJsonAfter } = await import("@/lib/signals/feeds");
const { parseTelegramPreview, buildQueries } = await import("@/lib/signals/adapters");
const { evaluatePost } = await import("@/lib/signals/engine");
const { manualSearchUrl, SOURCES } = await import("@/lib/signals/catalog");

describe("Намерения: многоязычная классификация", () => {
  const cases: [string, string][] = [
    ["Ищу дизайнера для лендинга кофейни, бюджет 40 000 ₽, срок 2 недели", "order"],
    ["Нужен сайт для салона красоты, кто возьмётся?", "hire"],
    ["Посоветуйте, кто делает карточки товаров для Wildberries?", "recommendation"],
    ["Запускаю бренд одежды, думаю про логотип", "launch"],
    ["Looking for a web designer to build a landing page for my bakery", "hire"],
    ["Can anyone recommend a good branding agency?", "recommendation"],
    ["Wir suchen einen Webdesigner für unsere neue Website", "hire"],
    ["Je cherche un graphiste pour créer le logo de ma boutique", "hire"],
    ["Busco diseñador web para la página de mi restaurante", "hire"],
    ["Looking for a technical co-founder for my SaaS", "partner"],
    ["Ищем SMM-специалиста на постоянной основе для ведения инстаграма", "ongoing"],
  ];
  for (const [text, intent] of cases) {
    it(`${intent}: ${text.slice(0, 40)}…`, () => {
      const r = classifyIntent(text);
      expect(r.intent).toBe(intent);
      expect(r.commercial).toBe(true);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  }
  it("не путает самопрезентацию и обсуждение с заказом", () => {
    for (const t of [
      "Я веб-дизайнер, предлагаю услуги по созданию сайтов, моё портфолио по ссылке",
      "[For Hire] I'm a freelance designer available for projects",
      "Как найти клиентов, если ты дизайнер? Делюсь опытом",
      "Mercedes решила прекратить инвестиции в Германии",
    ]) {
      const r = classifyIntent(t);
      expect(r.intent, t).toBe("none");
      expect(r.commercial).toBe(false);
    }
  });
  it("публикация с биржи — заказ, даже без фразы «ищу»", () => {
    expect(classifyIntent("Сверстать лендинг по макету в Figma", { sourceKind: "freelance" }).intent).toBe("order");
  });
  it("определяет язык", () => {
    expect(detectLanguage("Нужен сайт")).toBe("ru");
    expect(detectLanguage("Looking for a designer for the new shop")).toBe("en");
    expect(detectLanguage("Wir suchen einen Designer für die Firma")).toBe("de");
    expect(detectLanguage("Je cherche un graphiste pour le projet")).toBe("fr");
    expect(detectLanguage("Busco un diseñador para la tienda")).toBe("es");
  });
});

describe("Соответствие услуге и фильтрация", () => {
  it("словоформы и синонимы на разных языках", () => {
    expect(matchService("Нужен лендинг для кофейни", "website").score).toBeGreaterThan(40);
    expect(matchService("We need a Shopify online store", "website").score).toBeGreaterThan(40);
    expect(matchService("Нужна инфографика для карточек товаров на Ozon", "marketplace_cards").matched.length).toBeGreaterThan(1);
    expect(matchService("Ищу бухгалтера", "website").score).toBe(0);
  });
  it("совпадение в заголовке важнее; чужая роль в заголовке штрафуется", () => {
    const strong = matchService("Website build for a bakery\nWordPress", "website", [], "Website build for a bakery");
    const weak = matchService("Data entry\nCopy products from our website into a spreadsheet", "website", [], "Data entry for online shop");
    expect(strong.score).toBeGreaterThan(60);
    expect(weak.score).toBeLessThan(20);
    expect(weak.offRole).toBeTruthy();
  });
  it("пользовательские ключевые слова учитываются", () => {
    expect(matchService("Нужно меню для кофейни", "website", ["меню"]).userMatched).toEqual(["меню"]);
  });
  it("evaluatePost: язык, стоп-слова, тип заказа", () => {
    const base = { service: "website", orderType: "any", businessType: "", city: "", country: "", languages: ["ru" as const], keywords: [], exclude: ["бесплатно"] };
    const post = { externalId: "1", url: "https://x", title: "Нужен сайт", text: "Нужен сайт для кофейни", publishedAt: new Date() };
    expect(evaluatePost(post, "fl_ru", base).cand).toBeTruthy();
    expect(evaluatePost({ ...post, text: "Нужен сайт бесплатно" }, "fl_ru", base).reason).toBe("стоп-слова");
    expect(evaluatePost({ ...post, title: "Need a website", text: "Need a website for my cafe" }, "fl_ru", base).reason).toBe("язык");
    expect(evaluatePost(post, "fl_ru", { ...base, orderType: "launch" }).reason).toBe("тип заказа");
  });
  it("бюджет — только написанный автором", () => {
    expect(extractBudget("Бюджет: до 50 000 ₽")).toContain("50 000");
    expect(extractBudget("Budget $300-500")).toContain("300");
    expect(extractBudget("Нужен сайт")).toBe("");
  });
});

describe("Lead Score", () => {
  const base = { intent: "order" as const, confidence: 90, serviceMatch: 80, matchedTerms: ["сайт"], concrete: ["Указаны сроки"], budget: "40 000 ₽", publishedAt: new Date(), source: "fl_ru", contact: { email: false, phone: false, profile: false, platformReply: true }, audience: { languageOk: true, geoMatch: null, businessMatch: null } };
  it("7 объяснимых факторов, сумма максимумов 100", () => {
    const s = scoreSignal(base);
    expect(s.factors).toHaveLength(7);
    expect(s.factors.reduce((a, f) => a + f.max, 0)).toBe(100);
    expect(s.score).toBeGreaterThanOrEqual(85);
    for (const f of s.factors) expect(f.reason.length).toBeGreaterThan(0);
  });
  it("без коммерческого намерения итог ограничен 25", () => {
    expect(scoreSignal({ ...base, intent: "none", confidence: 80 }).score).toBeLessThanOrEqual(25);
  });
  it("свежесть снижает балл старых публикаций", () => {
    expect(scoreSignal({ ...base, publishedAt: new Date(Date.now() - 40 * 86_400_000) }).score).toBeLessThan(scoreSignal(base).score);
  });
  it("повторные запросы дают бонус, но не больше +9", () => {
    expect(combineLeadScore([70])).toBe(70);
    expect(combineLeadScore([70, 50, 40, 30, 20])).toBe(79);
  });
  it("температура", () => {
    expect(temperatureOf({ intent: "order", confidence: 85, serviceMatch: 70, ageDays: 1 })).toBe("hot");
    expect(temperatureOf({ intent: "recommendation", confidence: 60, serviceMatch: 50, ageDays: 2 })).toBe("warm");
    expect(temperatureOf({ intent: "launch", confidence: 60, serviceMatch: 50, ageDays: 2 })).toBe("potential");
    expect(temperatureOf({ intent: "none", confidence: 60, serviceMatch: 50, ageDays: 2 })).toBe("cold");
  });
});

describe("Идентификаторы и дедупликация (чистые функции)", () => {
  it("нормализация профиля", () => {
    expect(normalizeProfileUrl("https://www.Reddit.com/user/Foo/")).toBe("reddit.com/user/foo");
    expect(normalizeProfileUrl("https://twitter.com/abc")).toBe("x.com/abc");
  });
  it("контакты — только опубликованные в тексте, домены площадок игнорируются", () => {
    const c = extractPublicContacts("Пишите на shop@cafe.example или +7 (900) 123-45-67, сайт https://cafe.example, мы в https://t.me/cafe");
    expect(c.emails).toEqual(["shop@cafe.example"]);
    expect(c.phones).toEqual(["+79001234567"]);
    expect(c.domains).toEqual(["cafe.example"]);
  });
  it("анонимная публикация не склеивается с другими", () => {
    const a = identitiesFor({ source: "fl_ru", externalId: "1" });
    const b = identitiesFor({ source: "fl_ru", externalId: "2" });
    expect(a[0].value).not.toBe(b[0].value);
    expect(dncKeys(identitiesFor({ source: "reddit", authorUrl: "https://reddit.com/user/x", externalId: "9", emails: ["a@b.example"] }))).toEqual(
      expect.arrayContaining(["profile:reddit.com/user/x", "a@b.example", "@b.example"]),
    );
  });
});

describe("Разбор источников", () => {
  it("RSS и Atom", () => {
    const rss = `<rss><channel><item><title><![CDATA[Нужен сайт (Бюджет: 5 000 ₽)]]></title><link>https://www.fl.ru/projects/1/x.html</link><description><![CDATA[Сделать <b>лендинг</b>]]></description><pubDate>Sat, 14 Nov 2026 14:42:30 GMT</pubDate><category>Сайты</category></item></channel></rss>`;
    const [i] = parseFeed(rss);
    expect(i.title).toBe("Нужен сайт (Бюджет: 5 000 ₽)");
    expect(i.description).toBe("Сделать лендинг");
    expect(i.published?.toISOString()).toBe("2026-11-14T14:42:30.000Z");
    const atom = `<feed><entry><id>tag:x,2005:Post/1</id><published>2026-11-05T11:34:20-08:00</published><link rel="alternate" type="text/html" href="https://www.producthunt.com/products/a"/><title>A</title><content type="html">&lt;p&gt;Notes&lt;/p&gt;</content><author><name>Jane</name></author></entry></feed>`;
    const [e] = parseFeed(atom);
    expect(e.link).toBe("https://www.producthunt.com/products/a");
    expect(e.author).toBe("Jane");
    expect(e.description).toBe("Notes");
  });
  it("JSON внутри страницы (Kwork)", () => {
    const html = `<script>window.stateData={"x":1,"wantsListData":{"pagination":{"data":[{"id":5,"name":"Логотип \\"Кофе\\"","description":"Нужен логотип {срочно}"}]}},"y":2}</script>`;
    const d = extractJsonAfter(html, "wantsListData") as { pagination: { data: { id: number; name: string }[] } };
    expect(d.pagination.data[0].id).toBe(5);
    expect(d.pagination.data[0].name).toBe('Логотип "Кофе"');
  });
  it("веб-превью публичного Telegram-канала", () => {
    const html = `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="jobs/42"><div class="tgme_widget_message_text js-message_text" dir="auto">Ищу дизайнера лендинга<br/>Писать @client_anna</div><time datetime="2026-11-14T10:00:00+00:00" class="time">10:00</time></div></div>`;
    const [p] = parseTelegramPreview(html, "jobs");
    expect(p.url).toBe("https://t.me/jobs/42");
    expect(p.authorUrl).toBe("https://t.me/client_anna");
    expect(p.text).toContain("Ищу дизайнера");
  });
  it("фразы поиска и ссылки ручного режима", () => {
    expect(buildQueries({ service: "design", languages: ["ru", "en"], keywords: ["кофейня"] }, undefined, 3)).toEqual(["кофейня", "ищу дизайнера", "нужен дизайнер"]);
    expect(manualSearchUrl("linkedin", "need a website")).toContain("keywords=need%20a%20website");
    expect(SOURCES.filter((s) => s.key !== "manual").length).toBeGreaterThanOrEqual(33);
  });
});

// ---------------- Интеграция с БД ----------------

const { prisma } = await import("@/lib/db");
const { signSession } = await import("@/lib/session");
const { ingestSignal } = await import("@/lib/signals/store");
const { ADAPTERS: CHANNELS } = await import("@/lib/channels");
const { signalAnalytics } = await import("@/lib/signals/analytics");
const leadsRoute = await import("@/app/api/signals/leads/route");
const leadRoute = await import("@/app/api/signals/leads/[leadId]/route");
const draftsRoute = await import("@/app/api/signals/leads/[leadId]/drafts/route");
const attemptsRoute = await import("@/app/api/signals/leads/[leadId]/attempts/route");
const attemptRoute = await import("@/app/api/signals/attempts/[attemptId]/route");
const campaignsRoute = await import("@/app/api/signals/campaigns/route");
const draftRoute = await import("@/app/api/signals/drafts/[draftId]/route");

const ORIGIN = "http://localhost:3210";
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(h: Handler, method: string, params: Record<string, string> = {}, body?: unknown, url = `${ORIGIN}/api/test`) {
  const req = new NextRequest(url, {
    method,
    headers: { host: "localhost:3210", ...(method !== "GET" ? { origin: ORIGIN } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await h(req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

let user: { id: string; email: string; name: string; role: string };
const sig = (o: Partial<Parameters<typeof ingestSignal>[0]> & { externalId: string }) =>
  ingestSignal({
    ownerId: user.id,
    campaignId: null,
    runId: null,
    source: "reddit",
    url: `https://reddit.com/r/forhire/${o.externalId}`,
    title: "Looking for a web designer",
    text: "Looking for a web designer for my bakery website",
    authorName: "u/baker",
    publishedAt: new Date(),
    language: "en",
    budget: "",
    matchedTerms: ["website"],
    intent: "hire",
    intentScore: 80,
    intentReasons: ["test"],
    serviceMatch: 70,
    score: 72,
    scoreFactors: [],
    temperature: "hot",
    identities: [],
    service: "website",
    basis: "published_request",
    ...o,
  });

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: "signals@test.local", name: "S", passwordHash: "x" } });
  await prisma.executorProfile.create({ data: { userId: user.id, displayName: "Анна", specialization: "веб-дизайн для малого бизнеса", portfolioUrl: "https://anna.example/portfolio" } });
  sessionToken = await signSession({ sub: user.id, email: user.email, name: user.name, role: user.role });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: user.id } });
});

describe("Дедупликация и слияние", () => {
  it("одна публикация не сохраняется дважды; профиль и email склеивают лиды", async () => {
    const a = await sig({ externalId: "p1", identities: [{ kind: "profile", value: "reddit.com/user/baker" }, { kind: "source_id", value: "reddit:author:baker" }] });
    expect(a.status).toBe("new");
    expect((await sig({ externalId: "p1" })).status).toBe("duplicate");
    // Другая площадка, тот же email → отдельный лид, пока нет общего ключа
    const b = await sig({ externalId: "t1", source: "telegram", authorName: "@bakery", identities: [{ kind: "email", value: "hello@bakery.example" }, { kind: "source_id", value: "telegram:author:bakery" }] });
    expect(b.status).toBe("new");
    expect(b.leadId).not.toBe(a.leadId);
    // Публикация, где есть и профиль Reddit, и тот же email, объединяет оба лида
    const c = await sig({ externalId: "p2", score: 90, identities: [{ kind: "profile", value: "reddit.com/user/baker" }, { kind: "email", value: "hello@bakery.example" }] });
    expect(c.status).toBe("attached");
    const leads = await prisma.socialLead.findMany({ where: { ownerId: user.id }, include: { signals: true, identities: true } });
    expect(leads).toHaveLength(1);
    expect(leads[0].signals).toHaveLength(3);
    expect(leads[0].score).toBe(96); // 90 + 2 повтора × 3
    expect(await prisma.processingLog.count({ where: { ownerId: user.id, action: "merged" } })).toBe(1);
  });
});

describe("Ручное добавление, черновики, цикл обращения", () => {
  let leadId = "";
  it("ручная публикация проходит анализ и скоринг", async () => {
    const r = await call(leadsRoute.POST, "POST", {}, { source: "linkedin", url: "https://www.linkedin.com/posts/ivan-123", text: "Ищу дизайнера для лендинга кофейни в Казани, бюджет 40 000 ₽, срок 2 недели. Пишите ivan@coffee.example", authorName: "Иван", authorUrl: "https://www.linkedin.com/in/ivan", service: "website", city: "Казань" });
    expect(r.status).toBe(200);
    expect(r.json.intent).toBe("order");
    expect(r.json.score.score).toBeGreaterThan(60);
    leadId = r.json.leadId;
    const ids = await prisma.leadIdentity.findMany({ where: { leadId } });
    expect(ids.map((i) => i.kind).sort()).toEqual(["email", "profile", "source_id"]);
  });
  it("шаблон без AI: три варианта, только факты публикации и профиля", async () => {
    const r = await call(draftsRoute.POST, "POST", { leadId }, { mode: "template" });
    expect(r.status).toBe(200);
    expect(r.json.drafts.map((d: { variant: string }) => d.variant)).toEqual(["friendly", "business", "short"]);
    expect(r.json.drafts[0].body).toContain("Ищу дизайнера для лендинга");
    expect(r.json.drafts[0].body).toContain("https://anna.example/portfolio");
    // AI не подключён в тестах — понятная ошибка, а не падение
    const ai = await call(draftsRoute.POST, "POST", { leadId }, { mode: "ai" });
    expect(ai.status).toBe(503);
    expect(ai.json.error.code).toBe("ai_not_configured");
    // ручная правка сохраняется с версией
    const d = r.json.drafts[1];
    const e = await call(draftRoute.PATCH, "PATCH", { draftId: d.id }, { body: d.body + "\nP.S." });
    expect(e.json.draft.version).toBe(2);
    expect(e.json.draft.origin).toBe("edited");
  });
  it("ручная отправка: подготовлено ≠ отправлено; подтверждение → CRM, задача, аналитика", async () => {
    const opts = await call(attemptsRoute.GET, "GET", { leadId });
    const modes = opts.json.options.map((o: { mode: string }) => o.mode);
    expect(modes).toEqual(["open_dialog", "api"]);
    const prep = await call(attemptsRoute.POST, "POST", { leadId }, { mode: "open_dialog", body: "Здравствуйте! По вашему запросу…" });
    expect(prep.status).toBe(200);
    const aid = prep.json.attempt.id;
    let an = await signalAnalytics(user.id);
    expect(an.totals.attemptsPrepared).toBeGreaterThanOrEqual(1);
    expect(an.totals.confirmedSends).toBe(0);
    expect((await call(attemptRoute.POST, "POST", { attemptId: aid }, { action: "confirm" })).json.error.code).toBe("confirm_required");
    await call(attemptRoute.POST, "POST", { attemptId: aid }, { action: "open" });
    const ok = await call(attemptRoute.POST, "POST", { attemptId: aid }, { action: "confirm", confirm: true });
    expect(ok.json.attempt.status).toBe("confirmed_sent");
    const lead = await prisma.socialLead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.status).toBe("contacted");
    expect(lead.clientId).toBeTruthy();
    expect(lead.firstContactAt).toBeTruthy();
    expect(await prisma.clientTask.count({ where: { clientId: lead.clientId!, kind: "follow_up" } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.consentRecord.count({ where: { clientId: lead.clientId!, basis: "published_request" } })).toBe(1);
    an = await signalAnalytics(user.id);
    expect(an.totals.confirmedSends).toBe(1);
    expect(an.totals.replies).toBe(0);
  });
  it("повторное обращение без ответа предупреждается; email отправляется только через SMTP с подтверждением", async () => {
    const opts = await call(attemptsRoute.GET, "GET", { leadId });
    const email = opts.json.options.find((o: { mode: string }) => o.mode === "api");
    expect(email.available).toBe(true);
    expect(email.issues.some((i: { code: string }) => i.code === "recent")).toBe(true);
    const prep = await call(attemptsRoute.POST, "POST", { leadId }, { mode: "api", subject: "Лендинг", body: "Здравствуйте, Иван!" });
    const aid = prep.json.attempt.id;
    // Без SMTP — ошибка сохраняется в статусе
    const fail = await call(attemptRoute.POST, "POST", { attemptId: aid }, { action: "send", confirm: true, idempotencyKey: `signal:${aid}` });
    expect(fail.status).toBe(409);
    expect((await prisma.outreachAttempt.findUniqueOrThrow({ where: { id: aid } })).status).toBe("failed");
    process.env.SMTP_HOST = "smtp.test";
    process.env.SMTP_FROM = "Me <me@test.local>";
    const spy = vi.spyOn(CHANNELS.email, "send").mockResolvedValue({ externalId: "m1" });
    try {
      const sent = await call(attemptRoute.POST, "POST", { attemptId: aid }, { action: "send", confirm: true, idempotencyKey: `signal:${aid}:2` });
      expect(sent.json.attempt.status).toBe("sent");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].to).toBe("ivan@coffee.example");
    } finally {
      spy.mockRestore();
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_FROM;
    }
  });
  it("отказ → Do Not Contact, повторные обращения и повторный сбор запрещены", async () => {
    const att = await prisma.outreachAttempt.findFirstOrThrow({ where: { leadId, status: "confirmed_sent" } });
    await call(attemptRoute.POST, "POST", { attemptId: att.id }, { action: "outcome", outcome: "negative" });
    const lead = await prisma.socialLead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.status).toBe("declined");
    expect(lead.doNotContact).toBe(true);
    expect(await prisma.suppressionEntry.count({ where: { ownerId: user.id, value: "profile:linkedin.com/in/ivan" } })).toBe(1);
    const again = await call(attemptsRoute.POST, "POST", { leadId }, { mode: "open_dialog", body: "Ещё раз" });
    expect(again.status).toBe(409);
    expect(again.json.error.details.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(["dnc", "declined"]));
    // Тот же автор в новой публикации не собирается
    const dup = await call(leadsRoute.POST, "POST", {}, { source: "linkedin", url: "https://www.linkedin.com/posts/ivan-456", text: "Снова ищу дизайнера для нового проекта", authorUrl: "https://linkedin.com/in/ivan/", service: "website" });
    expect(dup.status).toBe(409);
    const an = await signalAnalytics(user.id);
    expect(an.totals.declined).toBe(1);
  });
  it("удаление данных: лид удалён, журнал обезличен", async () => {
    const r = await call(leadRoute.DELETE, "DELETE", { leadId }, undefined, `${ORIGIN}/api/x?block=1&reason=test`);
    expect(r.status).toBe(200);
    expect(await prisma.socialLead.count({ where: { id: leadId } })).toBe(0);
    const logs = await prisma.processingLog.findMany({ where: { leadId } });
    expect(logs.some((l) => l.action === "deleted")).toBe(true);
    expect(logs.every((l) => l.subject.startsWith("удалён:") && l.sourceUrl === "")).toBe(true);
  });
});

describe("Кампании: валидация", () => {
  it("неизвестные источники и пустые языки отклоняются", async () => {
    const bad = await call(campaignsRoute.POST, "POST", {}, { name: "X", service: "website", languages: [], sources: ["nope"], runNow: false });
    expect(bad.status).toBe(400);
    const ok = await call(campaignsRoute.POST, "POST", {}, { name: "Сайты", service: "website", languages: ["ru"], sources: ["linkedin"], schedule: "daily", runNow: false });
    expect(ok.status).toBe(200);
    expect(ok.json.campaign.nextRunAt).toBeTruthy();
  });
});

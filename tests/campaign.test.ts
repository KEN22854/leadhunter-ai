import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "lh_session" && sessionToken ? { value: sessionToken } : undefined) }),
}));

const { prisma } = await import("@/lib/db");
const { signSession } = await import("@/lib/session");
const { resetRateLimits } = await import("@/lib/ratelimit");
const { ADAPTERS } = await import("@/lib/channels");
const { processCampaigns } = await import("@/lib/campaigns");
const { logManualMessage } = await import("@/lib/outreach");
const campaignsRoute = await import("@/app/api/campaigns/route");
const campaignRoute = await import("@/app/api/campaigns/[campaignId]/route");
const approveRoute = await import("@/app/api/campaigns/[campaignId]/approve/route");
const loginRoute = await import("@/app/api/auth/login/route");
const consentsRoute = await import("@/app/api/clients/[clientId]/consents/route");
const fileRoute = await import("@/app/api/references/[referenceId]/file/route");
const refsRoute = await import("@/app/api/clients/[clientId]/references/route");

const ORIGIN = "http://localhost:3210";
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(h: Handler, method: string, params: Record<string, string> = {}, body?: unknown, headers: Record<string, string> = {}) {
  const req = new NextRequest(`${ORIGIN}/api/test`, {
    method,
    headers: { host: "localhost:3210", ...(method !== "GET" ? { origin: ORIGIN } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await h(req, { params: Promise.resolve(params) });
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, json: ct.includes("json") ? await res.json() : null, res };
}

let user: { id: string; email: string; name: string; role: string };
const CONCEPT = {
  title: "Концепция обновления сайта кофейни",
  diagnosis: "Сайт не адаптирован под телефоны.",
  problems: [{ title: "Нет мобильной версии", evidence: "нет meta viewport", severity: "high" }],
  improvements: [{ title: "Адаптивная вёрстка", why: "гости заходят с телефона", how: "mobile-first", impact: "high" }],
  structure: [{ section: "Первый экран", purpose: "оффер", content: "фото и кнопка" }],
  style: { mood: "тёплый", palette: [{ name: "Кофе", hex: "#6b4226" }], typography: "системные" },
  copy: { heroTitle: "Кофе рядом", heroSubtitle: "Обжарка каждый день", cta: "Забронировать" },
  email: { subject: "Идея для сайта", body: "Здравствуйте! Я веб-дизайнер..." },
  assumptions: [],
};

async function makeLead(n: number) {
  const c = await prisma.client.create({ data: { ownerId: user.id, companyName: `Кофейня ${n}`, city: "Казань", website: `https://cafe${n}.example` } });
  const src = await prisma.leadSource.create({ data: { clientId: c.id, sourceType: "website", sourceUrl: `https://cafe${n}.example/contacts` } });
  await prisma.contact.create({ data: { clientId: c.id, type: "email", value: `info@cafe${n}.example`, normalizedValue: `info@cafe${n}.example`, sourceId: src.id, verificationStatus: "formal" } });
  await prisma.reference.create({ data: { clientId: c.id, title: CONCEPT.title, concept: CONCEPT, emailSubject: CONCEPT.email.subject, emailBody: CONCEPT.email.body } });
  return c.id;
}

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: "camp@test.local", name: "C", passwordHash: await bcrypt.hash("correct-password", 4) } });
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  resetRateLimits();
  sessionToken = await signSession({ sub: user.id, email: user.email, name: user.name, role: user.role });
});

describe("Вход: защита от перебора", () => {
  it("лимит по учётной записи не обходится подменой X-Forwarded-For", async () => {
    sessionToken = "";
    for (let i = 0; i < 5; i++) {
      const r = await call(loginRoute.POST, "POST", {}, { email: user.email, password: "wrong" }, { "x-forwarded-for": `9.9.9.${i}` });
      expect(r.status).toBe(401);
    }
    const blocked = await call(loginRoute.POST, "POST", {}, { email: user.email, password: "correct-password" }, { "x-forwarded-for": "7.7.7.7" });
    expect(blocked.status).toBe(429);
  });
});

describe("Правовые основания", () => {
  it("отозванное основание остаётся в журнале и перестаёт действовать", async () => {
    const id = await makeLead(100);
    const r = await call(consentsRoute.POST, "POST", { clientId: id }, { basis: "legitimate_interest", note: "Деловой адрес на сайте", validDays: 30 });
    expect(r.json.consent.expiresAt).toBeTruthy();
    const req = new NextRequest(`${ORIGIN}/api/x?id=${r.json.consent.id}`, { method: "DELETE", headers: { host: "localhost:3210", origin: ORIGIN } });
    await consentsRoute.DELETE(req, { params: Promise.resolve({ clientId: id }) });
    const list = await call(consentsRoute.GET, "GET", { clientId: id });
    expect(list.json.consents[0].revokedAt).toBeTruthy();
  });
});

describe("Референсы", () => {
  it("PDF референса скачивается; генерация без AI — понятная ошибка", async () => {
    const id = await makeLead(200);
    const ref = await prisma.reference.findFirstOrThrow({ where: { clientId: id } });
    const req = new NextRequest(`${ORIGIN}/api/x?format=pdf`, { headers: { host: "localhost:3210" } });
    const res = await fileRoute.GET(req, { params: Promise.resolve({ referenceId: ref.id }) });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    const g = await call(refsRoute.POST, "POST", { clientId: id }, {});
    expect(g.json.error.code).toBe("ai_not_configured");
  });
});

describe("Кампания: одобрение → автоотправка с вложением → ответ клиента", () => {
  it("полный цикл", async () => {
    const a = await makeLead(1);
    const b = await makeLead(2);
    const created = await call(campaignsRoute.POST, "POST", {}, { name: "Кофейни Казани", clientIds: [a, b], intervalMin: 1, windowStart: 0, windowEnd: 24 });
    expect(created.status).toBe(200);
    const cid = created.json.campaign.id as string;
    const detail = await call(campaignRoute.GET, "GET", { campaignId: cid });
    expect(detail.json.items.map((i: { status: string }) => i.status)).toEqual(["ready", "ready"]);

    // Без подтверждения основания и без SMTP — отказ
    expect((await call(approveRoute.POST, "POST", { campaignId: cid }, { basisConfirmed: false, confirm: true })).json.error.code).toBe("basis_required");
    expect((await call(approveRoute.POST, "POST", { campaignId: cid }, { basisConfirmed: true, confirm: true })).json.error.code).toBe("channel_not_connected");

    process.env.SMTP_HOST = "smtp.test";
    process.env.SMTP_FROM = "Me <me@test.local>";
    const spy = vi.spyOn(ADAPTERS.email, "send").mockResolvedValue({ externalId: "m" });
    try {
      const ok = await call(approveRoute.POST, "POST", { campaignId: cid }, { basisConfirmed: true, confirm: true });
      expect(ok.json.queued).toBe(2);
      expect(await prisma.consentRecord.count({ where: { clientId: a, basis: "legitimate_interest", revokedAt: null } })).toBe(1);

      const t0 = new Date();
      expect(await processCampaigns(t0)).toBe(1);
      // Интервал не прошёл — второе письмо не уходит
      expect(await processCampaigns(new Date(t0.getTime() + 10_000))).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
      const sent = spy.mock.calls[0][0];
      expect(sent.attachments?.[0].filename).toMatch(/\.pdf$/);
      expect(sent.attachments?.[0].content.subarray(0, 4).toString()).toBe("%PDF");
      expect(sent.body).toMatch(/Отписаться/);

      // Второй клиент ответил отказом до своего письма — ему не пишем, адрес в списке запрета
      const contactB = await prisma.contact.findFirstOrThrow({ where: { clientId: b } });
      await logManualMessage(user, b, { channel: "email", contactId: contactB.id, direction: "inbound", body: "Отпишите нас, пожалуйста" });
      expect(await processCampaigns(new Date(t0.getTime() + 120_000))).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
      const items = await prisma.campaignItem.findMany({ where: { campaignId: cid }, orderBy: { createdAt: "asc" } });
      expect(items.map((i) => i.status)).toEqual(["sent", "opted_out"]);
      expect(await prisma.suppressionEntry.count({ where: { ownerId: user.id, value: "info@cafe2.example" } })).toBe(1);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: cid } })).status).toBe("done");

      // Ответ первого клиента: задача «Ответить» и статус «Переговоры»
      const contactA = await prisma.contact.findFirstOrThrow({ where: { clientId: a } });
      await logManualMessage(user, a, { channel: "email", contactId: contactA.id, direction: "inbound", body: "Интересно, давайте обсудим" });
      expect((await prisma.client.findUniqueOrThrow({ where: { id: a } })).status).toBe("negotiating");
      expect(await prisma.clientTask.count({ where: { clientId: a, kind: "follow_up" } })).toBe(1);
    } finally {
      spy.mockRestore();
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_FROM;
    }
  });
});

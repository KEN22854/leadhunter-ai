import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

// cookies() из next/headers вне Next-запроса недоступен — подставляем cookie текущего тестового пользователя
let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "lh_session" && sessionToken ? { value: sessionToken } : undefined) }),
}));

const { prisma } = await import("@/lib/db");
const { signSession } = await import("@/lib/session");
const { resetRateLimits } = await import("@/lib/ratelimit");
const { ADAPTERS } = await import("@/lib/channels");
const clientRoute = await import("@/app/api/clients/[clientId]/route");
const clientsRoute = await import("@/app/api/clients/route");
const contactsRoute = await import("@/app/api/clients/[clientId]/contacts/route");
const consentsRoute = await import("@/app/api/clients/[clientId]/consents/route");
const messagesRoute = await import("@/app/api/clients/[clientId]/messages/route");
const messageRoute = await import("@/app/api/messages/[messageId]/route");
const approveRoute = await import("@/app/api/messages/[messageId]/approve/route");
const sendRoute = await import("@/app/api/outbound/[itemId]/send/route");
const generateRoute = await import("@/app/api/clients/[clientId]/ai/messages/generate/route");
const suppressionRoute = await import("@/app/api/suppression/route");
const exportRoute = await import("@/app/api/proposals/[proposalId]/export/route");
const proposalsRoute = await import("@/app/api/clients/[clientId]/proposals/route");

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

let userA: { id: string; email: string; name: string; role: string };
let userB: typeof userA;
const loginAs = async (u: typeof userA) => {
  sessionToken = await signSession({ sub: u.id, email: u.email, name: u.name, role: u.role });
};

beforeAll(async () => {
  const hash = await bcrypt.hash("x", 4);
  userA = await prisma.user.create({ data: { email: "a@test.local", name: "A", passwordHash: hash } });
  userB = await prisma.user.create({ data: { email: "b@test.local", name: "B", passwordHash: hash } });
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(() => {
  resetRateLimits();
  sessionToken = "";
});

async function createClient() {
  await loginAs(userA);
  const r = await call(clientsRoute.POST, "POST", {}, { companyName: "ООО Тест", website: "", city: "Казань" });
  expect(r.status).toBe(200);
  return r.json.client.id as string;
}

describe("Авторизация и доступ", () => {
  it("без сессии — 401", async () => {
    const r = await call(clientsRoute.GET, "GET");
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("unauthorized");
  });

  it("чужой клиент недоступен (404), свой — доступен", async () => {
    const id = await createClient();
    expect((await call(clientRoute.GET, "GET", { clientId: id })).status).toBe(200);
    await loginAs(userB);
    expect((await call(clientRoute.GET, "GET", { clientId: id })).status).toBe(404);
    expect((await call(clientRoute.PATCH, "PATCH", { clientId: id }, { status: "won" })).status).toBe(404);
    expect((await call(contactsRoute.GET, "GET", { clientId: id })).status).toBe(404);
  });

  it("CSRF: изменяющий запрос с чужого Origin отклоняется", async () => {
    const id = await createClient();
    const r = await call(clientRoute.PATCH, "PATCH", { clientId: id }, { status: "won" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("csrf");
  });

  it("валидация входных данных — единый формат ошибки", async () => {
    const id = await createClient();
    const r = await call(contactsRoute.POST, "POST", { clientId: id }, { type: "fax", value: "" });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("validation_error");
    expect(Array.isArray(r.json.error.details)).toBe(true);
  });
});

describe("AI без ключа", () => {
  it("генерация возвращает понятное состояние «Не подключено», без имитации результата", async () => {
    const id = await createClient();
    const r = await call(generateRoute.POST, "POST", { clientId: id }, { channel: "email", service: "website", tone: "expert", goal: "start_dialog", length: "short", language: "ru" });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("ai_not_configured");
    expect(await prisma.aIMessage.count({ where: { clientId: id } })).toBe(0);
    const log = await prisma.aIUsageLog.findFirst({ where: { clientId: id } });
    expect(log?.status).toBe("not_configured");
  });
});

describe("Сообщения, версии и отправка", () => {
  async function setup() {
    const id = await createClient();
    const c = await call(contactsRoute.POST, "POST", { clientId: id }, { type: "email", value: "sales@corp.example" });
    const contactId = c.json.contact.id as string;
    const m = await call(messagesRoute.POST, "POST", { clientId: id }, { channel: "email", subject: "Тема", body: "Текст v1" });
    return { id, contactId, messageId: m.json.message.id as string };
  }

  it("правка создаёт новую версию, черновик сохраняется в БД", async () => {
    const { messageId } = await setup();
    const r = await call(messageRoute.PATCH, "PATCH", { messageId }, { body: "Текст v2" });
    expect(r.json.message.version).toBe(2);
    const full = await call(messageRoute.GET, "GET", { messageId });
    expect(full.json.message.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it("без правового основания подготовка к отправке блокируется", async () => {
    const { messageId, contactId } = await setup();
    const r = await call(approveRoute.POST, "POST", { messageId }, { contactId });
    expect(r.status).toBe(409);
    expect(r.json.error.details.issues.map((i: { code: string }) => i.code)).toContain("no_basis");
  });

  it("suppression-list по домену блокирует обращение", async () => {
    const { id, messageId, contactId } = await setup();
    await call(consentsRoute.POST, "POST", { clientId: id }, { basis: "legitimate_interest", note: "B2B-адрес" });
    await call(suppressionRoute.POST, "POST", {}, { type: "domain", value: "corp.example" });
    const r = await call(approveRoute.POST, "POST", { messageId }, { contactId });
    expect(r.status).toBe(409);
    expect(r.json.error.details.issues.map((i: { code: string }) => i.code)).toContain("suppressed");
    await prisma.suppressionEntry.deleteMany({ where: { ownerId: userA.id } });
  });

  it("отправка: без подключения канала — 409; с подключением — ровно одна отправка при повторе того же ключа", async () => {
    const { id, messageId, contactId } = await setup();
    await call(consentsRoute.POST, "POST", { clientId: id }, { basis: "legitimate_interest", note: "B2B-адрес" });
    const q = await call(approveRoute.POST, "POST", { messageId }, { contactId });
    expect(q.status).toBe(200);
    const itemId = q.json.item.id as string;
    expect(q.json.item.body).toMatch(/Отписаться/);

    // Без подтверждения confirm=true — отказ валидации
    expect((await call(sendRoute.POST, "POST", { itemId }, { idempotencyKey: "k-12345678" })).status).toBe(400);
    // Канал не подключён
    const nc = await call(sendRoute.POST, "POST", { itemId }, { confirm: true, idempotencyKey: "k-12345678" });
    expect(nc.json.error.code).toBe("channel_not_connected");

    process.env.SMTP_HOST = "smtp.test";
    process.env.SMTP_FROM = "me@test.local";
    const spy = vi.spyOn(ADAPTERS.email, "send").mockResolvedValue({ externalId: "msg-1", threadId: "sales@corp.example" });
    try {
      const a = await call(sendRoute.POST, "POST", { itemId }, { confirm: true, idempotencyKey: "same-key-123" });
      const b = await call(sendRoute.POST, "POST", { itemId }, { confirm: true, idempotencyKey: "same-key-123" });
      expect(a.json.item.status).toBe("sent");
      expect(b.json.item.status).toBe("sent");
      expect(spy).toHaveBeenCalledTimes(1);
      const again = await call(sendRoute.POST, "POST", { itemId }, { confirm: true, idempotencyKey: "other-key-123" });
      expect(again.status).toBe(409);
      expect((await prisma.client.findUnique({ where: { id } }))?.status).toBe("contacted");
    } finally {
      spy.mockRestore();
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_FROM;
    }
  });

  it("ошибка канала: статус «ошибка», черновик сохраняется, повтор возможен", async () => {
    const { id, messageId, contactId } = await setup();
    await call(consentsRoute.POST, "POST", { clientId: id }, { basis: "consent", note: "Клиент сам попросил КП" });
    const itemId = (await call(approveRoute.POST, "POST", { messageId }, { contactId })).json.item.id;
    process.env.SMTP_HOST = "smtp.test";
    process.env.SMTP_FROM = "me@test.local";
    const spy = vi.spyOn(ADAPTERS.email, "send").mockRejectedValueOnce(new Error("SMTP timeout")).mockResolvedValueOnce({ externalId: "ok" });
    try {
      const f = await call(sendRoute.POST, "POST", { itemId }, { confirm: true, idempotencyKey: "try-1-xxxx" });
      expect(f.json.item.status).toBe("failed");
      expect(f.json.item.error).toMatch(/SMTP timeout/);
      expect(f.json.item.body).toMatch(/Текст v1/);
      const ok = await call(sendRoute.POST, "POST", { itemId }, { confirm: true, idempotencyKey: "try-2-xxxx" });
      expect(ok.json.item.status).toBe("sent");
    } finally {
      spy.mockRestore();
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_FROM;
    }
  });
});

describe("КП и экспорт", () => {
  it("экспорт PDF и DOCX возвращает валидные файлы", async () => {
    const id = await createClient();
    const p = await call(proposalsRoute.POST, "POST", { clientId: id }, { title: "КП", blocks: [{ key: "task", body: "Задача клиента — кириллица" }] });
    for (const [format, magic] of [
      ["pdf", "%PDF-"],
      ["docx", "PK"],
    ] as const) {
      const r = await call(exportRoute.POST, "POST", { proposalId: p.json.proposal.id }, { format });
      expect(r.status).toBe(200);
      const buf = Buffer.from(await r.res.arrayBuffer());
      expect(buf.subarray(0, magic.length).toString("latin1")).toBe(magic);
      expect(buf.length).toBeGreaterThan(1000);
    }
  });
});

describe("Удаление данных", () => {
  it("удаление клиента с внесением контактов в список запрета", async () => {
    const id = await createClient();
    await call(contactsRoute.POST, "POST", { clientId: id }, { type: "email", value: "gone@del.example" });
    const r = await call(clientRoute.DELETE, "DELETE", { clientId: id }, undefined);
    expect(r.status).toBe(200);
    expect(await prisma.client.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.suppressionEntry.findFirst({ where: { ownerId: userA.id, value: "gone@del.example" } })).toBeNull();

    const id2 = await createClient();
    await call(contactsRoute.POST, "POST", { clientId: id2 }, { type: "email", value: "gone2@del.example" });
    const req = new NextRequest(`${ORIGIN}/api/clients/${id2}?suppress=1`, { method: "DELETE", headers: { host: "localhost:3210", origin: ORIGIN } });
    const res = await clientRoute.DELETE(req, { params: Promise.resolve({ clientId: id2 }) });
    expect(res.status).toBe(200);
    expect(await prisma.suppressionEntry.findFirst({ where: { ownerId: userA.id, value: "gone2@del.example" } })).not.toBeNull();
  });
});

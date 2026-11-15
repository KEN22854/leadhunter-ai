import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Ответы в Threads через официальный API: подготовка, одобрение, очередь с паузой и дневным лимитом,
// «один ответ одному автору». Сеть подменена: запросы к graph.threads.net перехватываются.

let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "lh_session" && sessionToken ? { value: sessionToken } : undefined) }),
}));

const { prisma } = await import("@/lib/db");
const { signSession } = await import("@/lib/session");
const { ingestSignal } = await import("@/lib/signals/store");
const { channelOptions, processThreadsQueue } = await import("@/lib/signals/outreach");
const bulkRoute = await import("@/app/api/signals/outbox/bulk/route");
const approveRoute = await import("@/app/api/signals/outbox/approve/route");
const outboxRoute = await import("@/app/api/signals/outbox/route");
const attemptsRoute = await import("@/app/api/signals/leads/[leadId]/attempts/route");
const attemptRoute = await import("@/app/api/signals/attempts/[attemptId]/route");

const ORIGIN = "http://localhost:3210";
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(h: Handler, method: string, params: Record<string, string> = {}, body?: unknown) {
  const req = new NextRequest(`${ORIGIN}/api/x`, {
    method,
    headers: { host: "localhost:3210", ...(method !== "GET" ? { origin: ORIGIN } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await h(req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const published: { replyTo: string; text: string }[] = [];
const realFetch = globalThis.fetch;
let user: { id: string; email: string; name: string; role: string };
const leads: string[] = [];

async function threadsLead(n: number) {
  const r = await ingestSignal({
    ownerId: user.id,
    campaignId: null,
    runId: null,
    source: "threads",
    externalId: `1790000000${n}`,
    url: `https://www.threads.net/@client${n}/post/${n}`,
    title: "Ищу дизайнера для лендинга кофейни",
    text: "Ищу дизайнера для лендинга кофейни, бюджет 30 000 ₽",
    authorName: `@client${n}`,
    authorUrl: `https://www.threads.net/@client${n}`,
    publishedAt: new Date(),
    language: "ru",
    budget: "30 000 ₽",
    matchedTerms: ["лендинг"],
    intent: "order",
    intentScore: 85,
    intentReasons: ["test"],
    serviceMatch: 70,
    score: 85,
    scoreFactors: [],
    temperature: "hot",
    identities: [
      { kind: "profile", value: `threads.net/@client${n}` },
      { kind: "source_id", value: `threads:author:client${n}` },
    ],
    service: "website",
    basis: "published_request",
  });
  return r.leadId!;
}

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: "threads@test.local", name: "T", passwordHash: "x" } });
  await prisma.executorProfile.create({ data: { userId: user.id, displayName: "Анна", specialization: "дизайн лендингов", portfolioUrl: "https://anna.example" } });
  sessionToken = await signSession({ sub: user.id, email: user.email, name: user.name, role: user.role });
  process.env.THREADS_ACCESS_TOKEN = "test-threads-token";
  process.env.THREADS_DAILY_REPLY_LIMIT = "2";
  process.env.THREADS_REPLY_INTERVAL_MIN = "5";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (u.hostname !== "graph.threads.net") return realFetch(input, init);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname.endsWith("/me/threads_publishing_limit")) return json({ data: [{ reply_quota_usage: published.length, reply_config: { quota_total: 1000 } }] });
    if (u.pathname.endsWith("/me/threads") && init?.method === "POST") {
      published.push({ replyTo: u.searchParams.get("reply_to_id") ?? "", text: u.searchParams.get("text") ?? "" });
      return json({ id: `c${published.length}` });
    }
    if (u.pathname.endsWith("/me/threads_publish")) return json({ id: `r${published.length}` });
    return json({ status: "FINISHED" });
  }) as typeof fetch;
  for (const n of [1, 2, 3]) leads.push(await threadsLead(n));
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  delete process.env.THREADS_ACCESS_TOKEN;
  delete process.env.THREADS_DAILY_REPLY_LIMIT;
  delete process.env.THREADS_REPLY_INTERVAL_MIN;
  await prisma.user.deleteMany({ where: { id: user.id } });
});

describe("Ответы в Threads через API", () => {
  it("вариант связи «Threads API» доступен для постов из Threads", async () => {
    const o = (await channelOptions(leads[0])).find((x) => x.channel === "threads" && x.mode === "api");
    expect(o?.available).toBe(true);
    expect(o?.target).toBe("17900000001");
  });
  it("текст длиннее 500 символов не готовится", async () => {
    const r = await call(attemptsRoute.POST, "POST", { leadId: leads[2] }, { mode: "api", channel: "threads", body: "а".repeat(501) });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("too_long");
  });
  it("массовая подготовка ничего не отправляет; повторно тех же лидов не берёт", async () => {
    const r = await call(bulkRoute.POST, "POST", {}, { mode: "template", limit: 10 });
    expect(r.status).toBe(200);
    expect(r.json.results.filter((x: { status: string }) => x.status === "prepared")).toHaveLength(3);
    expect(published).toHaveLength(0);
    const again = await call(bulkRoute.POST, "POST", {}, { mode: "template", limit: 10 });
    expect(again.json.results).toHaveLength(0);
    const ob = await call(outboxRoute.GET, "GET");
    expect(ob.json.items.filter((i: { status: string }) => i.status === "prepared")).toHaveLength(3);
    expect(ob.json.items[0].body.length).toBeLessThanOrEqual(500);
  });
  it("без подтверждения одобрить нельзя; одобренное уходит по одному с паузой", async () => {
    const ob = await call(outboxRoute.GET, "GET");
    const ids = ob.json.items.map((i: { id: string }) => i.id);
    expect((await call(approveRoute.POST, "POST", {}, { ids })).status).toBe(400);
    const ok = await call(approveRoute.POST, "POST", {}, { ids, confirm: true });
    expect(ok.json.queued).toBe(3);
    expect(await processThreadsQueue()).toMatchObject({ sent: 1 });
    expect(published).toHaveLength(1);
    expect(published[0].replyTo).toMatch(/^1790000000\d$/);
    // Пауза 5 минут ещё не прошла — второй не уходит
    expect(await processThreadsQueue()).toMatchObject({ sent: 0 });
    expect(published).toHaveLength(1);
    const sentAttempt = await prisma.outreachAttempt.findFirstOrThrow({ where: { status: "sent", channel: "threads" }, include: { lead: true } });
    expect(sentAttempt.outboundId).toBe("r1");
    expect(sentAttempt.lead.status).toBe("contacted");
    expect(sentAttempt.lead.clientId).toBeTruthy();
  });
  it("дневной лимит приложения соблюдается и при ручной отправке", async () => {
    const queued = await prisma.outreachAttempt.findMany({ where: { status: "queued", channel: "threads" } });
    const first = await call(attemptRoute.POST, "POST", { attemptId: queued[0].id }, { action: "send", confirm: true });
    expect(first.json.attempt.status).toBe("sent");
    const second = await call(attemptRoute.POST, "POST", { attemptId: queued[1].id }, { action: "send", confirm: true });
    expect(second.status).toBe(429);
    expect(second.json.error.code).toBe("daily_limit");
    expect(published).toHaveLength(2);
  });
  it("одному автору — только один ответ", async () => {
    const lead = (await prisma.outreachAttempt.findFirstOrThrow({ where: { status: "sent", channel: "threads" } })).leadId;
    const r = await call(attemptsRoute.POST, "POST", { leadId: lead }, { mode: "api", channel: "threads", body: "Ещё раз здравствуйте" });
    expect(r.status).toBe(409);
    expect(r.json.error.details.issues.map((i: { code: string }) => i.code)).toContain("already_replied");
  });
});

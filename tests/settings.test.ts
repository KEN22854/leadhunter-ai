import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "lh_session" && sessionToken ? { value: sessionToken } : undefined) }),
}));

const { prisma } = await import("@/lib/db");
const { signSession } = await import("@/lib/session");
const { encrypt, decrypt, applyStoredSettings } = await import("@/lib/settings-store");
const { ADAPTERS } = await import("@/lib/channels");
const connRoute = await import("@/app/api/settings/connections/route");
const loginRoute = await import("@/app/api/auth/login/route");

const ORIGIN = "http://localhost:3210";
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function call(h: Handler, method: string, body?: unknown) {
  const req = new NextRequest(`${ORIGIN}/api/x`, {
    method,
    headers: { host: "localhost:3210", ...(method !== "GET" ? { origin: ORIGIN } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await h(req, { params: Promise.resolve({}) });
  return { status: res.status, json: await res.json().catch(() => null), res };
}

let admin: { id: string; email: string; name: string; role: string };
let manager: { id: string; email: string; name: string; role: string };
const session = (u: typeof admin) => signSession({ sub: u.id, email: u.email, name: u.name, role: u.role });

beforeAll(async () => {
  admin = await prisma.user.create({ data: { email: "root", name: "Admin", role: "admin", passwordHash: await bcrypt.hash("root-password-1", 4) } });
  manager = await prisma.user.create({ data: { email: "mgr@test.local", name: "M", role: "manager", passwordHash: "x" } });
});
afterAll(async () => {
  await prisma.appState.deleteMany({ where: { key: { startsWith: "cfg:" } } });
  await applyStoredSettings();
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, manager.id] } } });
});

describe("Настройки подключений", () => {
  it("шифрование секретов", () => {
    const e = encrypt("app-password-123");
    expect(e.startsWith("enc:v1:")).toBe(true);
    expect(e).not.toContain("app-password");
    expect(decrypt(e)).toBe("app-password-123");
  });
  it("доступно только администратору", async () => {
    sessionToken = await session(manager);
    expect((await call(connRoute.GET, "GET")).status).toBe(403);
    expect((await call(connRoute.PUT, "PUT", { values: { SMTP_HOST: "x" } })).status).toBe(403);
  });
  it("сохранение применяется сразу; секрет не возвращается и зашифрован в БД", async () => {
    sessionToken = await session(admin);
    expect(ADAPTERS.email.status().state).toBe("not_configured");
    const r = await call(connRoute.PUT, "PUT", { values: { SMTP_HOST: "smtp.test", SMTP_FROM: "Me <me@test.local>", SMTP_PASS: "super-secret-pass" } });
    expect(r.status).toBe(200);
    expect(ADAPTERS.email.status().state).toBe("connected");
    expect(process.env.SMTP_PASS).toBe("super-secret-pass");
    const body = JSON.stringify(r.json);
    expect(body).not.toContain("super-secret-pass");
    expect(body).toContain("••••pass");
    const row = await prisma.appState.findUniqueOrThrow({ where: { key: "cfg:SMTP_PASS" } });
    expect(row.value).not.toContain("super-secret");
    // Неизвестные ключи (например, AUTH_SECRET) менять нельзя
    expect((await call(connRoute.PUT, "PUT", { values: { AUTH_SECRET: "x" } })).status).toBe(400);
    // Очистка возвращает значение .env (здесь — пусто)
    await call(connRoute.PUT, "PUT", { values: { SMTP_HOST: "", SMTP_FROM: "", SMTP_PASS: "" } });
    expect(ADAPTERS.email.status().state).toBe("not_configured");
    expect(process.env.SMTP_PASS ?? "").toBe("");
  });
  it("вход по короткому логину", async () => {
    const ok = await call(loginRoute.POST, "POST", { email: "Root", password: "root-password-1" });
    expect(ok.status).toBe(200);
    const bad = await call(loginRoute.POST, "POST", { email: "root", password: "wrong" });
    expect(bad.status).toBe(401);
  });
});

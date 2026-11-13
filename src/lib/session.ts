// Подпись/проверка сессионного JWT. Без зависимостей от Node — используется и в middleware (edge).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "lh_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET не задан или короче 32 символов");
  return new TextEncoder().encode(s);
}

export type SessionPayload = { sub: string; email: string; name: string; role: string };

export async function signSession(p: SessionPayload) {
  return new SignJWT({ email: p.email, name: p.name, role: p.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: String(payload.role ?? "manager"),
    };
  } catch {
    return null;
  }
}

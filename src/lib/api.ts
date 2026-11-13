import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { checkRateLimit } from "./ratelimit";

/** Единый формат ошибок API: { error: { code, message, details? } } */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Ctx = { params: Promise<Record<string, string>> };

export function handler(fn: (req: NextRequest, params: Record<string, string>) => Promise<Response | unknown>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      assertSameOrigin(req);
      const params = ctx?.params ? await ctx.params : {};
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      const rl = checkRateLimit(`api:${ip}`, 300);
      if (!rl.ok) throw new ApiError(429, "rate_limited", "Слишком много запросов", { retryAfterSec: rl.retryAfterSec });
      const out = await fn(req, params);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) {
    const res = NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
    if (e.status === 429 && e.details && typeof e.details === "object" && "retryAfterSec" in e.details) {
      res.headers.set("Retry-After", String((e.details as { retryAfterSec: number }).retryAfterSec));
    }
    return res;
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Некорректные данные", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 400 },
    );
  }
  console.error("[api] unexpected error", e);
  return NextResponse.json({ error: { code: "internal_error", message: "Внутренняя ошибка сервера" } }, { status: 500 });
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Тело запроса должно быть JSON");
  }
  return schema.parse(raw);
}

/** CSRF-защита: для изменяющих запросов Origin обязан совпадать с хостом. Cookie сессии — SameSite=Lax. */
export function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) throw new ApiError(403, "csrf", "Отсутствует заголовок Origin");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    /* empty */
  }
  if (!host || originHost !== host) throw new ApiError(403, "csrf", "Запрос с чужого источника отклонён");
}

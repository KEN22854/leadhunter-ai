import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, handler, parseBody } from "@/lib/api";
import { checkRateLimit, resetRateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession } from "@/lib/session";

// Поле email принимает и email, и короткий логин (например, admin)
const Body = z.object({ email: z.string().trim().min(1, "Введите логин или email").max(200), password: z.string().min(1).max(200) });

export const POST = handler(async (req) => {
  const { email, password } = await parseBody(req, Body);
  const ip = clientIp(req.headers);
  const account = email.toLowerCase();
  // Лимит и по адресу, и по учётной записи: смена заголовков не даёт перебирать пароль одного аккаунта
  const byIp = checkRateLimit(`login-ip:${ip}`, 20);
  const byAccount = checkRateLimit(`login-acc:${account}`, 5, 5 * 60_000);
  if (!byIp.ok || !byAccount.ok)
    throw new ApiError(429, "rate_limited", "Слишком много попыток входа, подождите несколько минут", {
      retryAfterSec: Math.max(byIp.retryAfterSec, byAccount.retryAfterSec),
    });
  const user = await prisma.user.findUnique({ where: { email: account } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new ApiError(401, "invalid_credentials", "Неверный логин или пароль");
  resetRateLimit(`login-acc:${account}`);
  const token = await signSession({ sub: user.id, email: user.email, name: user.name, role: user.role });
  const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
});

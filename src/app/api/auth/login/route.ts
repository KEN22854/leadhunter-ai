import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, handler, parseBody } from "@/lib/api";
import { checkRateLimit } from "@/lib/ratelimit";
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession } from "@/lib/session";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const POST = handler(async (req) => {
  const { email, password } = await parseBody(req, Body);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!checkRateLimit(`login:${ip}`, 10).ok) throw new ApiError(429, "rate_limited", "Слишком много попыток входа, подождите минуту");
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new ApiError(401, "invalid_credentials", "Неверный email или пароль");
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

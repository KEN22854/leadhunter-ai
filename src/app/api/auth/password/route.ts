import bcrypt from "bcryptjs";
import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/ratelimit";
import { audit } from "@/lib/timeline";

export const POST = handler(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, z.object({ current: z.string().min(1).max(200), next: z.string().min(10, "Пароль — не короче 10 символов").max(200) }));
  if (!checkRateLimit(`pwd:${user.id}`, 5, 15 * 60_000).ok) throw new ApiError(429, "rate_limited", "Слишком много попыток, подождите");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await bcrypt.compare(b.current, u.passwordHash))) throw new ApiError(400, "invalid_password", "Текущий пароль неверен");
  if (b.current === b.next) throw new ApiError(400, "same_password", "Новый пароль совпадает с текущим");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(b.next, 12) } });
  await audit(user.id, "user.password_change", "User", user.id);
  return { ok: true };
});

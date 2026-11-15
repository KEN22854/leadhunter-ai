import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { SESSION_COOKIE, verifySession } from "./session";
import { ApiError } from "./api";

export type CurrentUser = { id: string; email: string; name: string; role: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  // Пользователь мог быть удалён — сверяемся с БД
  const u = await prisma.user.findUnique({ where: { id: s.sub }, select: { id: true, email: true, name: true, role: true } });
  return u;
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new ApiError(401, "unauthorized", "Требуется вход в систему");
  return u;
}

/** Только администратор (глобальные настройки подключений, пользователи). */
export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== "admin") throw new ApiError(403, "forbidden", "Доступно только администратору");
  return u;
}

/** Проверка доступа к клиенту на сервере. Чужой клиент = 404, чтобы не раскрывать факт существования. */
export async function requireClientAccess(user: CurrentUser, clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client || (client.ownerId !== user.id && user.role !== "admin")) {
    throw new ApiError(404, "not_found", "Клиент не найден или нет прав доступа");
  }
  return client;
}

import { ApiError, handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enrichResult } from "@/lib/discovery/service";

export const runtime = "nodejs";

/** Повторная проверка сайта и поиск email для одного результата. */
export const POST = handler(async (_req, { resultId }) => {
  const user = await requireUser();
  const r = await prisma.searchResult.findUnique({ where: { id: resultId } });
  if (!r || r.ownerId !== user.id) throw new ApiError(404, "not_found", "Результат не найден");
  await prisma.searchResult.update({ where: { id: resultId }, data: { enrichStatus: "pending", enrichError: "" } });
  await enrichResult(resultId);
  return { result: await prisma.searchResult.findUnique({ where: { id: resultId } }) };
});

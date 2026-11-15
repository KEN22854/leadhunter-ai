import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireSearch } from "@/lib/guards";

export const runtime = "nodejs";

/** Остановить поиск без ограничения: найденное сохраняется, фоновая выборка завершается после текущей страницы. */
export const POST = handler(async (_req, { searchId }) => {
  const user = await requireUser();
  const s = await requireSearch(user, searchId);
  if (s.status !== "running") return { search: s };
  return { search: await prisma.leadSearch.update({ where: { id: searchId }, data: { stopRequested: true } }) };
});

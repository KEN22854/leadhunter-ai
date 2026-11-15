import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/ratelimit";
import { startSearch } from "@/lib/discovery/service";

export const runtime = "nodejs";

export const GET = handler(async () => {
  const user = await requireUser();
  const searches = await prisma.leadSearch.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" }, take: 30 });
  // Счётчики агрегатами — без загрузки тысяч строк результатов
  const ids = searches.map((s) => s.id);
  const [all, mail] = await Promise.all([
    prisma.searchResult.groupBy({ by: ["searchId"], where: { searchId: { in: ids } }, _count: { _all: true } }),
    prisma.searchResult.groupBy({ by: ["searchId"], where: { searchId: { in: ids }, hasEmail: true }, _count: { _all: true } }),
  ]);
  const total = new Map(all.map((r) => [r.searchId, r._count._all]));
  const withEmail = new Map(mail.map((r) => [r.searchId, r._count._all]));
  return { searches: searches.map((s) => ({ ...s, resultCount: total.get(s.id) ?? 0, withEmail: withEmail.get(s.id) ?? 0 })) };
});

export const POST = handler(async (req) => {
  const user = await requireUser();
  const b = await parseBody(
    req,
    z.object({
      category: z.string().min(1).max(40),
      customTag: z.string().max(120).optional(),
      // Город и страна необязательны: без города — вся страна, без обоих — весь мир
      city: z.string().trim().max(100).default(""),
      country: z.string().trim().max(100).default(""),
      onlyWithContacts: z.boolean().default(true),
      // Пусто/null — без ограничения (партиями, до лимита честного использования источника)
      limit: z.number().int().min(5).max(5000).nullable().default(null),
    }),
  );
  const rl = checkRateLimit(`search:${user.id}`, 6);
  if (!rl.ok) throw new ApiError(429, "rate_limited", `Слишком много поисков подряд, подождите ${rl.retryAfterSec} с.`, { retryAfterSec: rl.retryAfterSec });
  return { search: await startSearch(user, b) };
});

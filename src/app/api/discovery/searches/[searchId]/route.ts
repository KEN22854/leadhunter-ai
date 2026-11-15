import type { Prisma } from "@prisma/client";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireSearch } from "@/lib/guards";

export const runtime = "nodejs";

const SORTS: Record<string, Prisma.SearchResultOrderByWithRelationInput[]> = {
  // По умолчанию: популярность + известность + возможность написать
  rank: [{ rank: "desc" }, { name: "asc" }],
  worst_site: [{ auditScore: { sort: "asc", nulls: "last" } }, { rank: "desc" }],
  best_site: [{ auditScore: { sort: "desc", nulls: "last" } }, { rank: "desc" }],
  name: [{ name: "asc" }],
  newest: [{ createdAt: "desc" }],
};

/**
 * Результаты поиска постранично с фильтрами:
 * page, pageSize (≤100), sort, contact=email|website|phone|any_contact|no_site, opportunity=high,medium,low,
 * status=pending|done|failed|no_site, imported=yes|no, q (название/адрес), city, country, minRank, auditMax.
 */
export const GET = handler(async (req, { searchId }) => {
  const user = await requireUser();
  const search = await requireSearch(user, searchId);
  const sp = new URL(req.url).searchParams;
  const pageSize = Math.min(100, Math.max(10, Number(sp.get("pageSize")) || 50));
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const where: Prisma.SearchResultWhereInput = { searchId };
  const and: Prisma.SearchResultWhereInput[] = [];
  const contact = sp.get("contact");
  if (contact === "email") and.push({ hasEmail: true });
  else if (contact === "website") and.push({ hasWebsite: true });
  else if (contact === "phone") and.push({ phone: { not: "" } });
  else if (contact === "any_contact") and.push({ OR: [{ hasEmail: true }, { hasWebsite: true }, { phone: { not: "" } }] });
  else if (contact === "no_site") and.push({ hasWebsite: false });
  const opp = sp.get("opportunity");
  if (opp) and.push({ opportunity: { in: opp.split(",") } });
  const status = sp.get("status");
  if (status === "pending") and.push({ enrichStatus: { in: ["pending", "running"] } });
  else if (status) and.push({ enrichStatus: status });
  if (sp.get("imported") === "yes") and.push({ clientId: { not: null } });
  if (sp.get("imported") === "no") and.push({ clientId: null });
  const q = sp.get("q")?.trim();
  if (q) and.push({ OR: [{ name: { contains: q } }, { address: { contains: q } }, { website: { contains: q } }] });
  if (sp.get("city")) and.push({ city: { contains: sp.get("city")!.trim() } });
  if (sp.get("country")) and.push({ country: { contains: sp.get("country")!.trim() } });
  if (sp.get("minRank")) and.push({ rank: { gte: Number(sp.get("minRank")) || 0 } });
  if (sp.get("auditMax")) and.push({ auditScore: { lte: Number(sp.get("auditMax")) || 100 } });
  if (and.length) where.AND = and;

  const [results, filtered, total, pending, withEmail, imported, countries] = await Promise.all([
    prisma.searchResult.findMany({ where, orderBy: SORTS[sp.get("sort") ?? "rank"] ?? SORTS.rank, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.searchResult.count({ where }),
    prisma.searchResult.count({ where: { searchId } }),
    prisma.searchResult.count({ where: { searchId, enrichStatus: { in: ["pending", "running"] } } }),
    prisma.searchResult.count({ where: { searchId, hasEmail: true } }),
    prisma.searchResult.count({ where: { searchId, clientId: { not: null } } }),
    search.scope === "city" ? Promise.resolve([]) : prisma.searchResult.groupBy({ by: ["country"], where: { searchId }, _count: { _all: true }, orderBy: { _count: { country: "desc" } }, take: 30 }),
  ]);
  const importedIds = await prisma.searchResult.findMany({ where: { searchId, clientId: { not: null } }, select: { clientId: true }, distinct: ["clientId"] });
  return {
    search,
    results,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(filtered / pageSize)),
    filtered,
    progress: { total, pending, withEmail, imported },
    importedClientIds: importedIds.map((r) => r.clientId!),
    countries: (countries as { country: string; _count: { _all: number } }[]).filter((c) => c.country).map((c) => ({ country: c.country, count: c._count._all })),
  };
});

export const DELETE = handler(async (_req, { searchId }) => {
  const user = await requireUser();
  await requireSearch(user, searchId);
  await prisma.leadSearch.update({ where: { id: searchId }, data: { stopRequested: true } }).catch(() => {});
  await prisma.leadSearch.delete({ where: { id: searchId } });
  return { ok: true };
});

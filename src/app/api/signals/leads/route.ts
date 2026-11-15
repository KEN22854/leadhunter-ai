import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertPublicUrl } from "@/lib/webfetch";
import { addManualSignal } from "@/lib/signals/engine";
import { SOURCE_MAP } from "@/lib/signals/catalog";
import { SIGNAL_SERVICES } from "@/lib/signals/lexicon";

export const runtime = "nodejs";

export const GET = handler(async (req) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const where: Prisma.SocialLeadWhereInput = { ownerId: user.id };
  const temp = sp.get("temperature");
  if (temp) where.temperature = { in: temp.split(",") };
  const status = sp.get("status");
  if (status) where.status = { in: status.split(",") };
  else where.status = { not: "archived" };
  if (sp.get("source")) where.primarySource = sp.get("source")!;
  if (sp.get("minScore")) where.score = { gte: Number(sp.get("minScore")) || 0 };
  if (sp.get("campaignId")) where.signals = { some: { campaignId: sp.get("campaignId")! } };
  const q = sp.get("q")?.trim();
  if (q) where.OR = [{ displayName: { contains: q } }, { signals: { some: { OR: [{ title: { contains: q } }, { text: { contains: q } }] } } }];
  const sort = sp.get("sort") === "recent" ? [{ lastSeenAt: "desc" as const }] : [{ score: "desc" as const }, { lastSeenAt: "desc" as const }];
  const pageSize = Math.min(100, Math.max(10, Number(sp.get("pageSize")) || 50));
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const filtered = await prisma.socialLead.count({ where });
  const leads = await prisma.socialLead.findMany({
    where,
    orderBy: sort,
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { signals: { orderBy: { score: "desc" }, take: 1, select: { id: true, title: true, url: true, source: true, publishedAt: true, budget: true, intent: true } }, _count: { select: { signals: true, attempts: true } } },
  });
  const counts = await prisma.socialLead.groupBy({ by: ["temperature"], where: { ownerId: user.id, status: { not: "archived" } }, _count: { _all: true } });
  return { leads, page, pages: Math.max(1, Math.ceil(filtered / pageSize)), filtered, counts: Object.fromEntries(counts.map((c) => [c.temperature, c._count._all])) };
});

/** Ручное добавление публикации (ручной режим источников) */
export const POST = handler(async (req) => {
  const user = await requireUser();
  const b = await parseBody(
    req,
    z.object({
      source: z.string().max(40).default("manual"),
      url: z.string().url("Ссылка на публикацию").max(1000),
      text: z.string().trim().min(15, "Вставьте текст публикации").max(8000),
      title: z.string().trim().max(300).optional(),
      authorName: z.string().trim().max(200).optional(),
      authorUrl: z.string().url().max(500).optional().or(z.literal("")),
      publishedAt: z.string().datetime().optional().or(z.literal("")),
      service: z.string().refine((s) => s in SIGNAL_SERVICES, "Выберите услугу"),
      country: z.string().max(80).optional(),
      city: z.string().max(80).optional(),
    }),
  );
  await assertPublicUrl(b.url).catch((e) => {
    throw new ApiError(400, "bad_url", e instanceof Error ? e.message : "Некорректная ссылка");
  });
  if (b.source !== "manual" && !SOURCE_MAP[b.source]) throw new ApiError(400, "bad_source", "Неизвестный источник");
  return addManualSignal(user, { ...b, authorUrl: b.authorUrl || undefined, publishedAt: b.publishedAt ? new Date(b.publishedAt) : null });
});

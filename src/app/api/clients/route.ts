import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CLIENT_STATUSES, keysOf } from "@/lib/domain";
import { recalcScore } from "@/lib/scoring";
import { logInteraction } from "@/lib/timeline";

export const GET = handler(async (req) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim();
  const status = sp.get("status");
  const archived = sp.get("archived") === "1";
  const where: Prisma.ClientWhereInput = {
    ownerId: user.id,
    archived,
    ...(status && status in CLIENT_STATUSES ? { status } : {}),
    ...(q ? { OR: [{ companyName: { contains: q } }, { website: { contains: q } }, { city: { contains: q } }, { industry: { contains: q } }] } : {}),
  };
  const clients = await prisma.client.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { scores: { orderBy: { calculatedAt: "desc" }, take: 1, select: { score: true } }, _count: { select: { contacts: true, tasks: true } } },
  });
  return {
    clients: clients.map(({ scores, ...c }) => ({ ...c, score: scores[0]?.score ?? null })),
  };
});

const Create = z.object({
  companyName: z.string().trim().min(1).max(200),
  website: z.string().trim().max(300).optional().default(""),
  industry: z.string().trim().max(200).optional().default(""),
  category: z.string().trim().max(200).optional().default(""),
  country: z.string().trim().max(100).optional().default(""),
  city: z.string().trim().max(100).optional().default(""),
  description: z.string().trim().max(4000).optional().default(""),
  language: z.string().trim().max(10).optional().default("ru"),
  status: z.enum(keysOf(CLIENT_STATUSES)).optional().default("new"),
  sourceUrl: z.string().trim().max(500).optional().default(""),
  sourceType: z.enum(["website", "directory", "marketplace", "job_post", "social", "manual", "other"]).optional().default("manual"),
  sourceEvidence: z.string().trim().max(2000).optional().default(""),
});

export const POST = handler(async (req) => {
  const user = await requireUser();
  const { sourceUrl, sourceType, sourceEvidence, ...data } = await parseBody(req, Create);
  const client = await prisma.client.create({ data: { ...data, ownerId: user.id } });
  const source = await prisma.leadSource.create({
    data: {
      clientId: client.id,
      sourceType: sourceUrl ? sourceType : "manual",
      sourceUrl,
      title: sourceUrl ? "" : "Внесено вручную",
      method: "manual",
      evidence: sourceEvidence || "Карточка создана пользователем",
    },
  });
  const tracked = { companyName: data.companyName, website: data.website, industry: data.industry, city: data.city, country: data.country };
  for (const [field, value] of Object.entries(tracked))
    if (value) await prisma.fieldProvenance.create({ data: { clientId: client.id, field, value, sourceId: source.id, selected: true } });
  await logInteraction(client.id, "lead_discovered", `Лид добавлен: ${client.companyName}`, user, { sourceId: source.id });
  await recalcScore(client.id, user);
  return { client };
});

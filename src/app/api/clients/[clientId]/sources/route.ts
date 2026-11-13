import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SOURCE_TYPES, keysOf } from "@/lib/domain";
import { recalcScore } from "@/lib/scoring";
import { logInteraction } from "@/lib/timeline";

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const [sources, provenance] = await Promise.all([
    prisma.leadSource.findMany({ where: { clientId }, orderBy: { capturedAt: "desc" }, include: { _count: { select: { contacts: true } } } }),
    prisma.fieldProvenance.findMany({ where: { clientId }, orderBy: { capturedAt: "desc" }, include: { source: { select: { id: true, sourceUrl: true, title: true, sourceType: true } } } }),
  ]);
  return { sources, provenance };
});

const Create = z.object({
  sourceType: z.enum(keysOf(SOURCE_TYPES)),
  sourceUrl: z.string().trim().max(500).optional().default(""),
  title: z.string().trim().max(300).optional().default(""),
  evidence: z.string().trim().max(3000).optional().default(""),
  rawReference: z.string().trim().max(5000).optional().default(""),
  capturedAt: z.string().datetime().optional(),
  fields: z.array(z.object({ field: z.enum(["companyName", "website", "industry", "city", "country", "description"]), value: z.string().max(2000) })).optional().default([]),
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const b = await parseBody(req, Create);
  const source = await prisma.leadSource.create({
    data: {
      clientId,
      sourceType: b.sourceType,
      sourceUrl: b.sourceUrl,
      title: b.title,
      evidence: b.evidence,
      rawReference: b.rawReference,
      method: "manual",
      capturedAt: b.capturedAt ? new Date(b.capturedAt) : new Date(),
    },
  });
  // Значения полей из источника. Если отличается от текущего — появится конфликт для ручного выбора.
  for (const f of b.fields) if (f.value.trim()) await prisma.fieldProvenance.create({ data: { clientId, field: f.field, value: f.value.trim(), sourceId: source.id } });
  await logInteraction(clientId, "source_added", `Источник: ${SOURCE_TYPES[b.sourceType]} ${b.sourceUrl}`.trim(), user, { sourceId: source.id });
  await recalcScore(clientId, user);
  return { source };
});

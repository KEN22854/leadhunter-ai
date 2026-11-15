import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateReference } from "@/lib/reference/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const references = await prisma.reference.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 20 });
  return { references: references.map(({ html, ...r }) => ({ ...r, hasPrototype: Boolean(html) })) };
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const { instructions } = await parseBody(req, z.object({ instructions: z.string().max(1500).optional().default("") }));
  const { html: _html, ...ref } = await generateReference(user, clientId, instructions);
  void _html;
  return { reference: { ...ref, hasPrototype: false } };
});

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PROPOSAL_BLOCKS, SERVICES, keysOf } from "@/lib/domain";
import { logInteraction } from "@/lib/timeline";

const BlockSchema = z.object({ key: z.string().max(50), title: z.string().max(200).optional(), body: z.string().max(20000) });

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const proposals = await prisma.proposal.findMany({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, createdAt: true, title: true } } },
  });
  return { proposals };
});

const Create = z.object({
  title: z.string().trim().min(1).max(300),
  service: z.enum(keysOf(SERVICES)).optional().default("custom"),
  blocks: z.array(BlockSchema).optional(),
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const b = await parseBody(req, Create);
  const blocks = b.blocks?.length ? b.blocks : PROPOSAL_BLOCKS.map((x) => ({ key: x.key, title: x.title, body: "" }));
  const content = { blocks } as unknown as Prisma.InputJsonValue;
  const proposal = await prisma.proposal.create({
    data: { clientId, title: b.title, service: b.service, content, versions: { create: { version: 1, title: b.title, content } } },
  });
  await logInteraction(clientId, "proposal_created", `КП создано: ${proposal.title}`, user, { proposalId: proposal.id });
  return { proposal };
});

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PROPOSAL_STATUSES, keysOf } from "@/lib/domain";
import { requireProposal } from "@/lib/guards";
import { logInteraction } from "@/lib/timeline";

const Block = z.object({ key: z.string().max(50), title: z.string().max(200).optional(), body: z.string().max(20000) });

export const GET = handler(async (_req, { proposalId }) => {
  const user = await requireUser();
  await requireProposal(user, proposalId);
  return { proposal: await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId }, include: { versions: { orderBy: { version: "desc" } } } }) };
});

const Patch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  blocks: z.array(Block).optional(),
  status: z.enum(keysOf(PROPOSAL_STATUSES)).optional(),
  restoreVersion: z.number().int().min(1).optional(),
});

/** Изменение текста/структуры = новая версия. Смена статуса версию не создаёт. */
export const PATCH = handler(async (req, { proposalId }) => {
  const user = await requireUser();
  const p = await requireProposal(user, proposalId);
  const b = await parseBody(req, Patch);
  let title = b.title ?? p.title;
  let content = b.blocks ? ({ blocks: b.blocks } as unknown as Prisma.InputJsonValue) : undefined;
  if (b.restoreVersion) {
    const v = await prisma.proposalVersion.findUnique({ where: { proposalId_version: { proposalId, version: b.restoreVersion } } });
    if (!v) throw new ApiError(404, "not_found", "Версия не найдена");
    title = v.title;
    content = v.content as Prisma.InputJsonValue;
  }
  const changed = content !== undefined || title !== p.title;
  const version = changed ? p.version + 1 : p.version;
  const proposal = await prisma.proposal.update({
    where: { id: proposalId },
    data: {
      title,
      ...(content !== undefined ? { content } : {}),
      ...(b.status ? { status: b.status } : {}),
      version,
      ...(changed ? { versions: { create: { version, title, content: content ?? (p.content as Prisma.InputJsonValue) } } } : {}),
    },
  });
  const what = b.status && b.status !== p.status ? `статус: ${PROPOSAL_STATUSES[b.status]}` : b.restoreVersion ? `восстановлена v${b.restoreVersion}` : `версия ${version}`;
  await logInteraction(p.clientId, "proposal_updated", `КП «${title}» — ${what}`, user, { proposalId });
  return { proposal };
});

export const DELETE = handler(async (_req, { proposalId }) => {
  const user = await requireUser();
  const p = await requireProposal(user, proposalId);
  await prisma.proposal.delete({ where: { id: proposalId } });
  await logInteraction(p.clientId, "proposal_updated", `КП удалено: ${p.title}`, user);
  return { ok: true };
});

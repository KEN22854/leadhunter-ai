import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { SERVICES, keysOf } from "@/lib/domain";
import { draftProposal } from "@/lib/ai/service";

export const maxDuration = 300;

/** AI-черновик КП: возвращается для просмотра, сохраняется пользователем отдельно. */
export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const b = await parseBody(req, z.object({ service: z.enum(keysOf(SERVICES)), notes: z.string().max(3000).optional() }));
  return { draft: await draftProposal(user, clientId, b) };
});

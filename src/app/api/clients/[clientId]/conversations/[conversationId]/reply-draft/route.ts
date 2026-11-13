import { handler } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { draftReply } from "@/lib/ai/service";

export const maxDuration = 120;

export const POST = handler(async (_req, { clientId, conversationId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  return { draft: await draftReply(user, clientId, conversationId) };
});

import { handler } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { recalcScore } from "@/lib/scoring";

export const POST = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  return { score: await recalcScore(clientId, user) };
});

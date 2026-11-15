import { handler } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { createWorkspace } from "@/lib/reference/service";

export const runtime = "nodejs";

/** Рабочая папка проекта для клиента, который согласился (бриф, концепция, прототип, CLAUDE.md). */
export const POST = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  return await createWorkspace(user, clientId);
});

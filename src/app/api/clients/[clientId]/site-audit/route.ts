import { handler } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { auditClientSite } from "@/lib/discovery/service";

export const runtime = "nodejs";

/** Аудит сайта клиента: что улучшить + поиск опубликованных email. */
export const POST = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  return await auditClientSite(user, clientId);
});

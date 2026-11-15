import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ensureClientForLead, requireLead } from "@/lib/signals/store";

export const runtime = "nodejs";

export const POST = handler(async (_req, p) => {
  const user = await requireUser();
  await requireLead(user, p.leadId);
  const r = await ensureClientForLead(user, p.leadId);
  return { clientId: r.client.id, created: r.created };
});

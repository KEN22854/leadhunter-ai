import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { addLeadToDnc, requireLead } from "@/lib/signals/store";

export const runtime = "nodejs";

export const POST = handler(async (req, p) => {
  const user = await requireUser();
  await requireLead(user, p.leadId);
  const b = await parseBody(req, z.object({ reason: z.string().trim().max(300).default("Не связываться") }));
  return { added: await addLeadToDnc(user, p.leadId, b.reason) };
});

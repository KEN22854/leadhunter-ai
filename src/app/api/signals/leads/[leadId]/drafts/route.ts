import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { generateDrafts } from "@/lib/signals/outreach";

export const runtime = "nodejs";

export const POST = handler(async (req, p) => {
  const user = await requireUser();
  const b = await parseBody(
    req,
    z.object({
      mode: z.enum(["ai", "template"]).default("ai"),
      signalId: z.string().max(40).optional(),
      language: z.string().max(5).optional(),
      instructions: z.string().max(1000).optional(),
    }),
  );
  return generateDrafts(user, p.leadId, b);
});

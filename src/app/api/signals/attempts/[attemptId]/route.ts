import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { attemptAction } from "@/lib/signals/outreach";

export const runtime = "nodejs";

export const POST = handler(async (req, p) => {
  const user = await requireUser();
  const b = await parseBody(
    req,
    z.object({
      action: z.enum(["open", "confirm", "send", "queue", "outcome", "cancel"]),
      confirm: z.boolean().optional(),
      outcome: z.enum(["replied", "positive", "negative", "no_response"]).optional(),
      idempotencyKey: z.string().min(8).max(100).optional(),
      note: z.string().max(300).optional(),
    }),
  );
  return { attempt: await attemptAction(user, p.attemptId, b) };
});

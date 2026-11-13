import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireOutbound } from "@/lib/guards";
import { approveAndSend } from "@/lib/outreach";

/** Ручное подтверждение и отправка. Требует явного confirm=true и ключа идемпотентности. */
const Body = z.object({ confirm: z.literal(true), idempotencyKey: z.string().min(8).max(100) });

export const POST = handler(async (req, { itemId }) => {
  const user = await requireUser();
  await requireOutbound(user, itemId);
  const { idempotencyKey } = await parseBody(req, Body);
  const item = await approveAndSend(user, itemId, idempotencyKey);
  return { item };
});

import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { approveMany } from "@/lib/signals/outbox";

export const runtime = "nodejs";

/** Одобрение пачкой: подготовленные ответы уходят в очередь автоотправки. confirm: true обязателен. */
export const POST = handler(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, z.object({ ids: z.array(z.string().max(40)).min(1).max(200), confirm: z.literal(true, { message: "Подтвердите одобрение" }) }));
  return approveMany(user, b.ids);
});

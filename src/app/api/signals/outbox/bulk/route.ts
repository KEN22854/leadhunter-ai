import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/ratelimit";
import { bulkPrepareThreads } from "@/lib/signals/outbox";

export const runtime = "nodejs";

/** Массовая подготовка ответов в Threads (ничего не отправляет). */
export const POST = handler(async (req) => {
  const user = await requireUser();
  const b = await parseBody(
    req,
    z.object({
      leadIds: z.array(z.string().max(40)).max(50).optional(),
      temperature: z.array(z.enum(["hot", "warm", "potential"])).max(3).default(["hot", "warm"]),
      limit: z.number().int().min(1).max(50).default(20),
      mode: z.enum(["ai", "template"]).default("ai"),
      variant: z.enum(["short", "friendly", "business"]).default("short"),
    }),
  );
  const rl = checkRateLimit(`threads-bulk:${user.id}`, 4);
  if (!rl.ok) throw new ApiError(429, "rate_limited", `Подождите ${rl.retryAfterSec} с.`);
  return bulkPrepareThreads(user, b);
});

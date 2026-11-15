import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/ratelimit";
import { ApiError } from "@/lib/api";
import { ensureSettingsLoaded } from "@/lib/settings-store";
import { testSource } from "@/lib/signals/source-test";

export const runtime = "nodejs";

/** Проверка подключения источника одним минимальным запросом к его официальному API. */
export const POST = handler(async (_req, { key }) => {
  const user = await requireUser();
  const rl = checkRateLimit(`source-test:${user.id}`, 40);
  if (!rl.ok) throw new ApiError(429, "rate_limited", `Подождите ${rl.retryAfterSec} с.`);
  await ensureSettingsLoaded();
  return testSource(key);
});

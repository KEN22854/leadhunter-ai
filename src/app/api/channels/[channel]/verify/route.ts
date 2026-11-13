import { ApiError, handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ADAPTERS } from "@/lib/channels";
import type { Channel } from "@/lib/domain";

export const POST = handler(async (_req, { channel }) => {
  await requireUser();
  const a = ADAPTERS[channel as Channel];
  if (!a) throw new ApiError(404, "not_found", "Неизвестный канал");
  return await a.verify();
});

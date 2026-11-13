import { ApiError, handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { ADAPTERS, ChannelError } from "@/lib/channels";
import { syncTelegram } from "@/lib/outreach";

export const POST = handler(async () => {
  const user = await requireUser();
  if (ADAPTERS.telegram.status().state !== "connected") throw new ApiError(409, "channel_not_connected", "Telegram не подключён");
  try {
    return await syncTelegram(user);
  } catch (e) {
    if (e instanceof ChannelError) throw new ApiError(502, e.code, e.message);
    throw e;
  }
});

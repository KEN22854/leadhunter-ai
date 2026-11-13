import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { channelStatuses } from "@/lib/channels";

export const GET = handler(async () => {
  await requireUser();
  return { channels: channelStatuses() };
});

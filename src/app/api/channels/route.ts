import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { channelStatuses } from "@/lib/channels";
import { ensureSettingsLoaded } from "@/lib/settings-store";

export const GET = handler(async () => {
  await requireUser();
  await ensureSettingsLoaded();
  return { channels: channelStatuses() };
});

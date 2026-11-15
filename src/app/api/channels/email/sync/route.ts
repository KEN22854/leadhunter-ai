import { ApiError, handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { imapConfigured, syncEmailInbox } from "@/lib/channels/imap";

export const runtime = "nodejs";

export const POST = handler(async () => {
  await requireUser();
  if (!imapConfigured()) throw new ApiError(409, "channel_not_connected", "Входящая почта не настроена — задайте IMAP_HOST, IMAP_USER, IMAP_PASS в .env");
  try {
    return await syncEmailInbox();
  } catch (e) {
    throw new ApiError(502, "imap_failed", `IMAP: ${e instanceof Error ? e.message : String(e)}`);
  }
});

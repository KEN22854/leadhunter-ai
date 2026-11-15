import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { schedulerStatus } from "@/lib/jobs/scheduler";
import { imapConfigured } from "@/lib/channels/imap";

export const runtime = "nodejs";

export const GET = handler(async () => {
  await requireUser();
  return { scheduler: schedulerStatus(), imap: imapConfigured() };
});

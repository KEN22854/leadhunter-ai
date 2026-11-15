import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { signalAnalytics } from "@/lib/signals/analytics";

export const runtime = "nodejs";

export const GET = handler(async (req) => {
  const user = await requireUser();
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 90));
  return signalAnalytics(user.id, days);
});

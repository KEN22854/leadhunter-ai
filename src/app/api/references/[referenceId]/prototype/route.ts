import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireReference } from "@/lib/guards";
import { generatePrototype } from "@/lib/reference/service";

export const runtime = "nodejs";
export const maxDuration = 600;

export const POST = handler(async (_req, { referenceId }) => {
  const user = await requireUser();
  await requireReference(user, referenceId);
  const r = await generatePrototype(user, referenceId);
  return { reference: { id: r.id, html: r.html, model: r.model } };
});

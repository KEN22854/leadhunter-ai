import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { editPrepared, outbox } from "@/lib/signals/outbox";

export const runtime = "nodejs";

export const GET = handler(async () => {
  const user = await requireUser();
  return outbox(user);
});

/** Правка текста неодобренного ответа: { id, body } */
export const PATCH = handler(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, z.object({ id: z.string().max(40), body: z.string().max(2000) }));
  return { attempt: await editPrepared(user, b.id, b.body) };
});

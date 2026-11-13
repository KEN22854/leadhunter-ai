import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logInteraction } from "@/lib/timeline";

export const GET = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const type = new URL(req.url).searchParams.get("type");
  const events = await prisma.interaction.findMany({
    where: { clientId, ...(type ? { type } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return { events };
});

/** Заметка в хронологии */
export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const { text } = await parseBody(req, z.object({ text: z.string().trim().min(1).max(4000) }));
  return { event: await logInteraction(clientId, "note", text, user) };
});

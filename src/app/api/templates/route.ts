import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const GET = handler(async () => {
  const user = await requireUser();
  return { items: await prisma.messageTemplate.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" } }) };
});

export const DELETE = handler(async (req) => {
  const user = await requireUser();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  await prisma.messageTemplate.deleteMany({ where: { id, ownerId: user.id } });
  return { ok: true };
});

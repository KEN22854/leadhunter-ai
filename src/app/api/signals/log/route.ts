import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** Журнал оснований обработки персональных данных */
export const GET = handler(async (req) => {
  const user = await requireUser();
  const action = new URL(req.url).searchParams.get("action");
  const items = await prisma.processingLog.findMany({ where: { ownerId: user.id, ...(action ? { action } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
  return { items };
});

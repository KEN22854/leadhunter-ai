import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PRIORITIES, TASK_KINDS, keysOf } from "@/lib/domain";
import { logInteraction } from "@/lib/timeline";

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const tasks = await prisma.clientTask.findMany({
    where: { clientId },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    include: { assignee: { select: { id: true, name: true } } },
  });
  return { tasks };
});

const Create = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000).optional().default(""),
  dueAt: z.string().datetime().nullable().optional(),
  priority: z.enum(keysOf(PRIORITIES)).optional().default("medium"),
  kind: z.enum(keysOf(TASK_KINDS)).optional().default("task"),
  source: z.enum(["manual", "ai"]).optional().default("manual"),
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const b = await parseBody(req, Create);
  const task = await prisma.clientTask.create({
    data: { ...b, clientId, dueAt: b.dueAt ? new Date(b.dueAt) : null, assigneeId: user.id },
  });
  await logInteraction(clientId, "task_created", `Задача: ${task.title}${b.source === "ai" ? " (из AI-рекомендации)" : ""}`, user, { taskId: task.id });
  return { task };
});

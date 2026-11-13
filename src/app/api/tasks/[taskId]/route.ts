import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PRIORITIES, TASK_KINDS, TASK_STATUSES, keysOf } from "@/lib/domain";
import { requireTask } from "@/lib/guards";
import { logInteraction } from "@/lib/timeline";

const Patch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(4000).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  priority: z.enum(keysOf(PRIORITIES)).optional(),
  status: z.enum(keysOf(TASK_STATUSES)).optional(),
  kind: z.enum(keysOf(TASK_KINDS)).optional(),
});

export const PATCH = handler(async (req, { taskId }) => {
  const user = await requireUser();
  const t = await requireTask(user, taskId);
  const b = await parseBody(req, Patch);
  const task = await prisma.clientTask.update({
    where: { id: taskId },
    data: { ...b, dueAt: b.dueAt === undefined ? undefined : b.dueAt ? new Date(b.dueAt) : null },
  });
  await logInteraction(
    t.clientId,
    "task_updated",
    b.status && b.status !== t.status ? `Задача «${t.title}»: ${TASK_STATUSES[b.status]}` : `Задача «${task.title}» изменена`,
    user,
    { taskId },
  );
  return { task };
});

export const DELETE = handler(async (_req, { taskId }) => {
  const user = await requireUser();
  const t = await requireTask(user, taskId);
  await prisma.clientTask.delete({ where: { id: taskId } });
  await logInteraction(t.clientId, "task_updated", `Задача удалена: ${t.title}`, user);
  return { ok: true };
});

import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CLIENT_STATUSES, keysOf } from "@/lib/domain";
import { suppressionKeys } from "@/lib/normalize";
import { countConflicts, recalcScore } from "@/lib/scoring";
import { audit, logInteraction } from "@/lib/timeline";
import { aiStatus } from "@/lib/ai/provider";

export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      scores: { orderBy: { calculatedAt: "desc" }, take: 1 },
      analyses: { orderBy: { createdAt: "desc" }, take: 1 },
      contacts: { orderBy: { createdAt: "asc" } },
      tasks: { where: { status: { in: ["new", "in_progress"] } }, orderBy: [{ dueAt: "asc" }], take: 5 },
      _count: { select: { sources: true, messages: true, proposals: true, conversations: true } },
    },
  });
  const { scores, analyses, ...rest } = client;
  // Первичный расчёт оценки для лидов, созданных импортом/сидом
  const score = scores[0] ?? (await recalcScore(clientId, null));
  return {
    client: rest,
    score,
    analysis: analyses[0] ?? null,
    conflicts: await countConflicts(clientId),
    ai: await aiStatus().then((a) => ({ configured: a.configured, model: a.model, backend: a.backend })),
  };
});

const Patch = z.object({
  companyName: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  category: z.string().max(200).optional(),
  industry: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  website: z.string().max(300).optional(),
  logoUrl: z.string().max(500).optional(),
  language: z.string().max(10).optional(),
  status: z.enum(keysOf(CLIENT_STATUSES)).optional(),
  archived: z.boolean().optional(),
  doNotContact: z.boolean().optional(),
  markChecked: z.boolean().optional(),
});

const TRACKED = ["companyName", "website", "industry", "city", "country", "description"] as const;

export const PATCH = handler(async (req, { clientId }) => {
  const user = await requireUser();
  const before = await requireClientAccess(user, clientId);
  const { markChecked, ...data } = await parseBody(req, Patch);
  if (data.logoUrl && !/^https:\/\//.test(data.logoUrl)) data.logoUrl = "";
  const client = await prisma.client.update({
    where: { id: clientId },
    data: { ...data, ...(markChecked ? { lastCheckedAt: new Date() } : {}) },
  });
  // Ручные правки фиксируются как выбранное значение поля
  for (const f of TRACKED) {
    const v = data[f];
    if (v !== undefined && v !== before[f]) {
      await prisma.fieldProvenance.updateMany({ where: { clientId, field: f }, data: { selected: false } });
      await prisma.fieldProvenance.create({ data: { clientId, field: f, value: v, selected: true } });
    }
  }
  if (data.status && data.status !== before.status)
    await logInteraction(clientId, "status_changed", `Статус: ${CLIENT_STATUSES[before.status as keyof typeof CLIENT_STATUSES] ?? before.status} → ${CLIENT_STATUSES[data.status]}`, user);
  else if (data.archived !== undefined && data.archived !== before.archived)
    await logInteraction(clientId, "client_updated", data.archived ? "Карточка архивирована" : "Карточка восстановлена из архива", user);
  else if (data.doNotContact !== undefined && data.doNotContact !== before.doNotContact)
    await logInteraction(clientId, "suppression", data.doNotContact ? "Клиент отмечен «Не связываться»" : "Снята отметка «Не связываться»", user);
  else if (markChecked) await logInteraction(clientId, "data_checked", "Данные проверены пользователем", user);
  else if (Object.keys(data).length) await logInteraction(clientId, "client_updated", "Профиль обновлён", user, { fields: Object.keys(data) });
  await recalcScore(clientId, user);
  return { client };
});

/** Удаление данных клиента (право на удаление). Опционально — внести контакты в список запрета, чтобы не обработать их повторно. */
export const DELETE = handler(async (req, { clientId }) => {
  const user = await requireUser();
  const client = await requireClientAccess(user, clientId);
  const suppress = new URL(req.url).searchParams.get("suppress") === "1";
  if (suppress) {
    const contacts = await prisma.contact.findMany({ where: { clientId } });
    for (const c of contacts)
      for (const value of suppressionKeys(c.type, c.value).slice(0, 1))
        await prisma.suppressionEntry.upsert({
          where: { ownerId_value: { ownerId: user.id, value } },
          update: {},
          create: { ownerId: user.id, value, type: c.type, reason: "Удаление данных по запросу" },
        });
  }
  await prisma.client.delete({ where: { id: clientId } });
  await audit(user.id, "client.delete", "Client", clientId, { companyName: client.companyName, suppress });
  return { ok: true };
});

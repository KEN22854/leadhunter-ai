import "server-only";
import { prisma } from "../db";
import { ApiError } from "../api";
import type { CurrentUser } from "../auth";
import { isAIConfigured } from "../ai/provider";
import { attemptAction, channelOptions, generateDrafts, prepareAttempt, precheck } from "./outreach";
import { THREADS_MAX_TEXT, threadsAppUsage, threadsReplyQuota, threadsToken } from "./threads";

// «Исходящие»: массовая подготовка ответов в Threads и одобрение пачкой.
// Подготовка ничего не отправляет. Отправка — только после одобрения пользователем (статус queued),
// дальше фоновая задача публикует по одному с паузой и дневным лимитом (processThreadsQueue).

export type BulkResult = { leadId: string; name: string; status: "prepared" | "skipped"; reason?: string; attemptId?: string };

export async function bulkPrepareThreads(user: CurrentUser, p: { leadIds?: string[]; temperature?: string[]; limit: number; mode: "ai" | "template"; variant: "short" | "friendly" | "business" }) {
  if (!threadsToken()) throw new ApiError(409, "threads_not_configured", "Threads не подключён: добавьте токен в «Настройки → Подключения»");
  const useAI = p.mode === "ai" && (await isAIConfigured());
  const leads = await prisma.socialLead.findMany({
    where: {
      ownerId: user.id,
      doNotContact: false,
      status: { in: ["new", "qualified", "converted"] },
      primarySource: "threads",
      ...(p.leadIds?.length ? { id: { in: p.leadIds } } : {}),
      ...(p.temperature?.length ? { temperature: { in: p.temperature } } : {}),
      attempts: { none: { channel: "threads", status: { in: ["prepared", "queued", "sending", "sent", "confirmed_sent"] } } },
    },
    orderBy: { score: "desc" },
    take: Math.min(50, p.limit),
  });
  const out: BulkResult[] = [];
  for (const lead of leads) {
    try {
      const opt = (await channelOptions(lead.id)).find((o) => o.mode === "api" && o.channel === "threads");
      if (!opt?.available) {
        out.push({ leadId: lead.id, name: lead.displayName, status: "skipped", reason: opt?.reason ?? "Нет поста Threads API" });
        continue;
      }
      const blocking = (await precheck(user, lead.id, "api", opt.target, "threads")).filter((i) => i.blocking);
      if (blocking.length) {
        out.push({ leadId: lead.id, name: lead.displayName, status: "skipped", reason: blocking.map((i) => i.message).join("; ") });
        continue;
      }
      // AI недоступен (регион, лимит) — шаблон по фактам публикации, а не пропуск лида
      const { drafts } = useAI ? await generateDrafts(user, lead.id, { mode: "ai" }).catch(() => generateDrafts(user, lead.id, { mode: "template" })) : await generateDrafts(user, lead.id, { mode: "template" });
      // Предпочитаем выбранный вариант; если он длиннее лимита Threads — краткий
      const pick = [drafts.find((d) => d.variant === p.variant), drafts.find((d) => d.variant === "short")].find((d) => d && [...d.body].length <= THREADS_MAX_TEXT);
      if (!pick) {
        out.push({ leadId: lead.id, name: lead.displayName, status: "skipped", reason: `Текст длиннее ${THREADS_MAX_TEXT} символов — отредактируйте в карточке` });
        continue;
      }
      const { attempt } = await prepareAttempt(user, lead.id, { mode: "api", channel: "threads", draftId: pick.id, subject: "", body: pick.body });
      out.push({ leadId: lead.id, name: lead.displayName, status: "prepared", attemptId: attempt.id });
    } catch (e) {
      out.push({ leadId: lead.id, name: lead.displayName, status: "skipped", reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results: out, usedAI: useAI };
}

export async function outbox(user: CurrentUser) {
  const items = await prisma.outreachAttempt.findMany({
    where: { channel: "threads", mode: "api", lead: { ownerId: user.id }, OR: [{ status: { in: ["prepared", "queued", "sending", "failed"] } }, { status: "sent", sentAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }] },
    orderBy: [{ updatedAt: "asc" }],
    include: { lead: { select: { id: true, displayName: true, score: true, temperature: true, profileUrl: true, signals: { orderBy: { score: "desc" }, take: 1, select: { title: true, url: true, text: true } } } } },
    take: 300,
  });
  const usage = await threadsAppUsage(user.id);
  const quota = threadsToken() ? await threadsReplyQuota() : null;
  const queued = items.filter((i) => i.status === "queued").length;
  const remainingToday = Math.max(0, usage.limit - usage.sent24h);
  const nextAt = usage.lastAt ? new Date(Math.max(Date.now(), usage.lastAt.getTime() + usage.intervalMin * 60_000)) : new Date();
  return { items, usage, quota, connected: Boolean(threadsToken()), queued, remainingToday, nextAt: queued && remainingToday ? nextAt : null };
}

export async function approveMany(user: CurrentUser, ids: string[]) {
  let ok = 0;
  const errors: { id: string; message: string }[] = [];
  for (const id of ids.slice(0, 200)) {
    try {
      await attemptAction(user, id, { action: "queue", confirm: true });
      ok++;
    } catch (e) {
      errors.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { queued: ok, errors };
}

/** Правка текста подготовленного (ещё не одобренного) ответа */
export async function editPrepared(user: CurrentUser, id: string, body: string) {
  const at = await prisma.outreachAttempt.findUnique({ where: { id }, include: { lead: true } });
  if (!at || (at.lead.ownerId !== user.id && user.role !== "admin")) throw new ApiError(404, "not_found", "Обращение не найдено");
  if (!["prepared", "failed"].includes(at.status)) throw new ApiError(409, "bad_state", "Редактировать можно только неодобренный ответ");
  const text = body.trim();
  if (!text) throw new ApiError(400, "empty", "Пустой текст");
  if (at.channel === "threads" && [...text].length > THREADS_MAX_TEXT) throw new ApiError(400, "too_long", `Не больше ${THREADS_MAX_TEXT} символов`);
  return prisma.outreachAttempt.update({ where: { id }, data: { body: text, status: "prepared", error: "" } });
}

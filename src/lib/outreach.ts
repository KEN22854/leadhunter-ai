import "server-only";
import { prisma } from "./db";
import { ApiError } from "./api";
import type { CurrentUser } from "./auth";
import { ADAPTERS, CHANNEL_CONTACT_TYPE, ChannelError, telegramGetUpdates } from "./channels";
import { checkOutreachCompliance, isOptOutReply, optOutFooter } from "./compliance";
import { CHANNELS, type Channel } from "./domain";
import { normalizeContact, suppressionKeys } from "./normalize";
import { logInteraction, audit } from "./timeline";
import { buildReferenceAttachments } from "./reference/service";
import type { Prisma } from "@prisma/client";

export type AttachmentRef = { kind: "reference_pdf" | "reference_html"; referenceId: string };

async function resolveAttachments(refs: AttachmentRef[] | null | undefined) {
  if (!refs?.length) return [];
  const byRef = new Map<string, { pdf: boolean; html: boolean }>();
  for (const r of refs) {
    const e = byRef.get(r.referenceId) ?? { pdf: false, html: false };
    if (r.kind === "reference_pdf") e.pdf = true;
    if (r.kind === "reference_html") e.html = true;
    byRef.set(r.referenceId, e);
  }
  const out = [];
  for (const [id, o] of byRef) out.push(...(await buildReferenceAttachments(id, o)));
  return out;
}

/** Находит или создаёт ветку переписки клиента для контакта и канала. */
async function ensureConversation(clientId: string, contactId: string, channel: Channel) {
  const existing = await prisma.conversation.findFirst({ where: { clientId, contactId, channel } });
  if (existing) return existing;
  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
  return prisma.conversation.create({
    data: {
      clientId,
      contactId,
      channel,
      externalThreadId: channel === "telegram" ? "" : normalizeContact(contact.type, contact.value),
    },
  });
}

/** Шаг 1: подготовка к отправке. Создаёт исходящее со статусом «ожидает подтверждения». */
export async function queueOutbound(
  user: CurrentUser,
  clientId: string,
  p: { channel: Channel; contactId: string; subject: string; body: string; aiMessageId?: string | null; attachments?: AttachmentRef[] },
) {
  if (p.attachments?.length && p.channel !== "email") throw new ApiError(400, "attachments_unsupported", "Вложения поддерживаются только в email");
  if (p.attachments?.length) {
    const ids = [...new Set(p.attachments.map((a) => a.referenceId))];
    const own = await prisma.reference.count({ where: { id: { in: ids }, clientId } });
    if (own !== ids.length) throw new ApiError(400, "bad_attachment", "Референс не принадлежит этому клиенту");
  }
  const contact = await prisma.contact.findFirst({ where: { id: p.contactId, clientId } });
  if (!contact) throw new ApiError(404, "no_contact", "Контакт не найден у этого клиента");
  if (!CHANNEL_CONTACT_TYPE[p.channel].includes(contact.type))
    throw new ApiError(400, "contact_channel_mismatch", `Контакт типа «${contact.type}» не подходит для канала ${CHANNELS[p.channel]}`);
  const issues = await checkOutreachCompliance({ ownerId: user.id, clientId, contactId: p.contactId });
  const blocking = issues.filter((i) => i.blocking);
  if (blocking.length) throw new ApiError(409, "compliance_blocked", "Обращение заблокировано проверками", { issues });

  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  let body = p.body.trim();
  // Механизм отказа от обращений для email
  if (p.channel === "email" && !/отпис|unsubscribe/i.test(body)) body += `\n\n—\n${optOutFooter(client.language)}`;

  const conv = await ensureConversation(clientId, p.contactId, p.channel);
  const item = await prisma.conversationMessage.create({
    data: {
      conversationId: conv.id,
      direction: "outbound",
      aiMessageId: p.aiMessageId ?? null,
      subject: p.subject,
      body,
      status: "pending_approval",
      attachments: p.attachments?.length ? (p.attachments as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
  if (p.aiMessageId) await prisma.aIMessage.updateMany({ where: { id: p.aiMessageId, clientId }, data: { status: "queued" } });
  await logInteraction(clientId, "message_queued", `Сообщение подготовлено к отправке (${CHANNELS[p.channel]})`, user, { itemId: item.id });
  return { item, warnings: issues.filter((i) => !i.blocking) };
}

/** Шаг 2: ручное подтверждение и отправка. Идемпотентно по idempotencyKey; повторная отправка возможна только из статуса «ошибка». */
export async function approveAndSend(user: CurrentUser, itemId: string, idempotencyKey: string) {
  const dup = await prisma.conversationMessage.findUnique({ where: { idempotencyKey } });
  if (dup) {
    if (dup.id !== itemId) throw new ApiError(409, "idempotency_conflict", "Ключ идемпотентности уже использован для другого сообщения");
    return dup; // повтор того же запроса — возвращаем результат без повторной отправки
  }
  const item = await prisma.conversationMessage.findUnique({ where: { id: itemId }, include: { conversation: { include: { contact: true, client: true } } } });
  if (!item || item.direction !== "outbound") throw new ApiError(404, "not_found", "Сообщение не найдено");
  const { conversation: conv } = item;
  if (conv.client.ownerId !== user.id && user.role !== "admin") throw new ApiError(404, "not_found", "Сообщение не найдено");
  if (!conv.contact) throw new ApiError(409, "no_contact", "Контакт получателя удалён");

  const issues = await checkOutreachCompliance({ ownerId: user.id, clientId: conv.clientId, contactId: conv.contactId });
  if (issues.some((i) => i.blocking)) throw new ApiError(409, "compliance_blocked", "Отправка заблокирована проверками", { issues });

  const adapter = ADAPTERS[conv.channel as Channel];
  if (!adapter) throw new ApiError(400, "bad_channel", "Неизвестный канал");
  if (adapter.status().state !== "connected")
    throw new ApiError(409, "channel_not_connected", `Канал «${CHANNELS[conv.channel as Channel]}» не подключён`, { setupHint: adapter.status().setupHint });

  // Атомарный переход в «отправляется» — защита от двойной отправки при параллельных кликах
  const lock = await prisma.conversationMessage.updateMany({
    where: { id: itemId, status: { in: ["pending_approval", "failed"] } },
    data: { status: "sending", approvedAt: new Date(), approvedById: user.id, idempotencyKey, error: "" },
  });
  if (lock.count === 0) throw new ApiError(409, "invalid_state", "Сообщение уже отправлено или отправляется");
  await audit(user.id, "message.approve", "ConversationMessage", itemId, { channel: conv.channel });

  try {
    const attachments = await resolveAttachments(item.attachments as unknown as AttachmentRef[] | null);
    const r = await adapter.send({
      to: conv.contact.value.trim(),
      threadId: conv.externalThreadId,
      subject: item.subject,
      body: item.body,
      lastInboundAt: conv.lastInboundAt,
      attachments,
    });
    const sent = await prisma.conversationMessage.update({ where: { id: itemId }, data: { status: "sent", sentAt: new Date(), externalId: r.externalId } });
    if (r.threadId && r.threadId !== conv.externalThreadId) await prisma.conversation.update({ where: { id: conv.id }, data: { externalThreadId: r.threadId } });
    if (item.aiMessageId) await prisma.aIMessage.updateMany({ where: { id: item.aiMessageId }, data: { status: "sent" } });
    if (conv.client.status === "new" || conv.client.status === "researching" || conv.client.status === "ready")
      await prisma.client.update({ where: { id: conv.clientId }, data: { status: "contacted" } });
    await logInteraction(conv.clientId, "message_sent", `Отправлено: ${CHANNELS[conv.channel as Channel]} → ${conv.contact.value}`, user, { itemId });
    return sent;
  } catch (e) {
    const msg = e instanceof ChannelError ? e.message : e instanceof Error ? e.message : String(e);
    // Черновик сохраняется, ключ освобождается, чтобы можно было повторить после устранения причины
    const failed = await prisma.conversationMessage.update({ where: { id: itemId }, data: { status: "failed", error: msg.slice(0, 1000), idempotencyKey: null } });
    await logInteraction(conv.clientId, "message_failed", `Ошибка отправки: ${msg.slice(0, 200)}`, user, { itemId });
    return failed;
  }
}

/** Ручная регистрация входящего ответа (для каналов без API входящих) или отметка ручной отправки. */
export async function logManualMessage(
  user: CurrentUser,
  clientId: string,
  p: { channel: Channel; contactId: string; direction: "inbound" | "outbound"; body: string; subject?: string },
) {
  const contact = await prisma.contact.findFirst({ where: { id: p.contactId, clientId } });
  if (!contact) throw new ApiError(404, "no_contact", "Контакт не найден");
  const conv = await ensureConversation(clientId, p.contactId, p.channel);
  const item = await prisma.conversationMessage.create({
    data: {
      conversationId: conv.id,
      direction: p.direction,
      body: p.body,
      subject: p.subject ?? "",
      status: p.direction === "inbound" ? "received" : "sent",
      sentAt: p.direction === "outbound" ? new Date() : null,
      approvedById: user.id,
      approvedAt: new Date(),
    },
  });
  if (p.direction === "inbound") await onInbound(user, clientId, conv.id, p.body, contact.type, contact.value);
  else await logInteraction(clientId, "message_sent", `Отправлено вручную (${CHANNELS[p.channel]})`, user, { itemId: item.id });
  return item;
}

export async function onInbound(user: CurrentUser | null, clientId: string, conversationId: string, body: string, contactType: string, contactValue: string) {
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: new Date() } });
  await prisma.conversationMessage.updateMany({ where: { conversationId, direction: "outbound", status: { in: ["sent", "delivered"] } }, data: { status: "replied" } });
  await logInteraction(clientId, "reply_received", `Получен ответ: «${body.slice(0, 120)}»`, user);
  if (isOptOutReply(body)) {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    for (const v of suppressionKeys(contactType, contactValue).slice(0, 1))
      await prisma.suppressionEntry.upsert({
        where: { ownerId_value: { ownerId: client.ownerId, value: v } },
        update: {},
        create: { ownerId: client.ownerId, value: v, type: contactType, reason: "Отказ получателя в ответе" },
      });
    await prisma.contact.updateMany({ where: { clientId, normalizedValue: normalizeContact(contactType, contactValue) }, data: { doNotContact: true } });
    await logInteraction(clientId, "suppression", "Получатель отказался от обращений — контакт добавлен в список запрета", user);
    await prisma.campaignItem.updateMany({ where: { clientId, status: { in: ["ready", "queued", "sent", "failed"] } }, data: { status: "opted_out" } });
    return;
  }
  // Ответ по кампании: дальнейшие письма этому клиенту не отправляются автоматически, создаётся задача ответить
  await prisma.campaignItem.updateMany({ where: { clientId, status: { in: ["ready", "queued", "sent"] } }, data: { status: "replied" } });
  const open = await prisma.clientTask.findFirst({ where: { clientId, kind: "follow_up", status: { in: ["new", "in_progress"] }, title: { startsWith: "Ответить" } } });
  if (!open)
    await prisma.clientTask.create({
      data: { clientId, title: "Ответить на сообщение клиента", description: body.slice(0, 500), kind: "follow_up", priority: "high", dueAt: new Date(Date.now() + 24 * 3600_000), source: "manual" },
    });
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { status: true } });
  if (client && ["new", "researching", "ready", "contacted"].includes(client.status)) await prisma.client.update({ where: { id: clientId }, data: { status: "negotiating" } });
}

/** Синхронизация входящих Telegram: сопоставление по username с контактами клиентов пользователя. */
export async function syncTelegram(user: CurrentUser) {
  // Офсет хранится в БД — после перезапуска не получаем старые обновления повторно
  const state = await prisma.appState.findUnique({ where: { key: "telegram_offset" } });
  let tgOffset = state ? Number(state.value) : undefined;
  const updates = await telegramGetUpdates(tgOffset);
  let matched = 0;
  for (const u of updates) {
    tgOffset = u.update_id + 1;
    await prisma.appState.upsert({ where: { key: "telegram_offset" }, update: { value: String(tgOffset) }, create: { key: "telegram_offset", value: String(tgOffset) } });
    const m = u.message;
    if (!m?.text || !m.from?.username) continue;
    const username = m.from.username.toLowerCase();
    const contact = await prisma.contact.findFirst({
      where: { type: "telegram", normalizedValue: username, client: { ownerId: user.id } },
    });
    if (!contact) continue;
    const externalId = `tg:${m.chat.id}:${m.message_id}`;
    if (await prisma.conversationMessage.findFirst({ where: { externalId } })) continue;
    let conv = await prisma.conversation.findFirst({ where: { clientId: contact.clientId, contactId: contact.id, channel: "telegram" } });
    if (!conv) conv = await prisma.conversation.create({ data: { clientId: contact.clientId, contactId: contact.id, channel: "telegram", externalThreadId: String(m.chat.id) } });
    else if (!conv.externalThreadId) conv = await prisma.conversation.update({ where: { id: conv.id }, data: { externalThreadId: String(m.chat.id) } });
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "inbound", body: m.text, status: "received", externalId, createdAt: new Date(m.date * 1000) },
    });
    await onInbound(user, contact.clientId, conv.id, m.text, contact.type, contact.value);
    matched++;
  }
  return { received: updates.length, matched };
}

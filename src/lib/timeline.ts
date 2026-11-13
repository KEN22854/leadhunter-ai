import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { CurrentUser } from "./auth";

export const INTERACTION_TYPES = {
  lead_discovered: "Лид обнаружен",
  client_updated: "Профиль обновлён",
  status_changed: "Смена статуса",
  contact_added: "Контакт добавлен",
  contact_updated: "Контакт обновлён",
  contact_verified: "Проверка контакта",
  source_added: "Источник добавлен",
  data_checked: "Проверка данных",
  analysis_created: "AI-анализ",
  score_changed: "Изменение Lead Score",
  message_generated: "Генерация сообщений",
  message_edited: "Редактирование сообщения",
  message_queued: "Сообщение подготовлено к отправке",
  message_sent: "Сообщение отправлено",
  message_failed: "Ошибка отправки",
  reply_received: "Получен ответ",
  proposal_created: "КП создано",
  proposal_updated: "КП обновлено",
  task_created: "Задача создана",
  task_updated: "Задача обновлена",
  note: "Заметка",
  suppression: "Запрет обработки",
  consent: "Правовое основание",
} as const;
export type InteractionType = keyof typeof INTERACTION_TYPES;

export async function logInteraction(
  clientId: string,
  type: InteractionType,
  summary: string,
  actor: CurrentUser | null,
  payload: Prisma.InputJsonValue = {},
) {
  return prisma.interaction.create({
    data: {
      clientId,
      type,
      summary,
      actorId: actor?.id ?? null,
      actorLabel: actor ? actor.name || actor.email : "system",
      payload,
    },
  });
}

export async function audit(userId: string | null, action: string, entity: string, entityId: string, meta: Prisma.InputJsonValue = {}) {
  return prisma.auditLog.create({ data: { userId, action, entity, entityId, meta } });
}

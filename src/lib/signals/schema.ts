import { z } from "zod";
import { SOURCE_MAP } from "./catalog";
import { LANG_KEYS, SIGNAL_SERVICES } from "./lexicon";

const list = (max: number, len = 120) => z.array(z.string().trim().min(1).max(len)).max(max).default([]);

export const CampaignBody = z.object({
  name: z.string().trim().min(2, "Название кампании").max(120),
  service: z.string().refine((s) => s in SIGNAL_SERVICES, "Неизвестная услуга"),
  country: z.string().trim().max(80).default(""),
  city: z.string().trim().max(80).default(""),
  languages: z.array(z.enum(LANG_KEYS as [string, ...string[]])).min(1, "Выберите язык").max(5),
  sources: z.array(z.string().refine((s) => s in SOURCE_MAP && s !== "manual", "Неизвестный источник")).min(1, "Выберите источники").max(40),
  keywords: list(20),
  excludeWords: list(30),
  businessType: z.string().trim().max(80).default(""),
  orderType: z.enum(["any", "one_time", "ongoing", "launch"]).default("any"),
  periodDays: z.number().int().min(1).max(90).default(14),
  // null — без ограничения (сохраняются все подходящие)
  maxResults: z.number().int().min(5).max(5000).nullable().default(null).transform((v) => v ?? 0),
  minScore: z.number().int().min(0).max(100).default(40),
  schedule: z.enum(["once", "daily", "weekly"]).default("once"),
  feeds: z.array(z.string().url().max(500)).max(10).default([]),
  channels: z.object({ telegram: list(15, 64), reddit: list(15, 40), discord: list(10, 30) }).default({ telegram: [], reddit: [], discord: [] }),
  useAI: z.boolean().default(true),
});

export const CampaignPatch = z
  .object({
    name: z.string().trim().min(2).max(120),
    status: z.enum(["active", "paused"]),
    schedule: z.enum(["once", "daily", "weekly"]),
    minScore: z.number().int().min(0).max(100),
    maxResults: z.number().int().min(0).max(5000),
    periodDays: z.number().int().min(1).max(90),
    useAI: z.boolean(),
    sources: CampaignBody.shape.sources,
    keywords: CampaignBody.shape.keywords,
    excludeWords: CampaignBody.shape.excludeWords,
  })
  .partial();

export const ORDER_TYPES = { any: "Любой", one_time: "Разовый проект", ongoing: "На постоянной основе", launch: "Запуск бизнеса/проекта" } as const;
export const SCHEDULES = { once: "Однократно", daily: "Ежедневно", weekly: "Еженедельно" } as const;
export const LEAD_STATUSES = {
  new: "Новый",
  qualified: "Квалифицирован",
  converted: "В CRM",
  contacted: "Связались",
  replied: "Ответил",
  positive: "Положительный ответ",
  declined: "Отказ",
  archived: "Архив",
} as const;
export const ATTEMPT_STATUSES = {
  prepared: "Подготовлено",
  opened: "Диалог открыт",
  confirmed_sent: "Отправлено вручную (подтверждено)",
  sent: "Отправлено через официальный канал",
  failed: "Ошибка",
  cancelled: "Отменено",
} as const;
export const OUTCOMES = { none: "Нет данных", replied: "Ответил", positive: "Положительный ответ", negative: "Отказ", no_response: "Нет ответа" } as const;

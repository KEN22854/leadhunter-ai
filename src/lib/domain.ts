// Справочники домена. Значения хранятся в БД строками; подписи — для UI (ru).
// Для добавления локали — вынести подписи в src/i18n/<locale>.ts по образцу ru.

export const CLIENT_STATUSES = {
  new: "Новый",
  researching: "Изучается",
  ready: "Готов к контакту",
  contacted: "Контакт установлен",
  negotiating: "Переговоры",
  won: "Сделка",
  lost: "Отказ",
} as const;
export type ClientStatus = keyof typeof CLIENT_STATUSES;

export const PRIORITIES = {
  very_high: "Очень высокий",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
} as const;
export type Priority = keyof typeof PRIORITIES;

export const CONTACT_TYPES = {
  email: "Email",
  phone: "Телефон",
  website: "Сайт",
  telegram: "Telegram",
  whatsapp: "WhatsApp Business",
  linkedin: "LinkedIn",
  social: "Соцсеть",
  other: "Другое",
} as const;
export type ContactType = keyof typeof CONTACT_TYPES;

export const VERIFICATION_STATUSES = {
  found: "Найден",
  formal: "Проверен формально",
  confirmed: "Подтверждён владельцем/источником",
  invalid: "Недействителен",
  unknown: "Неизвестен",
} as const;
export type VerificationStatus = keyof typeof VERIFICATION_STATUSES;

export const SOURCE_TYPES = {
  website: "Сайт компании",
  directory: "Каталог / справочник",
  marketplace: "Маркетплейс",
  job_post: "Опубликованный заказ",
  social: "Соцсеть",
  manual: "Внесено вручную",
  other: "Другое",
} as const;
export type SourceType = keyof typeof SOURCE_TYPES;

export const CHANNELS = {
  email: "Email",
  telegram: "Telegram",
  whatsapp: "WhatsApp Business",
  linkedin: "LinkedIn",
} as const;
export type Channel = keyof typeof CHANNELS;

export const SERVICES = {
  website: "Разработка сайта",
  branding: "Дизайн и брендинг",
  smm: "SMM",
  marketplace_cards: "Карточки маркетплейсов",
  app: "Приложение",
  digital_magazine: "Цифровой журнал",
  custom: "Индивидуальная услуга",
} as const;
export type Service = keyof typeof SERVICES;

export const TONES = {
  business_friendly: "Деловой и дружелюбный",
  premium: "Премиальный",
  informal: "Неформальный",
  short_confident: "Короткий и уверенный",
  expert: "Экспертный",
  consultative: "Консультационный",
} as const;
export type Tone = keyof typeof TONES;

export const GOALS = {
  start_dialog: "Начать диалог",
  offer_cooperation: "Предложить сотрудничество",
  book_meeting: "Назначить встречу",
  offer_service: "Предложить конкретную услугу",
  respond_to_request: "Откликнуться на опубликованный заказ",
  follow_up: "Продолжить диалог",
} as const;
export type Goal = keyof typeof GOALS;

export const LENGTHS = { short: "Короткое", medium: "Среднее", long: "Подробное" } as const;
export type Length = keyof typeof LENGTHS;

export const LANGUAGES = {
  auto: "Авто (по языку клиента)",
  ru: "Русский",
  en: "Английский",
  de: "Немецкий",
  fr: "Французский",
  es: "Испанский",
  it: "Итальянский",
  pt: "Португальский",
  tr: "Турецкий",
  zh: "Китайский",
} as const;
export type Language = keyof typeof LANGUAGES;

export const REWRITE_COMMANDS = {
  shorten: "Сократить",
  expand: "Расширить",
  naturalize: "Сделать естественнее",
  simplify: "Упростить",
  more_expert: "Сделать экспертнее",
  change_tone: "Изменить тон",
  translate: "Перевести",
  regenerate: "Перегенерировать",
} as const;
export type RewriteCommand = keyof typeof REWRITE_COMMANDS;

export const DELIVERY_STATUSES = {
  draft: "Черновик",
  pending_approval: "Ожидает подтверждения",
  sending: "Отправляется",
  sent: "Отправлено",
  delivered: "Доставлено",
  failed: "Ошибка",
  replied: "Ответ получен",
  received: "Входящее",
} as const;
export type DeliveryStatus = keyof typeof DELIVERY_STATUSES;

export const PROPOSAL_STATUSES = {
  draft: "Черновик",
  ready: "Готово",
  sent: "Отправлено",
  accepted: "Принято",
  rejected: "Отклонено",
} as const;
export type ProposalStatus = keyof typeof PROPOSAL_STATUSES;

export const PROPOSAL_BLOCKS = [
  { key: "task", title: "Задача клиента" },
  { key: "solution", title: "Предлагаемое решение" },
  { key: "stages", title: "Этапы" },
  { key: "timeline", title: "Сроки" },
  { key: "price", title: "Стоимость" },
  { key: "terms", title: "Условия" },
  { key: "next_step", title: "Следующий шаг" },
] as const;

export const TASK_STATUSES = {
  new: "Новая",
  in_progress: "В работе",
  done: "Выполнена",
  cancelled: "Отменена",
} as const;
export type TaskStatus = keyof typeof TASK_STATUSES;

export const TASK_KINDS = { task: "Задача", follow_up: "Follow-up", meeting: "Встреча", call: "Звонок" } as const;

export const CONSENT_BASES = {
  consent: "Согласие получателя",
  published_request: "Опубликованный запрос/заказ клиента",
  legitimate_interest: "Законный интерес (B2B, деловой контакт)",
  existing_relationship: "Существующие деловые отношения",
} as const;
export type ConsentBasis = keyof typeof CONSENT_BASES;

export function keysOf<T extends Record<string, string>>(o: T) {
  return Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
}

export function scoreCategory(score: number): { key: Priority; label: string; hint: string } {
  if (score >= 90)
    return { key: "very_high", label: "Очень высокий приоритет", hint: "Сильное соответствие критериям, есть актуальные подтверждённые сигналы." };
  if (score >= 70) return { key: "high", label: "Высокий приоритет", hint: "Хорошее соответствие, есть несколько полезных сигналов." };
  if (score >= 40) return { key: "medium", label: "Средний приоритет", hint: "Частичное соответствие или недостаточно информации." };
  return { key: "low", label: "Низкий приоритет", hint: "Слабое соответствие либо контакт/запрос неактуален." };
}

// Данные старше этого порога считаются потенциально устаревшими
export const STALE_DAYS = 90;

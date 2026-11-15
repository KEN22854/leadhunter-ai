import "server-only";
import nodemailer from "nodemailer";
import type { Channel } from "../domain";

// Адаптеры каналов связи. Секреты — из переменных окружения; значения из «Настройки → Подключения»
// (зашифрованы в БД) подставляются в process.env модулем settings-store.
// Ни один адаптер не имитирует успех: без конфигурации send() бросает ChannelError.

export type ChannelState = "connected" | "not_configured" | "unavailable";
export type ChannelStatus = { channel: Channel; state: ChannelState; detail: string; setupHint: string; supportsInbound: boolean };
export type OutgoingAttachment = { filename: string; content: Buffer; contentType: string };
export type SendInput = { to: string; threadId: string; subject: string; body: string; lastInboundAt: Date | null; attachments?: OutgoingAttachment[] };
export type SendResult = { externalId: string; threadId?: string };

export class ChannelError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

export interface ChannelAdapter {
  key: Channel;
  status(): ChannelStatus;
  verify(): Promise<{ ok: boolean; detail: string }>;
  send(input: SendInput): Promise<SendResult>;
}

const env = (k: string) => process.env[k]?.trim() ?? "";

// ---------- Email (SMTP) ----------
const email: ChannelAdapter = {
  key: "email",
  status() {
    const ok = env("SMTP_HOST") && env("SMTP_FROM");
    return {
      channel: "email",
      state: ok ? "connected" : "not_configured",
      detail: ok ? `SMTP ${env("SMTP_HOST")}, отправитель ${env("SMTP_FROM")}` : "SMTP не настроен",
      setupHint: "Задайте SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM в «Настройки → Подключения» (или .env) (рекомендуется отдельный ящик/домен для рассылок с SPF/DKIM).",
      supportsInbound: Boolean(env("IMAP_HOST")),
    };
  },
  async verify() {
    if (this.status().state !== "connected") return { ok: false, detail: "SMTP не настроен" };
    try {
      await transport().verify();
      return { ok: true, detail: "SMTP-сервер принял подключение" };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
  async send(i) {
    if (this.status().state !== "connected") throw new ChannelError("not_configured", "Email-канал не подключён");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.to)) throw new ChannelError("bad_recipient", "Некорректный email получателя");
    try {
      const from = env("SMTP_FROM");
      const fromAddr = from.match(/<([^>]+)>/)?.[1] ?? from;
      const info = await transport().sendMail({
        from,
        to: i.to,
        subject: i.subject || "(без темы)",
        text: i.body,
        attachments: i.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
        // Стандартный заголовок отписки: почтовые клиенты показывают кнопку «Отписаться»
        headers: { "List-Unsubscribe": `<mailto:${fromAddr}?subject=unsubscribe>` },
      });
      return { externalId: info.messageId ?? "", threadId: i.to };
    } catch (e) {
      throw new ChannelError("send_failed", `SMTP: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  },
};

function transport() {
  return nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT") || 587),
    secure: env("SMTP_SECURE") === "true",
    auth: env("SMTP_USER") ? { user: env("SMTP_USER"), pass: env("SMTP_PASS") } : undefined,
  });
}

// ---------- Telegram Bot API ----------
async function tg<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!json.ok) throw new ChannelError(json.error_code === 403 ? "blocked" : "send_failed", `Telegram: ${json.description ?? res.status}`, (json.error_code ?? 0) >= 500 || json.error_code === 429);
  return json.result as T;
}

const telegram: ChannelAdapter = {
  key: "telegram",
  status() {
    const ok = Boolean(env("TELEGRAM_BOT_TOKEN"));
    return {
      channel: "telegram",
      state: ok ? "connected" : "not_configured",
      detail: ok ? "Бот подключён. Писать можно только тем, кто сам начал диалог с ботом." : "Токен бота не задан",
      setupHint: "Создайте бота у @BotFather и задайте TELEGRAM_BOT_TOKEN. Клиент должен сам написать боту (/start) — после синхронизации переписка появится в карточке.",
      supportsInbound: true,
    };
  },
  async verify() {
    if (this.status().state !== "connected") return { ok: false, detail: "Токен не задан" };
    try {
      const me = await tg<{ username: string }>("getMe");
      return { ok: true, detail: `Бот @${me.username} доступен` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
  async send(i) {
    if (i.attachments?.length) throw new ChannelError("attachments_unsupported", "Вложения в этом канале не поддерживаются — отправьте ссылку");
    if (this.status().state !== "connected") throw new ChannelError("not_configured", "Telegram-канал не подключён");
    if (!/^-?\d+$/.test(i.threadId))
      throw new ChannelError("no_chat", "Нет диалога с этим пользователем: Telegram-бот может написать только тому, кто сам начал с ним диалог. Попросите клиента написать боту и нажмите «Синхронизировать».");
    const r = await tg<{ message_id: number }>("sendMessage", { chat_id: i.threadId, text: i.body });
    return { externalId: `tg:${i.threadId}:${r.message_id}`, threadId: i.threadId };
  },
};

export type TelegramUpdate = { update_id: number; message?: { message_id: number; date: number; text?: string; chat: { id: number }; from?: { username?: string; first_name?: string } } };
export async function telegramGetUpdates(offset?: number) {
  return tg<TelegramUpdate[]>("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
}

// ---------- WhatsApp Business Platform (Cloud API) ----------
const WA_VERSION = "v21.0";
const whatsapp: ChannelAdapter = {
  key: "whatsapp",
  status() {
    const ok = env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID");
    return {
      channel: "whatsapp",
      state: ok ? "connected" : "not_configured",
      detail: ok
        ? `Cloud API подключён${env("WHATSAPP_TEMPLATE_NAME") ? `, шаблон первого сообщения: ${env("WHATSAPP_TEMPLATE_NAME")}` : ", шаблон первого сообщения не задан"}`
        : "WhatsApp Business Platform не настроена",
      setupHint:
        "Нужен аккаунт WhatsApp Business Platform (Meta): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID и одобренный шаблон WHATSAPP_TEMPLATE_NAME. Произвольный текст разрешён только в течение 24 ч после сообщения клиента; первое обращение — только шаблоном и при наличии согласия (opt-in).",
      supportsInbound: false,
    };
  },
  async verify() {
    if (this.status().state !== "connected") return { ok: false, detail: "Не настроено" };
    try {
      const res = await fetch(`https://graph.facebook.com/${WA_VERSION}/${env("WHATSAPP_PHONE_NUMBER_ID")}`, {
        headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}` },
        signal: AbortSignal.timeout(15_000),
      });
      return res.ok ? { ok: true, detail: "Номер WhatsApp Business доступен" } : { ok: false, detail: `Graph API: ${res.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
  async send(i) {
    if (i.attachments?.length) throw new ChannelError("attachments_unsupported", "Вложения в этом канале не поддерживаются — отправьте ссылку");
    if (this.status().state !== "connected") throw new ChannelError("not_configured", "WhatsApp-канал не подключён");
    const to = i.to.replace(/[^\d]/g, "");
    const inWindow = i.lastInboundAt && Date.now() - i.lastInboundAt.getTime() < 24 * 3600_000;
    let payload: Record<string, unknown>;
    if (inWindow) payload = { messaging_product: "whatsapp", to, type: "text", text: { body: i.body } };
    else {
      if (!env("WHATSAPP_TEMPLATE_NAME"))
        throw new ChannelError("template_required", "Вне 24-часового окна WhatsApp разрешает только одобренные шаблоны. Задайте WHATSAPP_TEMPLATE_NAME или дождитесь сообщения клиента.");
      payload = { messaging_product: "whatsapp", to, type: "template", template: { name: env("WHATSAPP_TEMPLATE_NAME"), language: { code: env("WHATSAPP_TEMPLATE_LANG") || "ru" } } };
    }
    const res = await fetch(`https://graph.facebook.com/${WA_VERSION}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) throw new ChannelError("send_failed", `WhatsApp: ${json.error?.message ?? res.status}`, res.status >= 500 || res.status === 429);
    return { externalId: json.messages?.[0]?.id ?? "", threadId: to };
  },
};

// ---------- LinkedIn ----------
const linkedin: ChannelAdapter = {
  key: "linkedin",
  status() {
    return {
      channel: "linkedin",
      state: "unavailable",
      detail: "У LinkedIn нет открытого API для личных сообщений; автоматизация через аккаунт нарушает правила площадки.",
      setupHint: "Скопируйте текст и отправьте вручную в LinkedIn, затем отметьте отправку в переписке.",
      supportsInbound: false,
    };
  },
  async verify() {
    return { ok: false, detail: "Отправка через API недоступна" };
  },
  async send() {
    throw new ChannelError("unavailable", "Отправка в LinkedIn через API недоступна — отправьте вручную.");
  },
};

export const ADAPTERS: Record<Channel, ChannelAdapter> = { email, telegram, whatsapp, linkedin };

export function channelStatuses() {
  return Object.values(ADAPTERS).map((a) => a.status());
}

/** Какой тип контакта подходит каналу */
export const CHANNEL_CONTACT_TYPE: Record<Channel, string[]> = {
  email: ["email"],
  telegram: ["telegram"],
  whatsapp: ["whatsapp", "phone"],
  linkedin: ["linkedin"],
};

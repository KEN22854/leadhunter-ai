import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";

// Настройки подключений, редактируемые в интерфейсе (только администратор).
// Хранятся в AppState под ключами cfg:<ИМЯ>; секреты — зашифрованы AES-256-GCM ключом из AUTH_SECRET.
// Значение из БД имеет приоритет над .env и сразу применяется к process.env (адаптеры читают его при каждом вызове).
// Пустое значение в БД = «вернуть значение из .env».

export type SettingField = { key: string; label: string; secret?: boolean; placeholder?: string; hint?: string; type?: "text" | "number" | "bool" };
export type SettingGroup = { id: string; title: string; description: string; fields: SettingField[] };

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "smtp",
    title: "Email: отправка (SMTP)",
    description: "Ящик, с которого уходят письма. Рекомендуется отдельный ящик/домен с SPF и DKIM. Для Яндекса/Gmail/Mail.ru нужен «пароль приложения».",
    fields: [
      { key: "SMTP_HOST", label: "SMTP-сервер", placeholder: "smtp.yandex.ru" },
      { key: "SMTP_PORT", label: "Порт", placeholder: "465", type: "number" },
      { key: "SMTP_SECURE", label: "SSL/TLS (порт 465)", type: "bool" },
      { key: "SMTP_USER", label: "Логин", placeholder: "me@example.com" },
      { key: "SMTP_PASS", label: "Пароль приложения", secret: true },
      { key: "SMTP_FROM", label: "Отправитель", placeholder: "Анна Иванова <me@example.com>" },
    ],
  },
  {
    id: "imap",
    title: "Email: входящие (IMAP)",
    description: "Чтобы ответы клиентов попадали в карточки, а «отпишитесь» — в список запрета.",
    fields: [
      { key: "IMAP_HOST", label: "IMAP-сервер", placeholder: "imap.yandex.ru" },
      { key: "IMAP_PORT", label: "Порт", placeholder: "993", type: "number" },
      { key: "IMAP_SECURE", label: "SSL/TLS", type: "bool" },
      { key: "IMAP_USER", label: "Логин", placeholder: "me@example.com" },
      { key: "IMAP_PASS", label: "Пароль приложения", secret: true },
      { key: "IMAP_MAILBOX", label: "Папка", placeholder: "INBOX" },
    ],
  },
  {
    id: "telegram",
    title: "Telegram-бот",
    description: "Токен от @BotFather. Бот может писать только тем, кто сам начал с ним диалог.",
    fields: [{ key: "TELEGRAM_BOT_TOKEN", label: "Токен бота", secret: true, placeholder: "123456:ABC…" }],
  },
  {
    id: "whatsapp",
    title: "WhatsApp Business (Cloud API)",
    description: "Данные из Meta for Developers. Первое сообщение вне 24-часового окна — только одобренным шаблоном.",
    fields: [
      { key: "WHATSAPP_TOKEN", label: "Access token", secret: true },
      { key: "WHATSAPP_PHONE_NUMBER_ID", label: "Phone number ID" },
      { key: "WHATSAPP_TEMPLATE_NAME", label: "Имя шаблона" },
      { key: "WHATSAPP_TEMPLATE_LANG", label: "Язык шаблона", placeholder: "ru" },
    ],
  },
  {
    id: "social",
    title: "Источники «Спроса»: соцсети",
    description: "Официальные API площадок. Без ключей эти источники пропускаются.",
    fields: [
      { key: "REDDIT_CLIENT_ID", label: "Reddit client ID" },
      { key: "REDDIT_CLIENT_SECRET", label: "Reddit client secret", secret: true },
      { key: "VK_ACCESS_TOKEN", label: "VK access token", secret: true },
      { key: "X_BEARER_TOKEN", label: "X (Twitter) bearer token", secret: true },
      { key: "THREADS_ACCESS_TOKEN", label: "Threads access token", secret: true, hint: "Долгоживущий токен (60 дней) с разрешениями threads_basic, threads_keyword_search, threads_content_publish, threads_manage_replies" },
      { key: "THREADS_DAILY_REPLY_LIMIT", label: "Threads: ответов в сутки (лимит приложения)", placeholder: "20", type: "number" },
      { key: "THREADS_REPLY_INTERVAL_MIN", label: "Threads: пауза между ответами, минут", placeholder: "5", type: "number" },
      { key: "INSTAGRAM_ACCESS_TOKEN", label: "Instagram access token", secret: true },
      { key: "INSTAGRAM_USER_ID", label: "Instagram user ID" },
      { key: "DISCORD_BOT_TOKEN", label: "Discord bot token", secret: true },
    ],
  },
  {
    id: "search",
    title: "Источники «Спроса»: поиск, карты, каталоги",
    description: "Ключи поисковых систем, карт и Crunchbase.",
    fields: [
      { key: "GOOGLE_CSE_KEY", label: "Google Custom Search key", secret: true },
      { key: "GOOGLE_CSE_CX", label: "Google Custom Search CX" },
      { key: "YANDEX_SEARCH_API_KEY", label: "Yandex Search API key", secret: true },
      { key: "YANDEX_FOLDER_ID", label: "Yandex Cloud folder ID" },
      { key: "GOOGLE_PLACES_API_KEY", label: "Google Places API key", secret: true },
      { key: "YANDEX_MAPS_API_KEY", label: "Яндекс Карты (поиск организаций)", secret: true },
      { key: "DGIS_API_KEY", label: "2ГИС API key", secret: true },
      { key: "CRUNCHBASE_API_KEY", label: "Crunchbase API key", secret: true },
    ],
  },
];

const FIELDS = new Map(SETTING_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f] as const)));
export const isSettingKey = (k: string) => FIELDS.has(k);

const g = globalThis as unknown as { __lhEnvOriginal?: Record<string, string | undefined>; __lhSettingsLoaded?: boolean };
/** Значения из .env на момент старта — чтобы вернуть их, если настройку в БД очистили */
function original() {
  if (!g.__lhEnvOriginal) g.__lhEnvOriginal = Object.fromEntries([...FIELDS.keys()].map((k) => [k, process.env[k]]));
  return g.__lhEnvOriginal;
}

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET не задан или короче 32 символов — секреты нельзя зашифровать");
  return createHash("sha256").update(`leadhunter-settings:${secret}`).digest();
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `enc:v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

export function decrypt(stored: string): string {
  if (!stored.startsWith("enc:v1:")) return stored;
  const [, , iv, tag, data] = stored.split(":");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** Применяет сохранённые настройки к process.env. Безопасно вызывать многократно. */
export async function applyStoredSettings() {
  const orig = original();
  const rows = await prisma.appState.findMany({ where: { key: { startsWith: "cfg:" } } });
  const stored = new Map(rows.map((r) => [r.key.slice(4), r.value]));
  for (const k of FIELDS.keys()) {
    const v = stored.get(k);
    let val: string | undefined;
    if (v) {
      try {
        val = decrypt(v);
      } catch {
        console.error(`[settings] не удалось расшифровать ${k} (сменился AUTH_SECRET?)`);
        val = undefined;
      }
    }
    if (val) process.env[k] = val;
    else if (orig[k] !== undefined) process.env[k] = orig[k];
    else delete process.env[k];
  }
  g.__lhSettingsLoaded = true;
}

export async function ensureSettingsLoaded() {
  if (!g.__lhSettingsLoaded) await applyStoredSettings();
}

export type SettingView = SettingField & { value: string; isSet: boolean; source: "db" | "env" | "none" };

/** Состояние для UI. Секреты не возвращаются никогда — только признак «задан» и последние 4 символа. */
export async function settingsView(): Promise<{ groups: (SettingGroup & { fields: SettingView[] })[] }> {
  await ensureSettingsLoaded();
  const orig = original();
  const rows = await prisma.appState.findMany({ where: { key: { startsWith: "cfg:" } } });
  const inDb = new Set(rows.filter((r) => r.value).map((r) => r.key.slice(4)));
  return {
    groups: SETTING_GROUPS.map((gr) => ({
      ...gr,
      fields: gr.fields.map((f) => {
        const cur = process.env[f.key]?.trim() ?? "";
        const source = inDb.has(f.key) ? "db" : orig[f.key]?.trim() ? "env" : "none";
        return { ...f, isSet: Boolean(cur), source, value: f.secret ? (cur ? `••••${cur.slice(-4)}` : "") : cur };
      }),
    })),
  };
}

/** Сохранение. Для секретов undefined = не менять; "" = очистить (вернуть .env). */
export async function saveSettings(values: Record<string, string | undefined>) {
  for (const [k, raw] of Object.entries(values)) {
    const f = FIELDS.get(k);
    if (!f || raw === undefined) continue;
    const v = raw.trim();
    const dbKey = `cfg:${k}`;
    if (!v) await prisma.appState.deleteMany({ where: { key: dbKey } });
    else {
      const value = f.secret ? encrypt(v) : v;
      await prisma.appState.upsert({ where: { key: dbKey }, update: { value }, create: { key: dbKey, value } });
    }
  }
  await applyStoredSettings();
}

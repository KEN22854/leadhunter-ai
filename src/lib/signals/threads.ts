import "server-only";
import { prisma } from "../db";

// Официальная отправка ответов в Threads (Threads API, graph.threads.net).
// Нужны разрешения приложения: threads_basic, threads_content_publish, threads_manage_replies,
// а для ответов на чужие посты из поиска — одобренное threads_keyword_search.
// Ограничения Meta: до 1000 ответов в сутки на профиль; текст — до 500 символов.
// Свои, более строгие лимиты приложения (по умолчанию 20 ответов в сутки, пауза 5 минут) — защита от спама:
// массовые одинаковые ответы незнакомым людям Meta считает спамом даже в пределах квоты.

const BASE = "https://graph.threads.net/v1.0";
export const THREADS_MAX_TEXT = 500;

const env = (k: string) => process.env[k]?.trim() ?? "";
export const threadsToken = () => env("THREADS_ACCESS_TOKEN");
export const threadsDailyLimit = () => Math.max(1, Math.min(500, Number(env("THREADS_DAILY_REPLY_LIMIT")) || 20));
export const threadsIntervalMin = () => Math.max(1, Math.min(240, Number(env("THREADS_REPLY_INTERVAL_MIN")) || 5));

export class ThreadsError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, params: Record<string, string>): Promise<T> {
  const token = threadsToken();
  if (!token) throw new ThreadsError("Threads не подключён: задайте токен в «Настройки → Подключения»");
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  let res: Response;
  try {
    res = await fetch(u, { method, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new ThreadsError(`Threads API недоступен из этой сети (${e instanceof Error ? ((e.cause as { code?: string })?.code ?? e.message) : e})`, true);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_subcode?: number } };
  if (!res.ok || json.error) {
    const m = json.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429 || json.error?.code === 4 || json.error?.code === 17) throw new ThreadsError(`Лимит Threads API: ${m}`, true);
    if (res.status === 401 || json.error?.code === 190) throw new ThreadsError(`Токен Threads недействителен или истёк: ${m}`);
    if (json.error?.code === 10 || json.error?.code === 200) throw new ThreadsError(`У приложения нет разрешения (threads_content_publish / threads_manage_replies / threads_keyword_search): ${m}`);
    throw new ThreadsError(`Threads API: ${m}`, res.status >= 500);
  }
  return json;
}

/** Квота ответов профиля за последние 24 часа (по данным Meta). */
export async function threadsReplyQuota(): Promise<{ used: number; total: number } | null> {
  try {
    const r = await call<{ data?: { reply_quota_usage?: number; reply_config?: { quota_total?: number } }[] }>("GET", "/me/threads_publishing_limit", { fields: "reply_quota_usage,reply_config" });
    const d = r.data?.[0];
    return d ? { used: d.reply_quota_usage ?? 0, total: d.reply_config?.quota_total ?? 1000 } : null;
  } catch {
    return null;
  }
}

/** Публикует текстовый ответ на пост. Возвращает id ответа. */
export async function publishThreadsReply(replyToId: string, text: string): Promise<{ id: string }> {
  if (!/^\d{5,30}$/.test(replyToId)) throw new ThreadsError("Нет идентификатора поста Threads — ответ через API возможен только для постов, найденных через Threads API");
  const body = text.trim();
  if (!body) throw new ThreadsError("Пустой текст");
  if ([...body].length > THREADS_MAX_TEXT) throw new ThreadsError(`Текст длиннее ${THREADS_MAX_TEXT} символов — сократите его`);
  const quota = await threadsReplyQuota();
  if (quota && quota.used >= quota.total) throw new ThreadsError(`Исчерпана суточная квота ответов Threads (${quota.used}/${quota.total})`, true);
  // 1) контейнер ответа
  const c = await call<{ id: string }>("POST", "/me/threads", { media_type: "TEXT", text: body, reply_to_id: replyToId });
  // 2) ждём готовности контейнера (для текста обычно мгновенно), не дольше ~30 с
  for (let i = 0; i < 6; i++) {
    const s = await call<{ status?: string; error_message?: string }>("GET", `/${c.id}`, { fields: "status,error_message" }).catch(() => ({ status: "FINISHED" }) as { status?: string; error_message?: string });
    if (!s.status || s.status === "FINISHED" || s.status === "PUBLISHED") break;
    if (s.status === "ERROR" || s.status === "EXPIRED") throw new ThreadsError(`Threads отклонил ответ: ${s.error_message ?? s.status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  // 3) публикация
  return call<{ id: string }>("POST", "/me/threads_publish", { creation_id: c.id });
}

/** Сколько ответов приложение уже отправило через API за последние 24 часа и когда был последний. */
export async function threadsAppUsage(ownerId: string) {
  const since = new Date(Date.now() - 86_400_000);
  const sent = await prisma.outreachAttempt.findMany({ where: { channel: "threads", mode: "api", status: "sent", sentAt: { gte: since }, lead: { ownerId } }, select: { sentAt: true }, orderBy: { sentAt: "desc" } });
  return { sent24h: sent.length, lastAt: sent[0]?.sentAt ?? null, limit: threadsDailyLimit(), intervalMin: threadsIntervalMin() };
}

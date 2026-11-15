import "server-only";
import { prisma } from "../db";
import { robotsAllows } from "../webfetch";

// HTTP-слой адаптеров: единый User-Agent, таймаут, лимит размера, минимальный интервал между запросами
// к одному источнику, дневной лимит, экспоненциальный бэкофф после ошибок/429, учёт состояния (SourceState),
// проверка robots.txt для HTML-страниц. Никаких обходов CAPTCHA/авторизации: 401/403/429 — это стоп, а не повод обходить.

export const SIGNAL_UA = "LeadHunterAI/0.3 (+lead discovery; respects robots.txt and platform limits)";
const MAX_BYTES = 3_000_000;

export class SourceError extends Error {
  constructor(
    public source: string,
    message: string,
    public transient: boolean,
    public status?: number,
  ) {
    super(message);
  }
}

/** Минимальный интервал между запросами к источнику (мс) и дневной лимит запросов */
const LIMITS: Record<string, { gapMs: number; perDay: number }> = {
  kwork: { gapMs: 10 * 60_000, perDay: 60 },
  fl_ru: { gapMs: 60_000, perDay: 500 },
  telegram: { gapMs: 3_000, perDay: 800 },
  reddit: { gapMs: 1_100, perDay: 5000 },
  hn: { gapMs: 1_000, perDay: 5000 },
  freelancer: { gapMs: 2_000, perDay: 2000 },
  habr: { gapMs: 2_000, perDay: 1000 },
  vc_ru: { gapMs: 30_000, perDay: 500 },
  google_search: { gapMs: 1_000, perDay: 100 },
  yandex_search: { gapMs: 1_000, perDay: 500 },
  x: { gapMs: 2_000, perDay: 300 },
};
const DEFAULT_LIMIT = { gapMs: 1_500, perDay: 1000 };

const lastHit = new Map<string, number>();
const robotsCache = new Map<string, { at: number; text: string | null }>();

async function state(source: string) {
  return prisma.sourceState.upsert({ where: { source }, update: {}, create: { source } });
}

export async function sourceAvailability(source: string) {
  const s = await prisma.sourceState.findUnique({ where: { source } });
  if (s?.backoffUntil && s.backoffUntil > new Date()) return { ok: false, until: s.backoffUntil, reason: s.lastError };
  return { ok: true as const };
}

async function markOk(source: string) {
  await prisma.sourceState.update({ where: { source }, data: { lastOkAt: new Date(), consecutiveFails: 0, backoffUntil: null, lastError: "" } }).catch(() => {});
}

async function markFail(source: string, msg: string, retryAfterSec?: number) {
  const s = await state(source);
  const fails = s.consecutiveFails + 1;
  const backoffMs = retryAfterSec ? retryAfterSec * 1000 : Math.min(6 * 3600_000, 60_000 * 2 ** Math.min(fails, 8));
  await prisma.sourceState.update({
    where: { source },
    data: { lastErrorAt: new Date(), lastError: msg.slice(0, 300), consecutiveFails: fails, backoffUntil: fails >= 2 || retryAfterSec ? new Date(Date.now() + backoffMs) : null },
  });
}

async function robotsOk(url: URL): Promise<boolean> {
  const origin = url.origin;
  let c = robotsCache.get(origin);
  if (!c || Date.now() - c.at > 6 * 3600_000) {
    try {
      const r = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": SIGNAL_UA }, signal: AbortSignal.timeout(8000) });
      c = { at: Date.now(), text: r.ok ? await r.text() : null };
    } catch {
      c = { at: Date.now(), text: null };
    }
    robotsCache.set(origin, c);
  }
  return c.text === null ? true : robotsAllows(c.text, url.pathname + url.search);
}

export type SourceRequest = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** HTML-страница площадки — проверять robots.txt (для API и RSS, предназначенных для подписки, не требуется) */
  html?: boolean;
  timeoutMs?: number;
};

/** Запрос к источнику с учётом лимитов. Возвращает текст ответа; при ошибке — SourceError. */
export async function sourceFetch(source: string, url: string, req: SourceRequest = {}): Promise<string> {
  const avail = await sourceAvailability(source);
  if (!avail.ok) throw new SourceError(source, `Источник на паузе до ${avail.until.toLocaleString("ru-RU")} после ошибок: ${avail.reason}`, false);
  const lim = LIMITS[source] ?? DEFAULT_LIMIT;
  const s = await state(source);
  const day = new Date().toISOString().slice(0, 10);
  const used = s.dayKey === day ? s.requestsToday : 0;
  if (used >= lim.perDay) throw new SourceError(source, `Дневной лимит запросов (${lim.perDay}) исчерпан`, false);

  const u = new URL(url);
  if (req.html && !(await robotsOk(u))) throw new SourceError(source, `robots.txt запрещает ${u.pathname}`, false);

  // Выдерживаем интервал между запросами к одному источнику (в пределах процесса)
  const wait = (lastHit.get(source) ?? 0) + lim.gapMs - Date.now();
  if (wait > 0) {
    if (wait > 20_000) throw new SourceError(source, `Слишком частые запросы: следующий не раньше чем через ${Math.ceil(wait / 1000)} с`, false);
    await new Promise((r) => setTimeout(r, wait));
  }
  lastHit.set(source, Date.now());
  await prisma.sourceState.update({ where: { source }, data: { lastRequestAt: new Date(), dayKey: day, requestsToday: used + 1 } });

  let res: Response;
  try {
    res = await fetch(u, {
      method: req.method ?? "GET",
      headers: { "User-Agent": SIGNAL_UA, Accept: "application/json, application/rss+xml, application/atom+xml, text/xml, text/html;q=0.8", ...req.headers },
      body: req.body,
      redirect: "follow",
      signal: AbortSignal.timeout(req.timeoutMs ?? 20_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? ((e.cause as { code?: string })?.code ?? e.message) : String(e);
    await markFail(source, `Сеть: ${msg}`);
    throw new SourceError(source, `Источник недоступен из этой сети (${msg})`, true);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new SourceError(source, "Слишком большой ответ", false);
  const text = buf.toString("utf8");
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after")) || 900;
    await markFail(source, "429: лимит площадки", ra);
    throw new SourceError(source, `Площадка ограничила частоту запросов (429), пауза ${Math.round(ra / 60)} мин`, false, 429);
  }
  if (res.status === 401 || res.status === 403) {
    await markFail(source, `${res.status}: доступ запрещён`);
    throw new SourceError(source, `Доступ запрещён (${res.status}) — проверьте ключ/токен или ограничения площадки. Обход не выполняется.`, false, res.status);
  }
  if (res.status >= 500) {
    await markFail(source, `${res.status}`);
    throw new SourceError(source, `Ошибка площадки (${res.status})`, true, res.status);
  }
  if (!res.ok) {
    await markFail(source, `${res.status}: ${text.slice(0, 120)}`);
    throw new SourceError(source, `Ответ ${res.status}: ${text.replace(/\s+/g, " ").slice(0, 160)}`, false, res.status);
  }
  await markOk(source);
  return text;
}

export async function sourceJson<T>(source: string, url: string, req: SourceRequest = {}): Promise<T> {
  const t = await sourceFetch(source, url, req);
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new SourceError(source, "Ответ не JSON (возможно, изменился формат площадки)", false);
  }
}

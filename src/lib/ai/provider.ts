import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { prisma } from "../db";
import { ApiError } from "../api";
import { checkRateLimit } from "../ratelimit";

// Серверный слой вызовов Claude. Ключ берётся только из окружения и никогда не попадает в промпты/клиент.
// Ошибки провайдера переводятся в ApiError с понятными кодами; SDK сам делает повторы с backoff (maxRetries).

export const AI_PROVIDER = "anthropic";
export function aiModel() {
  return process.env.AI_MODEL || "claude-opus-5-5";
}

// Цена за 1M токенов (input/output), USD — для оценки расходов в AIUsageLog
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-2": [8, 40],
};

export function isAIConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 120_000 });
  return _client;
}

type CallMeta = { userId: string; clientId?: string | null; operation: string };

async function logUsage(meta: CallMeta, model: string, status: string, usage?: { input_tokens?: number; output_tokens?: number }, error = "") {
  const [pi, po] = PRICES[model] ?? [0, 0];
  const inT = usage?.input_tokens ?? 0;
  const outT = usage?.output_tokens ?? 0;
  await prisma.aIUsageLog
    .create({
      data: {
        userId: meta.userId,
        clientId: meta.clientId ?? null,
        provider: AI_PROVIDER,
        model,
        operation: meta.operation,
        inputTokens: inT,
        outputTokens: outT,
        costEstimate: (inT * pi + outT * po) / 1_000_000,
        status,
        error: error.slice(0, 500),
      },
    })
    .catch((e) => console.error("[ai] usage log failed", e));
}

function preflight(meta: CallMeta) {
  if (!isAIConfigured()) {
    void logUsage(meta, aiModel(), "not_configured");
    throw new ApiError(503, "ai_not_configured", "AI не подключён: задайте ANTHROPIC_API_KEY в .env на сервере и перезапустите приложение.");
  }
  const limit = Number(process.env.AI_RATE_LIMIT_PER_MIN || 12);
  const rl = checkRateLimit(`ai:${meta.userId}`, limit);
  if (!rl.ok) throw new ApiError(429, "ai_rate_limited", `Лимит AI-запросов исчерпан, повторите через ${rl.retryAfterSec} с.`, { retryAfterSec: rl.retryAfterSec });
}

function mapError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new ApiError(503, "ai_auth", "Ключ Anthropic API недействителен или отозван.");
  if (e instanceof Anthropic.PermissionDeniedError) return new ApiError(503, "ai_forbidden", "У ключа нет доступа к выбранной модели.");
  if (e instanceof Anthropic.RateLimitError) return new ApiError(429, "ai_provider_rate_limited", "Провайдер AI временно ограничил запросы. Повторите позже.");
  if (e instanceof Anthropic.BadRequestError) return new ApiError(502, "ai_bad_request", "Провайдер AI отклонил запрос.", { detail: e.message });
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ApiError(504, "ai_timeout", "AI не ответил вовремя. Повторите попытку.");
  if (e instanceof Anthropic.APIConnectionError) return new ApiError(503, "ai_unavailable", "Нет соединения с AI-провайдером.");
  if (e instanceof Anthropic.APIError) return new ApiError(503, "ai_unavailable", `AI временно недоступен (${e.status ?? "?"}).`);
  return new ApiError(500, "ai_error", "Ошибка AI-обработки.");
}

/** Вызов со структурированным ответом по zod-схеме. */
export async function callStructured<S extends z.ZodType>(
  meta: CallMeta,
  opts: { system: string; user: string; schema: S; effort?: "low" | "medium" | "high"; maxTokens?: number },
): Promise<{ data: z.infer<S>; model: string }> {
  preflight(meta);
  const model = aiModel();
  try {
    const res = await client().beta.messages.parse({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      messages: [{ role: "user", content: opts.user }],
    });
    if (res.stop_reason === "refusal") {
      await logUsage(meta, res.model, "refused", res.usage);
      throw new ApiError(422, "ai_refused", "Модель отказалась выполнять запрос. Измените формулировку или данные.");
    }
    if (res.stop_reason === "max_tokens" || !res.parsed_output) {
      await logUsage(meta, res.model, "error", res.usage, "incomplete output");
      throw new ApiError(502, "ai_incomplete", "AI вернул неполный ответ. Повторите попытку.");
    }
    await logUsage(meta, res.model, "ok", res.usage);
    return { data: res.parsed_output as z.infer<S>, model: res.model };
  } catch (e) {
    const err = mapError(e);
    if (!(e instanceof ApiError)) await logUsage(meta, model, "error", undefined, e instanceof Error ? e.message : String(e));
    throw err;
  }
}

/** Свободный текстовый ответ (Copilot). */
export async function callText(
  meta: CallMeta,
  opts: { system: string; messages: Anthropic.Beta.BetaMessageParam[]; effort?: "low" | "medium" | "high" },
): Promise<{ text: string; model: string }> {
  preflight(meta);
  const model = aiModel();
  try {
    const res = await client().beta.messages.create({
      model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: { effort: opts.effort ?? "low" },
      messages: opts.messages,
    });
    if (res.stop_reason === "refusal") {
      await logUsage(meta, res.model, "refused", res.usage);
      throw new ApiError(422, "ai_refused", "Модель отказалась отвечать на этот запрос.");
    }
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    await logUsage(meta, res.model, "ok", res.usage);
    return { text, model: res.model };
  } catch (e) {
    const err = mapError(e);
    if (!(e instanceof ApiError)) await logUsage(meta, model, "error", undefined, e instanceof Error ? e.message : String(e));
    throw err;
  }
}

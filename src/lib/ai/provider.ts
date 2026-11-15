import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError } from "../api";
import { checkRateLimit } from "../ratelimit";
import { claudeCodeStatus, runClaudeCode, type ClaudeCodeResult } from "./claude-code";

// Серверный слой вызовов Claude. Два бэкенда:
//  - "anthropic"   — Anthropic API по ANTHROPIC_API_KEY (оплата по токенам);
//  - "claude-code" — локальный Claude Code CLI (`claude -p`) под аккаунтом, в который вошли на этом компьютере
//                    (подписка Claude). Ключ не нужен, но работает только там, где установлен и авторизован CLI.
// AI_PROVIDER=auto (по умолчанию): API-ключ, если задан, иначе Claude Code, если найден.

export type AIBackend = "anthropic" | "claude-code";

export function aiModel() {
  return process.env.AI_MODEL || "claude-opus-5-5";
}
function cliModel() {
  return process.env.AI_CLI_MODEL || "opus";
}

// Цена за 1M токенов (input/output), USD — для оценки расходов в AIUsageLog
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-2": [8, 40],
};

export async function activeBackend(): Promise<AIBackend | null> {
  const pref = (process.env.AI_PROVIDER || "auto").toLowerCase();
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  if (pref === "anthropic") return hasKey ? "anthropic" : null;
  if (pref === "claude-code") return (await claudeCodeStatus()).available ? "claude-code" : null;
  if (hasKey) return "anthropic";
  return (await claudeCodeStatus()).available ? "claude-code" : null;
}

export async function isAIConfigured() {
  return (await activeBackend()) !== null;
}

export async function aiStatus() {
  const backend = await activeBackend();
  const cli = await claudeCodeStatus();
  return {
    configured: backend !== null,
    backend,
    model: backend === "claude-code" ? cliModel() : backend ? aiModel() : null,
    claudeCode: cli,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  };
}

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 180_000 });
  return _client;
}

type CallMeta = { userId: string; clientId?: string | null; operation: string };

async function logUsage(
  meta: CallMeta,
  provider: string,
  model: string,
  status: string,
  usage?: { input_tokens?: number; output_tokens?: number },
  error = "",
  costOverride?: number,
) {
  const [pi, po] = PRICES[model] ?? [0, 0];
  const inT = usage?.input_tokens ?? 0;
  const outT = usage?.output_tokens ?? 0;
  await prisma.aIUsageLog
    .create({
      data: {
        userId: meta.userId,
        clientId: meta.clientId ?? null,
        provider,
        model,
        operation: meta.operation,
        inputTokens: inT,
        outputTokens: outT,
        costEstimate: costOverride ?? (inT * pi + outT * po) / 1_000_000,
        status,
        error: error.slice(0, 500),
      },
    })
    .catch((e) => console.error("[ai] usage log failed", e));
}

async function preflight(meta: CallMeta): Promise<AIBackend> {
  const backend = await activeBackend();
  if (!backend) {
    void logUsage(meta, "none", "-", "not_configured");
    throw new ApiError(
      503,
      "ai_not_configured",
      "AI не подключён: войдите в Claude Code на этом компьютере (команда `claude`) или задайте ANTHROPIC_API_KEY в .env и перезапустите приложение.",
    );
  }
  const limit = Number(process.env.AI_RATE_LIMIT_PER_MIN || 12);
  const rl = checkRateLimit(`ai:${meta.userId}`, limit);
  if (!rl.ok) throw new ApiError(429, "ai_rate_limited", `Лимит AI-запросов исчерпан, повторите через ${rl.retryAfterSec} с.`, { retryAfterSec: rl.retryAfterSec });
  return backend;
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

function cliUsage(r: ClaudeCodeResult) {
  return { input_tokens: r.inputTokens, output_tokens: r.outputTokens };
}

/** Вызов со структурированным ответом по zod-схеме. */
export async function callStructured<S extends z.ZodType>(
  meta: CallMeta,
  opts: { system: string; user: string; schema: S; effort?: "low" | "medium" | "high"; maxTokens?: number; timeoutMs?: number },
): Promise<{ data: z.infer<S>; model: string }> {
  const backend = await preflight(meta);

  if (backend === "claude-code") {
    const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7" });
    const r = await runClaudeCode({ system: opts.system, prompt: opts.user, jsonSchema, model: cliModel(), timeoutMs: opts.timeoutMs });
    if (!r.ok) {
      await logUsage(meta, "claude-code", r.model || cliModel(), "error", cliUsage(r), r.error);
      throw r.apiError;
    }
    const parsed = opts.schema.safeParse(r.structured);
    if (!parsed.success) {
      await logUsage(meta, "claude-code", r.model, "error", cliUsage(r), "schema mismatch");
      throw new ApiError(502, "ai_incomplete", "AI вернул ответ не по схеме. Повторите попытку.");
    }
    await logUsage(meta, "claude-code", r.model, "ok", cliUsage(r), "", r.costUsd);
    return { data: parsed.data as z.infer<S>, model: r.model };
  }

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
      await logUsage(meta, "anthropic", res.model, "refused", res.usage);
      throw new ApiError(422, "ai_refused", "Модель отказалась выполнять запрос. Измените формулировку или данные.");
    }
    if (res.stop_reason === "max_tokens" || !res.parsed_output) {
      await logUsage(meta, "anthropic", res.model, "error", res.usage, "incomplete output");
      throw new ApiError(502, "ai_incomplete", "AI вернул неполный ответ. Повторите попытку.");
    }
    await logUsage(meta, "anthropic", res.model, "ok", res.usage);
    return { data: res.parsed_output as z.infer<S>, model: res.model };
  } catch (e) {
    const err = mapError(e);
    if (!(e instanceof ApiError)) await logUsage(meta, "anthropic", model, "error", undefined, e instanceof Error ? e.message : String(e));
    throw err;
  }
}

/** Свободный текстовый ответ (Copilot). */
export async function callText(
  meta: CallMeta,
  opts: { system: string; messages: { role: "user" | "assistant"; content: string }[]; effort?: "low" | "medium" | "high" },
): Promise<{ text: string; model: string }> {
  const backend = await preflight(meta);

  if (backend === "claude-code") {
    // CLI получает диалог одним сообщением: история в тегах, последний вопрос — отдельно.
    const history = opts.messages.slice(0, -1);
    const last = opts.messages[opts.messages.length - 1]?.content ?? "";
    const prompt = `${history.length ? `<previous_turns>\n${history.map((m) => `[${m.role === "user" ? "Пользователь" : "Ассистент"}]: ${m.content}`).join("\n\n")}\n</previous_turns>\n\n` : ""}${last}`;
    const r = await runClaudeCode({ system: opts.system, prompt, model: cliModel() });
    if (!r.ok) {
      await logUsage(meta, "claude-code", r.model || cliModel(), "error", cliUsage(r), r.error);
      throw r.apiError;
    }
    await logUsage(meta, "claude-code", r.model, "ok", cliUsage(r), "", r.costUsd);
    return { text: r.text.trim(), model: r.model };
  }

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
      await logUsage(meta, "anthropic", res.model, "refused", res.usage);
      throw new ApiError(422, "ai_refused", "Модель отказалась отвечать на этот запрос.");
    }
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    await logUsage(meta, "anthropic", res.model, "ok", res.usage);
    return { text, model: res.model };
  } catch (e) {
    const err = mapError(e);
    if (!(e instanceof ApiError)) await logUsage(meta, "anthropic", model, "error", undefined, e instanceof Error ? e.message : String(e));
    throw err;
  }
}

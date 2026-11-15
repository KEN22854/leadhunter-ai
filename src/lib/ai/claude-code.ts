import "server-only";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiError } from "../api";

// Бэкенд AI через локальный Claude Code CLI (`claude -p`). Работает под аккаунтом, в который пользователь
// вошёл на этом компьютере (`claude auth login`), — отдельный API-ключ не нужен.
// Изоляция: пустая рабочая папка, все инструменты отключены (--tools ""), без MCP, без пользовательских
// настроек и без сохранения сессий. Модель только генерирует текст/JSON — ничего не читает и не запускает.

const CLI = () => process.env.CLAUDE_CLI_PATH || "claude";
const MAX_CONCURRENT = 2;

let statusCache: { at: number; value: ClaudeCodeStatus } | null = null;
export type ClaudeCodeStatus = { available: boolean; version: string | null; loggedIn: boolean; authMethod: string | null; error: string | null };

function run(args: string[], input: string | null, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const cwd = path.join(tmpdir(), "leadhunter-claude");
    mkdirSync(cwd, { recursive: true });
    let child;
    try {
      child = spawn(CLI(), args, { cwd, windowsHide: true, env: { ...process.env, ANTHROPIC_API_KEY: "" } });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e), timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + e.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (input !== null) child.stdin.end(input, "utf8");
    else child.stdin.end();
  });
}

export async function claudeCodeStatus(force = false): Promise<ClaudeCodeStatus> {
  if (process.env.AI_DISABLE_CLAUDE_CODE === "1") return { available: false, version: null, loggedIn: false, authMethod: null, error: "Отключено (AI_DISABLE_CLAUDE_CODE=1)" };
  if (!force && statusCache && Date.now() - statusCache.at < 5 * 60_000) return statusCache.value;
  let value: ClaudeCodeStatus;
  const v = await run(["--version"], null, 15_000);
  if (v.code !== 0) {
    value = { available: false, version: null, loggedIn: false, authMethod: null, error: "Claude Code CLI не найден (команда `claude`)" };
  } else {
    const version = v.stdout.trim().split(/\s+/)[0] || null;
    const a = await run(["auth", "status"], null, 15_000);
    let loggedIn = false;
    let authMethod: string | null = null;
    try {
      const j = JSON.parse(a.stdout) as { loggedIn?: boolean; authMethod?: string };
      loggedIn = Boolean(j.loggedIn);
      authMethod = j.authMethod ?? null;
    } catch {
      loggedIn = a.code === 0;
    }
    value = { available: loggedIn, version, loggedIn, authMethod, error: loggedIn ? null : "Claude Code установлен, но вход не выполнен — запустите `claude` и войдите" };
  }
  statusCache = { at: Date.now(), value };
  return value;
}

// Простой семафор: не больше MAX_CONCURRENT процессов CLI одновременно
let active = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}

export type ClaudeCodeResult =
  | { ok: true; text: string; structured: unknown; model: string; inputTokens: number; outputTokens: number; costUsd: number }
  | { ok: false; error: string; apiError: ApiError; model: string; inputTokens: number; outputTokens: number };

type CliJson = {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  api_error_status?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
};

export async function runClaudeCode(opts: { system: string; prompt: string; jsonSchema?: object; model: string; timeoutMs?: number }): Promise<ClaudeCodeResult> {
  const args = ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--setting-sources", "", "--model", opts.model, "--system-prompt", opts.system];
  if (opts.jsonSchema) args.push("--json-schema", JSON.stringify(opts.jsonSchema));
  await acquire();
  let r;
  try {
    r = await run(args, opts.prompt, opts.timeoutMs ?? 300_000);
  } finally {
    release();
  }
  const fail = (error: string, apiError: ApiError, j?: CliJson): ClaudeCodeResult => ({
    ok: false,
    error,
    apiError,
    model: j?.modelUsage ? Object.keys(j.modelUsage)[0] ?? opts.model : opts.model,
    inputTokens: j?.usage?.input_tokens ?? 0,
    outputTokens: j?.usage?.output_tokens ?? 0,
  });
  if (r.timedOut) return fail("timeout", new ApiError(504, "ai_timeout", "Claude Code не ответил вовремя. Повторите попытку."));
  let j: CliJson;
  try {
    j = JSON.parse(r.stdout) as CliJson;
  } catch {
    const msg = (r.stderr || r.stdout).slice(0, 300);
    return fail(msg || `exit ${r.code}`, new ApiError(503, "ai_unavailable", `Claude Code завершился с ошибкой: ${msg || `код ${r.code}`}`));
  }
  const model = j.modelUsage ? Object.keys(j.modelUsage)[0] ?? opts.model : opts.model;
  if (j.is_error || j.subtype !== "success") {
    const status = j.api_error_status;
    const text = String(j.result ?? j.subtype ?? "error");
    if (status === 403 && /isn't allowed|unsupported region|blocked/i.test(text))
      return fail(
        text,
        new ApiError(503, "ai_region_blocked", "Anthropic отклонил запрос из этой сети (HTTP 403: регион или тип сети не поддерживается). С этого подключения AI недоступен; остальные функции работают."),
        j,
      );
    if (status === 429 || /limit/i.test(text))
      return fail(text, new ApiError(429, "ai_provider_rate_limited", "Достигнут лимит подписки Claude. Повторите позже."), j);
    if (status === 401 || /log ?in|auth/i.test(text)) {
      statusCache = null;
      return fail(text, new ApiError(503, "ai_auth", "Claude Code не авторизован — выполните `claude` и войдите в аккаунт."), j);
    }
    return fail(text, new ApiError(503, "ai_unavailable", `Claude Code вернул ошибку: ${text.slice(0, 200)}`), j);
  }
  if (opts.jsonSchema && (j.structured_output === undefined || j.structured_output === null))
    return fail("no structured output", new ApiError(502, "ai_incomplete", "AI вернул неполный ответ. Повторите попытку."), j);
  const u = j.usage ?? {};
  return {
    ok: true,
    text: j.result ?? "",
    structured: j.structured_output,
    model,
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    costUsd: j.total_cost_usd ?? 0,
  };
}

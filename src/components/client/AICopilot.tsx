"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, Eraser, Send, X } from "lucide-react";
import { Button, InlineError, clsx } from "@/components/ui";
import { api, ApiClientError, useApi } from "@/lib/client-api";
import { useClient } from "./context";
import { AINotConfigured } from "./AINotConfigured";

const QUICK = [
  "Что лучше предложить этой компании?",
  "Проанализируй доступную информацию о сайте.",
  "Составь первое персональное сообщение.",
  "Сделай текст короче и естественнее.",
  "Подготовь коммерческое предложение.",
  "Какие вопросы задать потенциальному клиенту?",
  "Помоги ответить на полученное сообщение.",
  "Подготовь план переговоров.",
  "Какие сведения о клиенте ещё нужно проверить?",
];

type Msg = { id: string; role: "user" | "assistant"; content: string };

export function AICopilot({ onClose, prefill }: { onClose: () => void; prefill: { q: string; n: number } | null }) {
  const { clientId, bundle } = useClient();
  const { data, setData } = useApi<{ messages: Msg[] }>(`/api/clients/${clientId}/copilot`);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const messages = data?.messages ?? [];

  useEffect(() => {
    if (prefill) setQ(prefill.q);
  }, [prefill]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, pending]);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setErr(null);
    setPending(question);
    try {
      const r = await api<{ answer: string }>("POST", `/api/clients/${clientId}/copilot`, { question });
      setData((d) => ({
        messages: [...(d?.messages ?? []), { id: `u${Date.now()}`, role: "user", content: question }, { id: `a${Date.now()}`, role: "assistant", content: r.answer }],
      }));
      setQ("");
    } catch (e) {
      // Вопрос остаётся в поле ввода — его можно повторить
      setQ(question);
      setErr(e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 p-3">
        <Bot className="h-4 w-4 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">AI Copilot</p>
          <p className="truncate text-[11px] text-muted">Контекст: {bundle.client.companyName}</p>
        </div>
        <button
          className="rounded p-1 text-muted hover:text-text"
          title="Очистить историю"
          aria-label="Очистить историю Copilot"
          onClick={async () => {
            await api("DELETE", `/api/clients/${clientId}/copilot`).catch(() => {});
            setData({ messages: [] });
          }}
        >
          <Eraser className="h-4 w-4" />
        </button>
        <button className="rounded p-1 text-muted hover:text-text" onClick={onClose} aria-label="Скрыть Copilot">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!bundle.ai.configured && <AINotConfigured />}
        {!messages.length && !pending && (
          <div className="space-y-2">
            <p className="text-xs text-muted">Copilot видит только данные этого клиента. Он советует, но ничего не отправляет и не меняет сам.</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((x) => (
                <button key={x} disabled={!bundle.ai.configured || busy} onClick={() => ask(x)} className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-muted hover:border-accent hover:text-text disabled:opacity-50">
                  {x}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={clsx("whitespace-pre-line rounded-xl p-2.5 text-sm", m.role === "user" ? "ml-6 bg-accent/15" : "mr-2 border border-border/60 bg-surface2/50")}>
            {m.content}
          </div>
        ))}
        {pending && (
          <>
            <div className="ml-6 whitespace-pre-line rounded-xl bg-accent/15 p-2.5 text-sm opacity-70">{pending}</div>
            <div className="mr-2 animate-pulse rounded-xl border border-border/60 bg-surface2/50 p-2.5 text-sm text-muted">Думаю…</div>
          </>
        )}
        <div ref={end} />
      </div>
      {messages.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto border-t border-border/60 px-3 py-2">
          {QUICK.slice(0, 5).map((x) => (
            <button key={x} disabled={!bundle.ai.configured || busy} onClick={() => ask(x)} className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:text-text disabled:opacity-50">
              {x}
            </button>
          ))}
        </div>
      )}
      <form
        className="space-y-2 border-t border-border/60 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <InlineError text={err} />
        <div className="flex gap-2">
          <textarea
            className="input min-h-[42px] flex-1 resize-none"
            rows={2}
            placeholder="Спросите о клиенте…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(q);
              }
            }}
            aria-label="Вопрос Copilot"
          />
          <Button type="submit" variant="primary" loading={busy} disabledReason={!bundle.ai.configured ? "AI не подключён" : !q.trim() ? "Введите вопрос" : undefined} aria-label="Отправить вопрос" icon={<Send className="h-4 w-4" />} />
        </div>
      </form>
    </div>
  );
}

"use client";
import Link from "next/link";
import { PlugZap } from "lucide-react";

export function AINotConfigured() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm" role="status">
      <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
      <div>
        <p className="font-medium text-warn">AI не подключён</p>
        <p className="text-muted">
          Самый простой способ — войти в Claude Code на этом компьютере (выполните <code className="text-text">claude</code> в терминале и войдите в аккаунт): AI будет работать по вашей подписке Claude. Либо задайте{" "}
          <code className="text-text">ANTHROPIC_API_KEY</code> в <code className="text-text">.env</code> и перезапустите приложение. Остальные функции работают без AI.{" "}
          <Link href="/settings" className="text-accent2 hover:underline">
            Настройки
          </Link>
        </p>
      </div>
    </div>
  );
}

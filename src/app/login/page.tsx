"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Crosshair } from "lucide-react";
import { Button, InlineError } from "@/components/ui";
import { api, ApiClientError } from "@/lib/client-api";
import { safeNextPath } from "@/lib/net";

function LoginForm() {
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("POST", "/api/auth/login", { email, password });
      // Полная навигация: серверный layout сразу получает новую cookie сессии
      window.location.assign(safeNextPath(sp.get("next")));
      return;
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-accent p-2 text-on-accent">
          <Crosshair className="h-5 w-5" />
        </div>
        <div>
          <p className="text-lg font-semibold">LEADHUNTER AI</p>
          <p className="text-xs text-muted">Вход в рабочее пространство</p>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="email">
          Логин или email
        </label>
        <input id="email" className="input" type="text" autoCapitalize="none" spellCheck={false} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Пароль
        </label>
        <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <InlineError text={error} />
      <Button type="submit" variant="primary" className="w-full" loading={loading}>
        Войти
      </Button>
      <p className="text-[11px] text-muted">Локальный тестовый пользователь создаётся командой <code>npm run setup</code> — данные входа в <code>.env</code>.</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

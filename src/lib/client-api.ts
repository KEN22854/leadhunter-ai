"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Клиентские обёртки над API: единый разбор ошибок, хук загрузки с перезапросом.

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError(0, "network", typeof navigator !== "undefined" && !navigator.onLine ? "Нет подключения к интернету" : "Сервер недоступен");
  }
  if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiClientError(res.status, e?.code ?? "error", e?.message ?? `Ошибка ${res.status}`, e?.details);
  }
  return json as T;
}

export async function download(url: string, body: unknown, fallbackName: string) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiClientError(res.status, j?.error?.code ?? "error", j?.error?.message ?? "Ошибка экспорта");
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const seq = useRef(0);
  const load = useCallback(
    async (silent = false) => {
      if (!url) return;
      const n = ++seq.current;
      if (!silent) setLoading(true);
      try {
        const d = await api<T>("GET", url);
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (n === seq.current) setError(e instanceof ApiClientError ? e : new ApiClientError(0, "error", String(e)));
      } finally {
        if (n === seq.current) setLoading(false);
      }
    },
    [url],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: () => load(true), setData };
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/** Локальный черновик (переживает перезагрузку и ошибки AI). */
export function useLocalDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw));
    } catch {
      /* недоступно */
    }
    loaded.current = true;
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* недоступно */
    }
  }, [key, value]);
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* недоступно */
    }
  }, [key]);
  return [value, setValue, clear] as const;
}

export const fmtDate = (d: string | Date | null | undefined, withTime = false) =>
  d ? new Date(d).toLocaleString("ru-RU", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "medium" }) : "—";

export const daysAgo = (d: string | Date | null | undefined) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null);

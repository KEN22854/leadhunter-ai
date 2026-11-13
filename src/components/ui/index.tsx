"use client";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Inbox, Loader2, RefreshCw, X } from "lucide-react";
import { forwardRef, useEffect, useId } from "react";
import type { ApiClientError } from "@/lib/client-api";

export { clsx };

// ---------- Button ----------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: React.ReactNode;
  /** Причина недоступности — показывается подсказкой и озвучивается */
  disabledReason?: string;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, disabledReason, className, children, disabled, title, ...rest },
  ref,
) {
  const isDisabled = disabled || loading || Boolean(disabledReason);
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      title={disabledReason ?? title}
      aria-disabled={isDisabled}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-gradient-to-r from-accent to-accent2/90 text-white shadow-lg shadow-accent/20 hover:brightness-110",
        variant === "secondary" && "border border-border bg-surface2/70 text-text hover:border-accent/60 hover:bg-surface2",
        variant === "ghost" && "text-muted hover:bg-surface2 hover:text-text",
        variant === "danger" && "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ---------- Badge ----------
export function Badge({ tone = "neutral", children, className, title }: { tone?: "neutral" | "accent" | "ok" | "warn" | "danger" | "info"; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "border-border bg-surface2 text-muted",
        tone === "accent" && "border-accent/40 bg-accent/15 text-accent",
        tone === "info" && "border-accent2/40 bg-accent2/10 text-accent2",
        tone === "ok" && "border-ok/40 bg-ok/10 text-ok",
        tone === "warn" && "border-warn/40 bg-warn/10 text-warn",
        tone === "danger" && "border-danger/40 bg-danger/10 text-danger",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------- Form fields ----------
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: (id: string) => React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export function Select<T extends string>({
  id,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  id?: string;
  value: T;
  onChange: (v: T) => void;
  options: Record<string, string> | { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  const opts = Array.isArray(options) ? options : Object.entries(options).map(([value, label]) => ({ value, label }));
  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} className={clsx("input", className)}>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------- States ----------
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-surface2", className)} aria-hidden />;
}

export function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card space-y-3" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-3" />
      ))}
    </div>
  );
}

export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-10 text-center">
      <div className="rounded-full bg-surface2 p-3 text-muted">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="font-medium">{title}</p>
      {text && <p className="max-w-md text-sm text-muted">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiClientError | Error | null; onRetry?: () => void }) {
  if (!error) return null;
  const status = "status" in error ? (error as ApiClientError).status : 0;
  return (
    <div className="card flex flex-col items-center gap-2 border-danger/40 py-8 text-center" role="alert">
      <AlertTriangle className="h-6 w-6 text-danger" />
      <p className="font-medium">{status === 404 || status === 403 ? "Нет доступа или данные не найдены" : "Не удалось загрузить данные"}</p>
      <p className="max-w-md text-sm text-muted">{error.message}</p>
      {onRetry && status !== 404 && (
        <Button size="sm" onClick={onRetry} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Повторить
        </Button>
      )}
    </div>
  );
}

export function InlineError({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {text}
    </p>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: React.ReactNode }) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-3 py-2 text-xs",
        tone === "info" && "border-accent2/30 bg-accent2/10 text-accent2",
        tone === "warn" && "border-warn/30 bg-warn/10 text-warn",
        tone === "danger" && "border-danger/30 bg-danger/10 text-danger",
        tone === "ok" && "border-ok/30 bg-ok/10 text-ok",
      )}
    >
      {children}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            onMouseDown={(e) => e.stopPropagation()}
            className={clsx("glass max-h-[92vh] w-full overflow-y-auto rounded-t-2xl p-5 shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{title}</h2>
              <button onClick={onClose} aria-label="Закрыть" className="rounded-md p-1 text-muted hover:bg-surface2 hover:text-text">
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="h-section">{children}</h3>
      {action}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-40 shrink-0 text-xs text-muted">{k}</dt>
      <dd className="min-w-0 break-words text-sm">{v || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

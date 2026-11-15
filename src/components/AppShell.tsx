"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Crosshair, Flame, LogOut, Megaphone, Menu, Moon, Radar, Settings, Sun, Users, WifiOff, X } from "lucide-react";
import { clsx } from "@/components/ui";
import { api, useOnline } from "@/lib/client-api";

const NAV = [
  { href: "/", label: "Лиды", icon: Users },
  { href: "/discover", label: "Поиск лидов", icon: Radar },
  { href: "/signals", label: "Спрос в соцсетях", icon: Flame },
  { href: "/campaigns", label: "Email-кампании", icon: Megaphone },
  { href: "/settings", label: "Настройки", icon: Settings },
];

export function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "dark" | "light") || "dark");
  }, []);
  useEffect(() => {
    setOpen(false);
  }, [path]);

  const toggleTheme = () => {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("lh-theme", t);
    } catch {
      /* недоступно */
    }
  };

  async function logout() {
    await api("POST", "/api/auth/logout").catch(() => {});
    router.replace("/login");
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1" aria-label="Основная навигация">
      {NAV.map((n) => {
        const active = n.href === "/" ? path === "/" || path.startsWith("/clients") : path.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={clsx(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition",
              active ? "bg-accent text-on-accent shadow-[0_6px_20px_-10px_rgb(var(--accent)/0.7)]" : "text-muted hover:bg-surface2 hover:text-text",
            )}
          >
            <n.icon className="h-4 w-4" /> {n.label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <div className="min-w-0 px-1">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted">{user.email}</p>
      </div>
      <div className="flex gap-1">
        <button onClick={toggleTheme} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface2 hover:text-text" aria-label="Переключить тему">
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />} Тема
        </button>
        <button onClick={logout} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface2 hover:text-text">
          <LogOut className="h-3.5 w-3.5" /> Выйти
        </button>
      </div>
    </div>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2 px-1">
      <span className="rounded-lg bg-accent p-1.5 text-on-accent">
        <Crosshair className="h-4 w-4" />
      </span>
      <span className="text-sm font-bold tracking-wide">LEADHUNTER AI</span>
    </Link>
  );

  return (
    <div className="min-h-screen lg:pl-[236px]">
      {/* Desktop sidebar */}
      <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col gap-5 border-y-0 border-l-0 p-4 lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>
      {/* Mobile/tablet top bar */}
      <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-x-0 border-t-0 px-4 lg:hidden">
        {brand}
        <button onClick={() => setOpen(true)} aria-label="Открыть меню" className="rounded-lg p-2 text-muted hover:bg-surface2">
          <Menu className="h-5 w-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="glass absolute inset-y-0 left-0 flex w-64 flex-col gap-5 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              {brand}
              <button onClick={() => setOpen(false)} aria-label="Закрыть меню" className="rounded p-1 text-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}
      {!online && (
        <div className="sticky top-0 z-20 flex items-center justify-center gap-2 bg-warn/15 px-4 py-2 text-xs text-warn" role="status">
          <WifiOff className="h-3.5 w-3.5" /> Нет подключения к сети. Изменения не сохранятся, пока соединение не восстановится; черновики хранятся локально.
        </div>
      )}
      <main>{children}</main>
    </div>
  );
}

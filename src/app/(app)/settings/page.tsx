"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleOff, Plug, Trash2, XCircle } from "lucide-react";
import { Badge, Button, ErrorState, Field, InlineError, Notice, SectionTitle, Select, SkeletonBlock } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, fmtDate, useApi } from "@/lib/client-api";
import { CHANNELS } from "@/lib/domain";

type Profile = Record<
  "displayName" | "companyName" | "description" | "specialization" | "advantages" | "portfolioUrl" | "website" | "signature" | "cases" | "pricingNotes" | "requisites",
  string
>;
const EMPTY: Profile = { displayName: "", companyName: "", description: "", specialization: "", advantages: "", portfolioUrl: "", website: "", signature: "", cases: "", pricingNotes: "", requisites: "" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">Настройки</h1>
        <p className="text-sm text-muted">Профиль исполнителя, подключения и правила обращений</p>
      </div>
      <AIStatus />
      <ProfileForm />
      <Channels />
      <Suppression />
      <Templates />
    </div>
  );
}

function AIStatus() {
  const { data, error, reload } = useApi<{ configured: boolean; model: string; usage30d: { requests: number; inputTokens: number; outputTokens: number; costUsd: number } }>("/api/ai/status");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonBlock rows={2} />;
  return (
    <section className="card space-y-2">
      <SectionTitle>AI (Anthropic Claude)</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {data.configured ? <Badge tone="ok">подключён</Badge> : <Badge tone="warn">не подключено</Badge>}
        <span className="text-muted">модель: {data.model}</span>
      </div>
      {!data.configured && (
        <Notice tone="warn">
          Создайте ключ на console.anthropic.com → API Keys, впишите его в <code>ANTHROPIC_API_KEY</code> в файле <code>.env</code> на сервере и перезапустите приложение. Ключ хранится
          только на сервере и не передаётся в браузер.
        </Notice>
      )}
      <p className="text-xs text-muted">
        За 30 дней: запросов {data.usage30d.requests}, токенов вход/выход {data.usage30d.inputTokens.toLocaleString("ru-RU")} / {data.usage30d.outputTokens.toLocaleString("ru-RU")}, оценка стоимости ≈ $
        {data.usage30d.costUsd.toFixed(2)}
      </p>
    </section>
  );
}

function ProfileForm() {
  const toast = useToast();
  const { data, error, reload } = useApi<{ profile: Profile | null }>("/api/profile");
  const [f, setF] = useState<Profile>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (data) setF({ ...EMPTY, ...Object.fromEntries(Object.entries(data.profile ?? {}).filter(([k]) => k in EMPTY)) });
  }, [data]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonBlock rows={6} />;
  const text = (k: keyof Profile, label: string, hint?: string, rows = 0) => (
    <Field label={label} hint={hint} className={rows ? "sm:col-span-2" : undefined}>
      {(id) => (rows ? <textarea id={id} rows={rows} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <input id={id} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />)}
    </Field>
  );
  return (
    <section className="card">
      <SectionTitle>Профиль исполнителя</SectionTitle>
      <Notice tone="info">ИИ использует о вас только эти факты: всё, что здесь не указано (кейсы, цены, гарантии), в сообщения и КП не попадёт.</Notice>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setErr(null);
          try {
            await api("PUT", "/api/profile", f);
            toast("success", "Профиль сохранён");
          } catch (e) {
            setErr(e instanceof ApiClientError ? e.message : "Ошибка");
          } finally {
            setSaving(false);
          }
        }}
      >
        {text("displayName", "Имя / как представляться")}
        {text("companyName", "Компания / студия")}
        {text("specialization", "Специализация")}
        {text("website", "Сайт")}
        {text("portfolioUrl", "Портфолио (ссылка)")}
        {text("description", "Описание", undefined, 3)}
        {text("advantages", "Преимущества", "Только правдивые и проверяемые утверждения.", 3)}
        {text("cases", "Кейсы, которые разрешено упоминать", "Клиент, задача, результат — только с согласия заказчика.", 4)}
        {text("pricingNotes", "Цены и условия", "Например: «лендинг — от 60 000 ₽, 2–3 недели». Без этого ИИ не называет цены.", 3)}
        {text("signature", "Подпись для сообщений", undefined, 3)}
        {text("requisites", "Реквизиты для КП", undefined, 3)}
        <div className="sm:col-span-2">
          <InlineError text={err} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" loading={saving}>
            Сохранить профиль
          </Button>
        </div>
      </form>
    </section>
  );
}

function Channels() {
  const toast = useToast();
  const { data, error, reload } = useApi<{ channels: { channel: keyof typeof CHANNELS; state: string; detail: string; setupHint: string }[] }>("/api/channels");
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonBlock rows={3} />;
  return (
    <section className="card">
      <SectionTitle>Каналы связи</SectionTitle>
      <ul className="space-y-3">
        {data.channels.map((c) => (
          <li key={c.channel} className="flex flex-wrap items-start gap-3 border-b border-border/50 pb-3 last:border-0 last:pb-0">
            {c.state === "connected" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-ok" /> : c.state === "unavailable" ? <CircleOff className="mt-0.5 h-5 w-5 text-muted" /> : <XCircle className="mt-0.5 h-5 w-5 text-warn" />}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{CHANNELS[c.channel]}</p>
              <p className="text-sm text-muted">{c.detail}</p>
              <p className="mt-1 text-xs text-muted">{c.setupHint}</p>
            </div>
            <Button
              size="sm"
              icon={<Plug className="h-3.5 w-3.5" />}
              loading={busy === c.channel}
              disabledReason={c.state === "connected" ? undefined : c.state === "unavailable" ? "Канал недоступен через API" : "Канал не настроен в .env"}
              onClick={async () => {
                setBusy(c.channel);
                try {
                  const r = await api<{ ok: boolean; detail: string }>("POST", `/api/channels/${c.channel}/verify`);
                  toast(r.ok ? "success" : "error", r.detail);
                } catch (e) {
                  toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Проверить
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Секреты каналов задаются только в переменных окружения сервера (см. .env.example) и не хранятся в браузере или БД.</p>
    </section>
  );
}

function Suppression() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: { id: string; value: string; type: string; reason: string; createdAt: string }[] }>("/api/suppression");
  const [f, setF] = useState({ type: "email", value: "", reason: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="card">
      <SectionTitle>Список запрета обращений (do-not-contact)</SectionTitle>
      <p className="mb-3 text-xs text-muted">Проверяется перед подготовкой и отправкой каждого сообщения. Домен (например, @company.ru) блокирует все адреса домена.</p>
      <form
        className="mb-3 grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await api("POST", "/api/suppression", f);
            setF({ ...f, value: "", reason: "" });
            await reload();
            toast("success", "Добавлено в список запрета");
          } catch (e) {
            setErr(e instanceof ApiClientError ? e.message : "Ошибка");
          }
        }}
      >
        <Field label="Тип">
          {(id) => <Select id={id} value={f.type} onChange={(v) => setF({ ...f, type: v })} options={{ email: "Email", phone: "Телефон", telegram: "Telegram", whatsapp: "WhatsApp", domain: "Домен", other: "Другое" }} />}
        </Field>
        <Field label="Значение">{(id) => <input id={id} className="input" required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>
        <Field label="Причина">{(id) => <input id={id} className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        <Button type="submit">Добавить</Button>
      </form>
      <InlineError text={err} />
      {data?.items.length ? (
        <ul className="divide-y divide-border/50 text-sm">
          {data.items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <Badge>{s.type}</Badge>
              <span className="font-medium">{s.value}</span>
              <span className="flex-1 text-xs text-muted">{s.reason}</span>
              <span className="text-xs text-muted">{fmtDate(s.createdAt)}</span>
              <button
                className="text-muted hover:text-danger"
                aria-label={`Удалить ${s.value} из списка запрета`}
                onClick={async () => {
                  await api("DELETE", `/api/suppression?id=${s.id}`).catch(() => {});
                  await reload();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Список пуст.</p>
      )}
    </section>
  );
}

function Templates() {
  const { data, reload } = useApi<{ items: { id: string; name: string; category: string; channel: string; subject: string; content: string; createdAt: string }[] }>("/api/templates");
  return (
    <section className="card">
      <SectionTitle>Шаблоны сообщений</SectionTitle>
      {data?.items.length ? (
        <ul className="space-y-2">
          {data.items.map((t) => (
            <li key={t.id} className="rounded-lg border border-border/60 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.name}</span>
                <Badge>{CHANNELS[t.channel as keyof typeof CHANNELS] ?? t.channel}</Badge>
                {t.category && <Badge tone="info">{t.category}</Badge>}
                <button
                  className="ml-auto text-muted hover:text-danger"
                  aria-label={`Удалить шаблон ${t.name}`}
                  onClick={async () => {
                    await api("DELETE", `/api/templates?id=${t.id}`).catch(() => {});
                    await reload();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-muted">{t.content}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Шаблонов нет. Сохраните сообщение как шаблон в AI Message Studio.</p>
      )}
    </section>
  );
}

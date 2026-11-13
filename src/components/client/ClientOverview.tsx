"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarCheck, CheckCircle2, Download, HelpCircle, Lightbulb, Pencil, ShieldOff, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Field, InlineError, KV, Modal, Notice, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, daysAgo, fmtDate } from "@/lib/client-api";
import { CONTACT_TYPES, SERVICES, STALE_DAYS, TASK_KINDS, VERIFICATION_STATUSES } from "@/lib/domain";
import { useClient } from "./context";
import { LeadScorePanel } from "./LeadScorePanel";
import { verificationTone } from "./ClientContacts";

export function ClientOverview() {
  const { bundle, clientId, reloadBundle, goTab, openTask } = useClient();
  const { client, analysis } = bundle;
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const age = daysAgo(client.lastCheckedAt);
  const stale = age === null || age > STALE_DAYS;

  async function patch(data: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      await api("PATCH", `/api/clients/${clientId}`, data);
      toast("success", ok);
      await reloadBundle();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      {/* Профиль */}
      <section className="card">
        <SectionTitle action={<Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>Изменить</Button>}>Профиль компании</SectionTitle>
        <dl className="space-y-2">
          <KV k="Название" v={client.companyName} />
          <KV k="Описание" v={client.description && <span className="whitespace-pre-line">{client.description}</span>} />
          <KV k="Категория" v={client.category} />
          <KV k="Отрасль" v={client.industry} />
          <KV k="География" v={[client.country, client.region, client.city].filter(Boolean).join(", ")} />
          <KV k="Сайт" v={client.website} />
          <KV k="Язык клиента" v={client.language} />
          <KV k="Обнаружен" v={fmtDate(client.firstSeenAt)} />
          <KV
            k="Последняя проверка"
            v={
              <span className="flex flex-wrap items-center gap-2">
                {fmtDate(client.lastCheckedAt)}
                {stale && <Badge tone="warn">{client.lastCheckedAt ? `данные старше ${STALE_DAYS} дн.` : "не проверялось"}</Badge>}
                <Button size="sm" variant="ghost" icon={<CalendarCheck className="h-3.5 w-3.5" />} loading={busy} onClick={() => patch({ markChecked: true }, "Отмечено как проверенное")}>
                  Отметить проверенным
                </Button>
              </span>
            }
          />
          <KV k="Источников" v={<button className="text-accent2 hover:underline" onClick={() => goTab("sources")}>{client._count.sources}</button>} />
        </dl>
      </section>

      {/* Lead Score */}
      <section className="card">
        <SectionTitle>Lead Score</SectionTitle>
        <LeadScorePanel compact />
      </section>

      {/* AI-вывод и возможности */}
      <section className="card 2xl:col-span-2">
        <SectionTitle
          action={
            <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => goTab("analysis")}>
              {analysis ? "Открыть анализ" : "Запустить AI-анализ"}
            </Button>
          }
        >
          Возможности сотрудничества
        </SectionTitle>
        {!analysis ? (
          <p className="text-sm text-muted">AI-анализ ещё не проводился. Он оценит публичные данные и сайт, отделит факты от гипотез и предложит релевантные услуги.</p>
        ) : (
          <div className="space-y-4">
            {analysis.findings.insufficientData && <Notice tone="warn">ИИ сообщил, что данных недостаточно для уверенных выводов.</Notice>}
            <p className="text-sm">{analysis.summary}</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                  <Lightbulb className="h-3.5 w-3.5" /> Релевантные услуги
                </p>
                <ul className="space-y-2">
                  {analysis.recommendations.map((r, i) => (
                    <li key={i} className="rounded-lg border border-border/60 bg-surface2/40 p-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{SERVICES[r.service as keyof typeof SERVICES] ?? r.service}</span>
                        <Badge tone={r.isHypothesis ? "warn" : "ok"}>{r.isHypothesis ? "гипотеза" : "по данным"}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">{r.rationale}</p>
                    </li>
                  ))}
                  {!analysis.recommendations.length && <li className="text-sm text-muted">Нет рекомендаций.</li>}
                </ul>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted">Обнаруженные признаки</p>
                  <ul className="space-y-1.5 text-sm">
                    {analysis.findings.needSignals.map((s, i) => (
                      <li key={i} className="flex items-start gap-2">
                        {s.confirmed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
                        <span>
                          {s.signal} <span className="text-xs text-muted">{s.confirmed ? "(подтверждено источником)" : "(гипотеза)"}</span>
                        </span>
                      </li>
                    ))}
                    {!analysis.findings.needSignals.length && <li className="text-muted">Публичных признаков не обнаружено.</li>}
                  </ul>
                </div>
                {analysis.findings.questionsToVerify.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                      <AlertTriangle className="h-3.5 w-3.5" /> Проверить вручную
                    </p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {analysis.findings.questionsToVerify.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
            {analysis.findings.nextStep && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm">
                <span className="flex-1">
                  <b>Рекомендуемый шаг:</b> {analysis.findings.nextStep}
                </span>
                <Button size="sm" onClick={() => openTask({ title: analysis.findings.nextStep.slice(0, 280), source: "ai", description: "Создано из AI-рекомендации" })}>
                  Создать задачу
                </Button>
              </div>
            )}
            <p className="text-[11px] text-muted">
              Анализ от {fmtDate(analysis.createdAt, true)} · {analysis.model} · {analysis.promptVersion}
            </p>
          </div>
        )}
      </section>

      {/* Контакты */}
      <section className="card">
        <SectionTitle action={<Button size="sm" variant="ghost" onClick={() => goTab("contacts")}>Все контакты</Button>}>Контакты</SectionTitle>
        {client.contacts.length ? (
          <ul className="space-y-2">
            {client.contacts.slice(0, 6).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>{CONTACT_TYPES[c.type as keyof typeof CONTACT_TYPES] ?? c.type}</Badge>
                <span className="min-w-0 flex-1 break-all">{c.value}</span>
                <Badge tone={verificationTone(c.verificationStatus)}>{VERIFICATION_STATUSES[c.verificationStatus as keyof typeof VERIFICATION_STATUSES]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Контактов нет. Добавьте их во вкладке «Контакты».</p>
        )}
      </section>

      {/* Следующие действия */}
      <section className="card">
        <SectionTitle action={<Button size="sm" variant="ghost" onClick={() => goTab("tasks")}>Все задачи</Button>}>Следующие действия</SectionTitle>
        {client.tasks.length ? (
          <ul className="space-y-2 text-sm">
            {client.tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <Badge tone={t.dueAt && new Date(t.dueAt) < new Date() ? "danger" : "neutral"}>{t.dueAt ? fmtDate(t.dueAt, true) : "без срока"}</Badge>
                <span className="flex-1">{t.title}</span>
                <span className="text-xs text-muted">{TASK_KINDS[t.kind as keyof typeof TASK_KINDS]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted">Открытых задач нет.</p>
            <Button size="sm" onClick={() => openTask()}>Добавить задачу</Button>
          </div>
        )}
      </section>

      <PrivacySection />
      <EditClientModal open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}

function PrivacySection() {
  const { bundle, clientId, reloadBundle } = useClient();
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [suppress, setSuppress] = useState(true);
  const [busy, setBusy] = useState(false);
  const c = bundle.client;
  return (
    <section className="card 2xl:col-span-2">
      <SectionTitle>Данные и обращения</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={c.doNotContact ? "danger" : "secondary"}
          icon={<ShieldOff className="h-3.5 w-3.5" />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("PATCH", `/api/clients/${clientId}`, { doNotContact: !c.doNotContact });
              await reloadBundle();
            } catch (e) {
              toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
            } finally {
              setBusy(false);
            }
          }}
        >
          {c.doNotContact ? "Снять «Не связываться»" : "Не связываться с клиентом"}
        </Button>
        <a href={`/api/clients/${clientId}/export`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface2/70 px-2.5 text-xs font-medium hover:border-accent/60">
          <Download className="h-3.5 w-3.5" /> Экспорт данных (JSON)
        </a>
        <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirm(true)}>
          Удалить данные клиента
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">Экспорт и удаление — для запросов субъекта данных (152-ФЗ, GDPR). Отметка «Не связываться» блокирует подготовку и отправку сообщений.</p>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Удалить все данные клиента?">
        <p className="text-sm text-muted">Будут удалены карточка, контакты, источники, анализы, сообщения, переписка, задачи и КП. Действие необратимо.</p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={suppress} onChange={(e) => setSuppress(e.target.checked)} /> Внести контакты в список запрета обращений (чтобы не обработать их повторно)
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("DELETE", `/api/clients/${clientId}?suppress=${suppress ? 1 : 0}`);
                toast("success", "Данные клиента удалены");
                router.replace("/");
              } catch (e) {
                toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
                setBusy(false);
              }
            }}
          >
            Удалить безвозвратно
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function EditClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bundle, clientId, reloadBundle } = useClient();
  const toast = useToast();
  const c = bundle.client;
  const [f, setF] = useState({
    companyName: c.companyName,
    description: c.description,
    category: c.category,
    industry: c.industry,
    country: c.country,
    region: c.region,
    city: c.city,
    website: c.website,
    logoUrl: c.logoUrl,
    language: c.language,
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Профиль компании" wide>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setErr(null);
          try {
            await api("PATCH", `/api/clients/${clientId}`, f);
            toast("success", "Профиль сохранён");
            await reloadBundle();
            onClose();
          } catch (e) {
            setErr(e instanceof ApiClientError ? e.message : "Ошибка");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Название *" className="sm:col-span-2">{(id) => <input id={id} className="input" required value={f.companyName} onChange={set("companyName")} />}</Field>
        <Field label="Описание" className="sm:col-span-2">{(id) => <textarea id={id} rows={4} className="input" value={f.description} onChange={set("description")} />}</Field>
        <Field label="Категория">{(id) => <input id={id} className="input" value={f.category} onChange={set("category")} />}</Field>
        <Field label="Отрасль">{(id) => <input id={id} className="input" value={f.industry} onChange={set("industry")} />}</Field>
        <Field label="Страна">{(id) => <input id={id} className="input" value={f.country} onChange={set("country")} />}</Field>
        <Field label="Регион">{(id) => <input id={id} className="input" value={f.region} onChange={set("region")} />}</Field>
        <Field label="Город">{(id) => <input id={id} className="input" value={f.city} onChange={set("city")} />}</Field>
        <Field label="Язык клиента (ru, en, de…)">{(id) => <input id={id} className="input" value={f.language} onChange={set("language")} />}</Field>
        <Field label="Сайт">{(id) => <input id={id} className="input" value={f.website} onChange={set("website")} />}</Field>
        <Field label="Логотип (https-ссылка из разрешённого источника)">{(id) => <input id={id} className="input" value={f.logoUrl} onChange={set("logoUrl")} />}</Field>
        <div className="sm:col-span-2">
          <InlineError text={err} />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

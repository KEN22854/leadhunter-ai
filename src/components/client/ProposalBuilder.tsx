"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, FileDown, FilePlus2, History, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Field, InlineError, Modal, Notice, Select, SkeletonBlock, clsx } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, download, fmtDate, useApi } from "@/lib/client-api";
import { PROPOSAL_BLOCKS, PROPOSAL_STATUSES, SERVICES } from "@/lib/domain";
import { useClient } from "./context";

type Block = { key: string; title?: string; body: string };
type Proposal = {
  id: string;
  title: string;
  service: string;
  status: keyof typeof PROPOSAL_STATUSES;
  version: number;
  content: { blocks: Block[] };
  updatedAt: string;
  versions: { id: string; version: number; createdAt: string; title: string }[];
};

const titleOf = (b: Block) => b.title || PROPOSAL_BLOCKS.find((x) => x.key === b.key)?.title || b.key;

export function ProposalBuilder() {
  const { clientId, bundle } = useClient();
  const { data, error, loading, reload } = useApi<{ proposals: Proposal[] }>(`/api/clients/${clientId}/proposals`);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | "blank" | "ai">(null);
  if (loading && !data) return <SkeletonBlock rows={5} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const list = data!.proposals;
  const active = list.find((p) => p.id === activeId) ?? list[0];

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted">КП создаётся на основе карточки и выбранной услуги. Стоимость, сроки и гарантии берутся только из ваших данных.</p>
        <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => setCreating("blank")}>
          Пустое КП
        </Button>
        <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} disabledReason={bundle.ai.configured ? undefined : "AI не подключён"} onClick={() => setCreating("ai")}>
          Черновик с AI
        </Button>
      </div>
      {!list.length ? (
        <EmptyState title="Коммерческих предложений нет" text="Создайте КП с нуля или подготовьте черновик с AI." />
      ) : (
        <>
          {list.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {list.map((p) => (
                <button key={p.id} onClick={() => setActiveId(p.id)} className={clsx("rounded-full border px-3 py-1 text-xs", p.id === active?.id ? "border-accent bg-accent/15" : "border-border text-muted")}>
                  {p.title} · v{p.version}
                </button>
              ))}
            </div>
          )}
          {active && <ProposalEditor key={`${active.id}:${active.version}`} proposal={active} onChanged={reload} />}
        </>
      )}
      <CreateProposalModal
        mode={creating}
        onClose={() => setCreating(null)}
        onCreated={async (id) => {
          setCreating(null);
          await reload();
          setActiveId(id);
        }}
      />
    </div>
  );
}

function ProposalEditor({ proposal, onChanged }: { proposal: Proposal; onChanged: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(proposal.title);
  const [blocks, setBlocks] = useState<Block[]>(proposal.content.blocks ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = title !== proposal.title || JSON.stringify(blocks) !== JSON.stringify(proposal.content.blocks ?? []);
  const placeholders = blocks.filter((b) => /\[указать[^\]]*\]/i.test(b.body)).map(titleOf);

  async function patch(body: Record<string, unknown>, ok: string, key: string) {
    setBusy(key);
    try {
      await api("PATCH", `/api/proposals/${proposal.id}`, body);
      toast("success", ok);
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const b = [...blocks];
    [b[i], b[j]] = [b[j], b[i]];
    setBlocks(b);
  };

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Название КП" className="min-w-[240px] flex-1">
          {(id) => <input id={id} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Статус">
          {(id) => <Select id={id} value={proposal.status} onChange={(v) => patch({ status: v }, "Статус обновлён", "status")} options={PROPOSAL_STATUSES} />}
        </Field>
        <div className="flex items-center gap-2 pb-1 text-xs text-muted">
          <Badge>v{proposal.version}</Badge> {SERVICES[proposal.service as keyof typeof SERVICES] ?? proposal.service} · {fmtDate(proposal.updatedAt, true)}
        </div>
      </div>
      {placeholders.length > 0 && <Notice tone="warn">Заполните плейсхолдеры «[указать …]» в блоках: {placeholders.join(", ")}.</Notice>}
      <ol className="space-y-3">
        {blocks.map((b, i) => (
          <li key={i} className="rounded-lg border border-border/60 bg-surface2/30 p-3">
            <div className="mb-2 flex items-center gap-2">
              <input
                className="input h-8 flex-1 py-1 font-medium"
                value={titleOf(b)}
                aria-label="Заголовок блока"
                onChange={(e) => setBlocks(blocks.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))}
              />
              <button className="rounded p-1 text-muted hover:text-text disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Вверх">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button className="rounded p-1 text-muted hover:text-text disabled:opacity-30" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label="Вниз">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button className="rounded p-1 text-muted hover:text-danger" onClick={() => setBlocks(blocks.filter((_, k) => k !== i))} aria-label="Удалить блок">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <textarea className="input min-h-[90px]" value={b.body} aria-label={titleOf(b)} onChange={(e) => setBlocks(blocks.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)))} />
          </li>
        ))}
      </ol>
      <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setBlocks([...blocks, { key: `custom_${Date.now()}`, title: "Новый блок", body: "" }])}>
        Добавить блок
      </Button>
      <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
        <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={busy === "save"} disabledReason={dirty ? undefined : "Нет изменений"} onClick={() => patch({ title, blocks }, "Сохранена новая версия КП", "save")}>
          Сохранить версию
        </Button>
        <Button icon={<History className="h-4 w-4" />} onClick={() => setVersionsOpen(true)}>
          Версии ({proposal.versions.length})
        </Button>
        {(["pdf", "docx"] as const).map((fmt) => (
          <Button
            key={fmt}
            icon={<FileDown className="h-4 w-4" />}
            loading={busy === fmt}
            disabledReason={dirty ? "Сначала сохраните изменения" : undefined}
            onClick={async () => {
              setBusy(fmt);
              try {
                await download(`/api/proposals/${proposal.id}/export`, { format: fmt }, `proposal.${fmt}`);
              } catch (e) {
                toast("error", e instanceof ApiClientError ? e.message : "Ошибка экспорта");
              } finally {
                setBusy(null);
              }
            }}
          >
            {fmt.toUpperCase()}
          </Button>
        ))}
        <Button variant="ghost" className="sm:ml-auto" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>
          Удалить
        </Button>
      </div>
      <Modal open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Версии КП">
        <ul className="space-y-1.5">
          {proposal.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                v{v.version} · {v.title} <span className="text-xs text-muted">{fmtDate(v.createdAt, true)}</span>
              </span>
              <Button
                size="sm"
                disabledReason={v.version === proposal.version ? "Текущая версия" : undefined}
                onClick={() => {
                  setVersionsOpen(false);
                  void patch({ restoreVersion: v.version }, `Восстановлена v${v.version}`, "restore");
                }}
              >
                Восстановить
              </Button>
            </li>
          ))}
        </ul>
      </Modal>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Удалить КП?">
        <p className="text-sm text-muted">«{proposal.title}» и все его версии будут удалены.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              setConfirmDelete(false);
              try {
                await api("DELETE", `/api/proposals/${proposal.id}`);
                toast("success", "КП удалено");
                onChanged();
              } catch (e) {
                toast("error", e instanceof ApiClientError ? e.message : "Ошибка");
              }
            }}
          >
            Удалить
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function CreateProposalModal({ mode, onClose, onCreated }: { mode: null | "blank" | "ai"; onClose: () => void; onCreated: (id: string) => void }) {
  const { clientId, bundle } = useClient();
  const toast = useToast();
  const [service, setService] = useState<keyof typeof SERVICES>("website");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<{ title: string; blocks: { key: string; body: string }[]; missingInputs: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (mode) {
      setDraft(null);
      setErr(null);
      setTitle(`Коммерческое предложение для ${bundle.client.companyName}`.slice(0, 300));
    }
  }, [mode, bundle.client.companyName]);

  async function create(blocks?: Block[], t?: string) {
    setBusy("create");
    setErr(null);
    try {
      const r = await api<{ proposal: { id: string } }>("POST", `/api/clients/${clientId}/proposals`, { title: t ?? title, service, blocks });
      toast("success", "КП создано");
      onCreated(r.proposal.id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={mode !== null} onClose={onClose} title={mode === "ai" ? "Черновик КП с AI" : "Новое КП"} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Услуга">{(id) => <Select id={id} value={service} onChange={setService} options={SERVICES} />}</Field>
          <Field label="Название">{(id) => <input id={id} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        </div>
        {mode === "ai" && (
          <>
            <Field label="Ваши вводные: стоимость, сроки, условия, акценты" hint="ИИ использует только эти данные и данные профиля. Без них в блоках будут плейсхолдеры «[указать …]».">
              {(id) => <textarea id={id} rows={3} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
            <Button
              loading={busy === "ai"}
              icon={<Sparkles className="h-4 w-4" />}
              onClick={async () => {
                setBusy("ai");
                setErr(null);
                try {
                  const r = await api<{ draft: { title: string; blocks: { key: string; body: string }[]; missingInputs: string[] } }>("POST", `/api/clients/${clientId}/proposals/draft`, { service, notes });
                  setDraft(r.draft);
                } catch (e) {
                  setErr(e instanceof ApiClientError ? `${e.message} Вводные сохранены в форме.` : "Ошибка");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {draft ? "Сгенерировать заново" : "Подготовить черновик"}
            </Button>
            {draft && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="font-medium">{draft.title}</p>
                {draft.missingInputs.length > 0 && <Notice tone="warn">Нужно заполнить: {draft.missingInputs.join("; ")}</Notice>}
                {draft.blocks.map((b, i) => (
                  <div key={i}>
                    <p className="text-xs font-semibold text-muted">{PROPOSAL_BLOCKS.find((x) => x.key === b.key)?.title ?? b.key}</p>
                    <p className="whitespace-pre-line text-sm">{b.body}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          {mode === "blank" ? (
            <Button variant="primary" loading={busy === "create"} disabledReason={title.trim() ? undefined : "Введите название"} onClick={() => create()}>
              Создать
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy === "create"}
              disabledReason={draft ? undefined : "Сначала подготовьте черновик"}
              onClick={() => draft && create(draft.blocks.map((b) => ({ key: b.key, body: b.body })), draft.title || title)}
            >
              Создать КП из черновика
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

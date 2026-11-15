"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bot } from "lucide-react";
import { ErrorState, Skeleton, SkeletonBlock, clsx } from "@/components/ui";
import { useApi } from "@/lib/client-api";
import { ClientCtx } from "./context";
import { ClientHeader } from "./ClientHeader";
import { ClientOverview } from "./ClientOverview";
import { ClientContacts } from "./ClientContacts";
import { AIAnalysisPanel } from "./AIAnalysisPanel";
import { ReferencePanel } from "./ReferencePanel";
import { AIMessageStudio } from "./studio/AIMessageStudio";
import { CommunicationHub } from "./CommunicationHub";
import { ProposalBuilder } from "./ProposalBuilder";
import { ClientTasks, TaskModal } from "./ClientTasks";
import { ClientSources } from "./ClientSources";
import { ClientTimeline } from "./ClientTimeline";
import { AICopilot } from "./AICopilot";
import type { Bundle, TabKey } from "./types";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Обзор" },
  { key: "contacts", label: "Контакты" },
  { key: "analysis", label: "AI-анализ" },
  { key: "reference", label: "Референс" },
  { key: "messages", label: "AI-сообщения" },
  { key: "conversations", label: "Переписка" },
  { key: "proposals", label: "Предложения" },
  { key: "tasks", label: "Задачи" },
  { key: "sources", label: "Источники" },
  { key: "history", label: "История" },
];

export function ClientProfile({ clientId }: { clientId: string }) {
  return (
    <Suspense fallback={<div className="p-6"><SkeletonBlock /></div>}>
      <ClientProfileInner clientId={clientId} />
    </Suspense>
  );
}

function ClientProfileInner({ clientId }: { clientId: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const tab = (TABS.find((t) => t.key === sp.get("tab"))?.key ?? "overview") as TabKey;
  const { data, error, loading, reload } = useApi<Bundle>(`/api/clients/${clientId}`);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [mobileCopilot, setMobileCopilot] = useState(false);
  const [copilotPrefill, setCopilotPrefill] = useState<{ q: string; n: number } | null>(null);
  const [taskModal, setTaskModal] = useState<{ title?: string; description?: string; source?: "manual" | "ai" } | null>(null);
  const [taskRefresh, setTaskRefresh] = useState(0);

  // На узких экранах держим активную вкладку в зоне видимости
  useEffect(() => {
    document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab, data]);

  const goTab = useCallback(
    (t: TabKey) => {
      const p = new URLSearchParams(sp.toString());
      p.set("tab", t);
      router.replace(`${path}?${p.toString()}`, { scroll: false });
    },
    [path, router, sp],
  );

  const ctx = useMemo(
    () =>
      data
        ? {
            clientId,
            bundle: data,
            reloadBundle: reload,
            goTab,
            openTask: (prefill?: { title?: string; description?: string; source?: "manual" | "ai" }) => setTaskModal(prefill ?? {}),
            askCopilot: (q: string) => {
              setCopilotPrefill({ q, n: Date.now() });
              setCopilotOpen(true);
              if (window.innerWidth < 1280) setMobileCopilot(true);
            },
          }
        : null,
    [clientId, data, reload, goTab],
  );

  if (loading && !data)
    return (
      <div className="space-y-4 p-4 sm:p-6" aria-busy="true">
        <div className="card flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <SkeletonBlock rows={5} />
      </div>
    );
  if (error || !ctx) return <div className="p-4 sm:p-6"><ErrorState error={error} onRetry={reload} /></div>;

  return (
    <ClientCtx.Provider value={ctx}>
      <div className={clsx("grid min-h-screen", copilotOpen ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "xl:grid-cols-[minmax(0,1fr)]")}>
        <div className="min-w-0 space-y-4 p-4 sm:p-6">
          <ClientHeader />
          <div className="sticky top-14 z-20 -mx-4 overflow-x-auto bg-bg/80 px-4 backdrop-blur lg:top-0 sm:-mx-6 sm:px-6">
            <div role="tablist" aria-label="Разделы карточки" className="flex gap-1 border-b border-border/70 py-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => goTab(t.key)}
                  className={clsx(
                    "whitespace-nowrap rounded-lg px-3 py-2 text-sm transition",
                    tab === t.key ? "bg-accent/15 font-medium text-text" : "text-muted hover:bg-surface2 hover:text-text",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={tab} role="tabpanel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {tab === "overview" && <ClientOverview />}
              {tab === "contacts" && <ClientContacts />}
              {tab === "analysis" && <AIAnalysisPanel />}
              {tab === "reference" && <ReferencePanel />}
              {tab === "messages" && <AIMessageStudio />}
              {tab === "conversations" && <CommunicationHub />}
              {tab === "proposals" && <ProposalBuilder />}
              {tab === "tasks" && <ClientTasks refreshKey={taskRefresh} />}
              {tab === "sources" && <ClientSources />}
              {tab === "history" && <ClientTimeline />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Copilot: закреплённая панель на desktop */}
        {copilotOpen && (
          <aside className="glass sticky top-0 hidden h-screen border-y-0 border-r-0 xl:block">
            <AICopilot onClose={() => setCopilotOpen(false)} prefill={copilotPrefill} />
          </aside>
        )}
      </div>

      {/* Кнопка Copilot: на desktop — вернуть скрытую панель, на мобильных — открыть выдвижную */}
      <button
        onClick={() => (window.innerWidth >= 1280 ? setCopilotOpen(true) : setMobileCopilot(true))}
        className={clsx(
          "fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-accent text-on-accent px-4 py-3 text-sm font-medium shadow-xl shadow-black/40",
          copilotOpen && "xl:hidden",
        )}
        aria-label="Открыть AI Copilot"
      >
        <Bot className="h-4 w-4" /> Copilot
      </button>
      <AnimatePresence>
        {mobileCopilot && (
          <motion.div className="fixed inset-0 z-50 bg-black/60 xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileCopilot(false)}>
            <motion.aside
              className="glass absolute inset-y-0 right-0 w-full max-w-md"
              initial={{ x: 40 }}
              animate={{ x: 0 }}
              exit={{ x: 40 }}
              onClick={(e) => e.stopPropagation()}
            >
              <AICopilot onClose={() => setMobileCopilot(false)} prefill={copilotPrefill} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <TaskModal
        open={taskModal !== null}
        prefill={taskModal ?? {}}
        onClose={() => setTaskModal(null)}
        onSaved={() => {
          setTaskModal(null);
          setTaskRefresh((n) => n + 1);
          void reload();
        }}
      />
    </ClientCtx.Provider>
  );
}

"use client";
import { createContext, useContext } from "react";
import type { Bundle, TabKey } from "./types";

export type ClientCtxValue = {
  clientId: string;
  bundle: Bundle;
  reloadBundle: () => Promise<void> | void;
  goTab: (t: TabKey) => void;
  openTask: (prefill?: { title?: string; description?: string; source?: "manual" | "ai" }) => void;
  askCopilot: (q: string) => void;
};

export const ClientCtx = createContext<ClientCtxValue | null>(null);
export function useClient() {
  const c = useContext(ClientCtx);
  if (!c) throw new Error("ClientCtx missing");
  return c;
}

// Типы данных, которые UI получает от API карточки клиента.
import type { ScoreFactor } from "@/lib/score";

export type Contact = {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
  label: string;
  sourceId: string | null;
  verificationStatus: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  discoveredAt: string;
  doNotContact: boolean;
  source?: { id: string; sourceUrl: string; title: string; sourceType: string } | null;
};

export type Client = {
  id: string;
  companyName: string;
  description: string;
  category: string;
  industry: string;
  country: string;
  region: string;
  city: string;
  website: string;
  logoUrl: string;
  language: string;
  status: string;
  priority: string;
  archived: boolean;
  doNotContact: boolean;
  firstSeenAt: string;
  lastCheckedAt: string | null;
  updatedAt: string;
  externalId: string;
  siteAudit: import("@/lib/discovery/audit").SiteAudit | null;
  siteAuditScore: number | null;
  siteAuditAt: string | null;
  workspacePath: string;
  contacts: Contact[];
  tasks: Task[];
  _count: { sources: number; messages: number; proposals: number; conversations: number };
};

export type Score = { id: string; score: number; factors: ScoreFactor[]; explanation: string; calculatedAt: string };

export type Analysis = {
  id: string;
  summary: string;
  findings: {
    insufficientData: boolean;
    audienceAndProducts: string;
    siteReview: { observed: boolean; structure: string; visual: string; ux: string; content: string };
    needSignals: { signal: string; sourceRef: string; sourceId: string; confirmed: boolean }[];
    gaps: string[];
    questionsToVerify: string[];
    nextStep: string;
    fetchErrors: { url: string; error: string }[];
  };
  recommendations: { service: string; rationale: string; arguments: string[]; isHypothesis: boolean }[];
  risks: string[];
  sources: { sourceRef: string; sourceId: string; claims: string[] }[];
  confidence: string;
  model: string;
  promptVersion: string;
  pagesAnalyzed: string[];
  createdAt: string;
};

export type Bundle = {
  client: Client;
  score: Score | null;
  analysis: Analysis | null;
  conflicts: number;
  ai: { configured: boolean; model: string | null; backend: "anthropic" | "claude-code" | null };
};

export type Task = {
  id: string;
  title: string;
  description: string;
  dueAt: string | null;
  priority: string;
  status: string;
  kind: string;
  source: string;
  createdAt: string;
};

export type AIMessage = {
  id: string;
  generationId: string;
  variantKey: string;
  label: string;
  channel: string;
  language: string;
  tone: string;
  goal: string;
  service: string;
  length: string;
  subject: string;
  body: string;
  personalization: { claim: string; sourceId: string; sourceDbId?: string; confidence: string }[];
  assumptions: string[];
  warnings: string[];
  evidence: { serviceRationale: string; toVerify: string[] } | null;
  status: string;
  version: number;
  contactId: string | null;
  model: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
};

export type Source = {
  id: string;
  sourceType: string;
  sourceUrl: string;
  title: string;
  method: string;
  capturedAt: string;
  checkedAt: string | null;
  evidence: string;
  rawReference: string;
};

export type TabKey = "overview" | "contacts" | "analysis" | "reference" | "messages" | "conversations" | "proposals" | "tasks" | "sources" | "history";

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "warn" | "accent" }> = {
  draft: { label: "Черновик", tone: "neutral" },
  running: { label: "Идёт отправка", tone: "ok" },
  paused: { label: "На паузе", tone: "warn" },
  done: { label: "Завершена", tone: "accent" },
};

export const ITEM_TONE: Record<string, "neutral" | "ok" | "warn" | "danger" | "info" | "accent"> = {
  draft: "warn",
  ready: "info",
  queued: "accent",
  sending: "accent",
  sent: "ok",
  failed: "danger",
  skipped: "neutral",
  replied: "ok",
  opted_out: "danger",
};

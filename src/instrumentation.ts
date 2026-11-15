// Запуск фонового планировщика (обогащение лидов, отправка кампаний, входящая почта) при старте сервера.
// Условие записано прямо в if: так Next.js вырезает серверный код из edge-сборки.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    // Настройки подключений из БД (Настройки → Подключения) применяются до старта фоновых задач
    const { applyStoredSettings } = await import("./lib/settings-store");
    await applyStoredSettings().catch((e) => console.error("[settings] load failed", e));
    const { startScheduler } = await import("./lib/jobs/scheduler");
    startScheduler();
  }
}

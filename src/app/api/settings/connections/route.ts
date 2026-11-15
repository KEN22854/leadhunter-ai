import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/timeline";
import { isSettingKey, saveSettings, settingsView } from "@/lib/settings-store";

export const runtime = "nodejs";

export const GET = handler(async () => {
  await requireAdmin();
  return settingsView();
});

/** { values: { SMTP_HOST: "smtp.yandex.ru", SMTP_PASS: "..." } } — ключ без значения не меняется, "" очищает */
export const PUT = handler(async (req) => {
  const user = await requireAdmin();
  const b = await parseBody(req, z.object({ values: z.record(z.string(), z.string().max(4000)) }));
  const bad = Object.keys(b.values).filter((k) => !isSettingKey(k));
  if (bad.length) throw new ApiError(400, "unknown_setting", `Неизвестные настройки: ${bad.join(", ")}`);
  await saveSettings(b.values);
  // В журнал — только имена изменённых настроек, без значений
  await audit(user.id, "settings.connections", "AppState", "cfg", { keys: Object.keys(b.values) });
  return settingsView();
});

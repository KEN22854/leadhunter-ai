// Сетевые хелперы без зависимостей от сервера (используются и в тестах, и в клиенте).

/**
 * IP клиента для лимитов. X-Forwarded-For подделывается клиентом, поэтому ему доверяем только
 * за своим обратным прокси (TRUST_PROXY=1). Иначе — общий ключ "direct" (локальный режим).
 */
export function clientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY === "1") {
    const xff = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
    // Берём адрес, добавленный последним (нашим) прокси — его клиент подделать не может
    const ip = xff?.[xff.length - 1] || headers.get("x-real-ip");
    if (ip) return ip;
  }
  return "direct";
}

/** Безопасный путь для редиректа после входа: только относительный путь этого же сайта. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/";
  // Запрещаем "//host", "/\host", управляющие символы и обратные слэши — браузеры трактуют их как внешний адрес
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const u = new URL(next, "http://same.origin");
    if (u.origin !== "http://same.origin") return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

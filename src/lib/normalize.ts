// Нормализация контактных значений для поиска дубликатов и сверки со suppression-list.
export function normalizeContact(type: string, raw: string): string {
  const v = raw.trim();
  switch (type) {
    case "email":
      return v.toLowerCase();
    case "phone":
    case "whatsapp": {
      const digits = v.replace(/[^\d+]/g, "");
      let d = digits.replace(/(?!^)\+/g, "");
      if (/^8\d{10}$/.test(d)) d = "+7" + d.slice(1);
      if (/^7\d{10}$/.test(d)) d = "+" + d;
      return d;
    }
    case "telegram":
      return v.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").replace(/^@/, "").toLowerCase();
    case "website":
      return normalizeDomain(v);
    case "linkedin":
    case "social":
      return v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    default:
      return v.toLowerCase();
  }
}

export function normalizeDomain(url: string): string {
  const s = url.trim().toLowerCase();
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return s.replace(/^www\./, "");
  }
}

export function isValidContactFormat(type: string, raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  switch (type) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    case "phone":
    case "whatsapp":
      return /^\+?\d{7,15}$/.test(normalizeContact(type, v));
    case "website":
      try {
        new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
        return v.includes(".");
      } catch {
        return false;
      }
    case "telegram":
      return /^[a-z0-9_]{4,32}$/i.test(normalizeContact("telegram", v));
    default:
      return v.length >= 2;
  }
}

/** Значения, по которым проверяется suppression-list: сам контакт и домен email. */
export function suppressionKeys(type: string, raw: string): string[] {
  const n = normalizeContact(type, raw);
  const keys = [n];
  if (type === "email" && n.includes("@")) keys.push("@" + n.split("@")[1]);
  return keys;
}

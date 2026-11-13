import "server-only";
import { resolveMx } from "node:dns/promises";
import { isValidContactFormat, normalizeDomain } from "./normalize";
import { assertPublicUrl } from "./webfetch";

/**
 * Формальная проверка контакта: синтаксис + (для email) наличие MX-записей домена, (для сайта) публичный DNS.
 * Это НЕ подтверждение владельца — статус «confirmed» ставится только вручную на основании источника.
 */
export async function formalCheck(type: string, value: string): Promise<{ status: "formal" | "invalid" | "unknown"; detail: string }> {
  if (!isValidContactFormat(type, value)) return { status: "invalid", detail: "Неверный формат" };
  if (type === "email") {
    const domain = value.trim().split("@")[1]?.toLowerCase() ?? "";
    try {
      const mx = await resolveMx(domain);
      return mx.length ? { status: "formal", detail: `Формат корректен, у домена ${domain} есть MX-записи` } : { status: "invalid", detail: `У домена ${domain} нет MX-записей` };
    } catch {
      return { status: "invalid", detail: `Домен ${domain} не принимает почту (нет MX)` };
    }
  }
  if (type === "website") {
    try {
      await assertPublicUrl(value);
      return { status: "formal", detail: `Домен ${normalizeDomain(value)} резолвится в публичный адрес` };
    } catch (e) {
      return { status: "invalid", detail: e instanceof Error ? e.message : "Домен недоступен" };
    }
  }
  if (type === "phone" || type === "whatsapp" || type === "telegram") return { status: "formal", detail: "Формат корректен (существование номера/аккаунта не проверялось)" };
  return { status: "unknown", detail: "Для этого типа доступна только ручная проверка" };
}

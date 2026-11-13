import { prisma } from "./db";
import { suppressionKeys, normalizeDomain } from "./normalize";

export type ComplianceIssue = { code: string; message: string; blocking: boolean };

/** Проверки перед подготовкой/отправкой обращения (suppression, do-not-contact, основание, статус контакта). */
export async function checkOutreachCompliance(opts: {
  ownerId: string;
  clientId: string;
  contactId: string | null;
}): Promise<ComplianceIssue[]> {
  const issues: ComplianceIssue[] = [];
  const client = await prisma.client.findUnique({ where: { id: opts.clientId } });
  if (!client) return [{ code: "no_client", message: "Клиент не найден", blocking: true }];
  if (client.doNotContact) issues.push({ code: "client_dnc", message: "Клиент отмечен «Не связываться».", blocking: true });

  const keys: string[] = [];
  if (client.website) keys.push(normalizeDomain(client.website), "@" + normalizeDomain(client.website));

  if (opts.contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: opts.contactId, clientId: opts.clientId } });
    if (!contact) {
      issues.push({ code: "no_contact", message: "Контакт не найден у этого клиента.", blocking: true });
    } else {
      keys.push(...suppressionKeys(contact.type, contact.value));
      if (contact.doNotContact) issues.push({ code: "contact_dnc", message: "Контакт отмечен «Не связываться».", blocking: true });
      if (contact.verificationStatus === "invalid")
        issues.push({ code: "contact_invalid", message: "Контакт помечен как недействительный.", blocking: true });
      if (contact.verificationStatus === "found" || contact.verificationStatus === "unknown")
        issues.push({ code: "contact_unverified", message: "Контакт не проверен — убедитесь, что это деловой адрес компании.", blocking: false });
      const consent = await prisma.consentRecord.findFirst({
        where: { clientId: opts.clientId, OR: [{ contactId: contact.id }, { contactId: null }] },
      });
      if (!consent)
        issues.push({
          code: "no_basis",
          message: "Не зафиксировано правовое основание для обращения (согласие, опубликованный запрос, законный интерес).",
          blocking: true,
        });
    }
  } else {
    issues.push({ code: "no_contact", message: "Не выбран контакт получателя.", blocking: true });
  }

  if (keys.length) {
    const hit = await prisma.suppressionEntry.findFirst({ where: { ownerId: opts.ownerId, value: { in: keys.filter(Boolean) } } });
    if (hit) issues.push({ code: "suppressed", message: `Адрес в списке запрета обращений (${hit.value}).`, blocking: true });
  }
  return issues;
}

export const OPT_OUT_FOOTER: Record<string, string> = {
  ru: "Если вы не хотите получать от нас сообщения, ответьте «Отписаться» — мы больше не будем вам писать.",
  en: "If you'd prefer not to hear from us, reply \"unsubscribe\" and we won't contact you again.",
};

export function optOutFooter(lang: string) {
  return OPT_OUT_FOOTER[lang] ?? OPT_OUT_FOOTER.en;
}

export function isOptOutReply(text: string) {
  return /(отпис|отпиш|не пиши|не пишите|больше не (пишите|присылайте|беспокойте)|удалите (мои )?данные|unsubscribe|\bstop\b|opt[- ]?out)/i.test(text);
}

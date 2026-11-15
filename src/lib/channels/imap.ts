import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "../db";
import { logInteraction } from "../timeline";
import { onInbound } from "../outreach";

// Входящие email через IMAP: ответы сопоставляются с контактами по адресу отправителя.
// Отказы доставки (bounce) помечают адрес недействительным и останавливают кампанию для него.

const env = (k: string) => process.env[k]?.trim() ?? "";
export const imapConfigured = () => Boolean(env("IMAP_HOST") && env("IMAP_USER"));

/** Убирает цитату предыдущего письма из ответа. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^>/.test(l.trim())) break;
    if (/^(On .+ wrote:|.+ пишет:|.+ написал\(а\):|-{2,}\s*Original Message|-{3,}\s*Исходное сообщение)/i.test(l.trim())) break;
    if (/^\d{1,2}[./]\d{1,2}[./]\d{2,4}.+(пишет|wrote)/i.test(l.trim())) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

const BOUNCE_FROM = /(mailer-daemon|postmaster|mail delivery)/i;

export async function syncEmailInbox(): Promise<{ checked: number; matched: number; bounces: number }> {
  if (!imapConfigured()) return { checked: 0, matched: 0, bounces: 0 };
  const client = new ImapFlow({
    host: env("IMAP_HOST"),
    port: Number(env("IMAP_PORT") || 993),
    secure: env("IMAP_SECURE") !== "false",
    auth: { user: env("IMAP_USER"), pass: env("IMAP_PASS") },
    logger: false,
  });
  let checked = 0;
  let matched = 0;
  let bounces = 0;
  await client.connect();
  const lock = await client.getMailboxLock(env("IMAP_MAILBOX") || "INBOX");
  try {
    const state = await prisma.appState.findUnique({ where: { key: "imap_last_uid" } });
    const lastUid = state ? Number(state.value) : 0;
    // Первый запуск — только письма за 14 дней, дальше — всё после последнего UID
    const range = lastUid ? { uid: `${lastUid + 1}:*` } : { since: new Date(Date.now() - 14 * 86_400_000) };
    let maxUid = lastUid;
    const msgs: { uid: number; source: Buffer }[] = [];
    for await (const m of client.fetch(range, { uid: true, source: true }, { uid: true })) {
      if (m.uid <= lastUid || !m.source) continue;
      msgs.push({ uid: m.uid, source: m.source });
    }
    for (const m of msgs) {
      maxUid = Math.max(maxUid, m.uid);
      checked++;
      const parsed = await simpleParser(m.source);
      const from = parsed.from?.value?.[0]?.address?.toLowerCase() ?? "";
      const messageId = parsed.messageId ?? `imap:${m.uid}`;
      const text = parsed.text ?? "";

      if (BOUNCE_FROM.test(from) || BOUNCE_FROM.test(parsed.from?.text ?? "")) {
        const addrs = [...new Set((text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).map((a) => a.toLowerCase()))];
        const hits = await prisma.contact.findMany({ where: { type: "email", normalizedValue: { in: addrs } } });
        for (const c of hits) {
          if (c.verificationStatus === "invalid") continue;
          await prisma.contact.update({ where: { id: c.id }, data: { verificationStatus: "invalid", lastCheckedAt: new Date() } });
          await prisma.campaignItem.updateMany({ where: { contactId: c.id, status: { in: ["ready", "queued", "sent"] } }, data: { status: "failed", error: "Адрес не существует (отказ доставки)" } });
          await logInteraction(c.clientId, "contact_verified", `Письмо на ${c.value} не доставлено — адрес помечен недействительным`, null);
          bounces++;
        }
        continue;
      }
      if (!from) continue;
      const contacts = await prisma.contact.findMany({ where: { type: "email", normalizedValue: from } });
      for (const contact of contacts) {
        const externalId = `email:${messageId}:${contact.id}`;
        if (await prisma.conversationMessage.findFirst({ where: { externalId } })) continue;
        let conv = await prisma.conversation.findFirst({ where: { clientId: contact.clientId, contactId: contact.id, channel: "email" } });
        if (!conv) conv = await prisma.conversation.create({ data: { clientId: contact.clientId, contactId: contact.id, channel: "email", externalThreadId: from } });
        const body = stripQuoted(text).slice(0, 20_000) || text.slice(0, 2000);
        await prisma.conversationMessage.create({
          data: { conversationId: conv.id, direction: "inbound", subject: (parsed.subject ?? "").slice(0, 300), body, status: "received", externalId, createdAt: parsed.date ?? new Date() },
        });
        await onInbound(null, contact.clientId, conv.id, body, "email", from);
        matched++;
      }
    }
    if (maxUid > lastUid) await prisma.appState.upsert({ where: { key: "imap_last_uid" }, update: { value: String(maxUid) }, create: { key: "imap_last_uid", value: String(maxUid) } });
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { checked, matched, bounces };
}

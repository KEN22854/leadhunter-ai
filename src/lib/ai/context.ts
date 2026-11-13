import "server-only";
import { prisma } from "../db";
import { CONTACT_TYPES, SERVICES, VERIFICATION_STATUSES } from "../domain";

// Сборка контекста клиента для модели.
// - Внешние данные оборачиваются в теги и экранируются, чтобы их нельзя было «закрыть» изнутри.
// - Значения контактов (email/телефон) в модель не передаются — только тип и статус проверки.
// - Источники получают короткие id src_N; карта src_N → id в БД возвращается для сохранения доказательств.

const MAX_SOURCE_CHARS = 3000;
const MAX_TOTAL_CHARS = 40_000;

export function sanitizeExternal(text: string, max = MAX_SOURCE_CHARS): string {
  return text
    .replace(/<\/?\s*(external_data|client_profile|conversation_history|user_instructions|executor_profile|system)[^>]*>/gi, "[тег удалён]")
    .slice(0, max);
}

export type BuiltContext = { text: string; sourceMap: Record<string, string>; pagesAnalyzed: string[] };

export async function buildClientContext(
  clientId: string,
  ownerId: string,
  opts: { includeHistory?: boolean; extraPages?: { url: string; title: string; text: string }[] } = {},
): Promise<BuiltContext> {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      sources: { orderBy: { capturedAt: "desc" }, take: 12 },
      contacts: true,
      analyses: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const profile = await prisma.executorProfile.findUnique({ where: { userId: ownerId } });

  const sourceMap: Record<string, string> = {};
  const srcBlocks = client.sources.map((s, i) => {
    const ref = `src_${i + 1}`;
    sourceMap[ref] = s.id;
    return `<source id="${ref}" type="${s.sourceType}" url="${sanitizeExternal(s.sourceUrl, 300)}" captured="${s.capturedAt.toISOString().slice(0, 10)}">
${s.title ? `Заголовок: ${sanitizeExternal(s.title, 300)}\n` : ""}${s.evidence ? `Подтверждает: ${sanitizeExternal(s.evidence, 800)}\n` : ""}${s.rawReference ? `Выдержка: ${sanitizeExternal(s.rawReference)}` : ""}
</source>`;
  });

  const pagesAnalyzed: string[] = [];
  const pageBlocks = (opts.extraPages ?? []).map((p, i) => {
    const ref = `page_${i + 1}`;
    pagesAnalyzed.push(p.url);
    return `<page id="${ref}" url="${sanitizeExternal(p.url, 300)}">
Заголовок: ${sanitizeExternal(p.title, 300)}
${sanitizeExternal(p.text, 6000)}
</page>`;
  });

  const contactsLine = client.contacts.length
    ? client.contacts
        .map((c) => `${CONTACT_TYPES[c.type as keyof typeof CONTACT_TYPES] ?? c.type} (${VERIFICATION_STATUSES[c.verificationStatus as keyof typeof VERIFICATION_STATUSES] ?? c.verificationStatus})`)
        .join(", ")
    : "нет";

  const last = client.analyses[0];
  const profileText = profile
    ? `Имя/компания исполнителя: ${profile.displayName || "-"} / ${profile.companyName || "-"}
Специализация: ${profile.specialization || "-"}
Описание: ${profile.description || "-"}
Преимущества: ${profile.advantages || "-"}
Кейсы, которые разрешено упоминать: ${profile.cases || "нет"}
Портфолио: ${profile.portfolioUrl || "-"}; сайт: ${profile.website || "-"}
Цены и условия (введены пользователем): ${profile.pricingNotes || "не указаны — не называть цены"}`
    : "Профиль исполнителя не заполнен — не упоминай никаких фактов об исполнителе, кроме общих.";

  let history = "";
  if (opts.includeHistory) {
    const convs = await prisma.conversation.findMany({
      where: { clientId },
      include: { items: { orderBy: { createdAt: "desc" }, take: 8 } },
    });
    const items = convs
      .flatMap((c) => c.items.map((m) => ({ ...m, channel: c.channel })))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-10);
    if (items.length)
      history = `<conversation_history>
${items.map((m) => `[${m.createdAt.toISOString().slice(0, 16)} ${m.channel} ${m.direction === "inbound" ? "клиент" : "мы"}] ${sanitizeExternal(m.body, 1200)}`).join("\n")}
</conversation_history>`;
  }

  let text = `<client_profile>
Компания: ${sanitizeExternal(client.companyName, 200)}
Описание (из CRM): ${sanitizeExternal(client.description, 1500) || "нет"}
Категория/отрасль: ${client.category || "-"} / ${client.industry || "-"}
География: ${[client.country, client.region, client.city].filter(Boolean).join(", ") || "не указана"}
Сайт: ${client.website || "нет"}
Язык клиента: ${client.language}
Контакты (только типы и статусы): ${contactsLine}
Дата обнаружения: ${client.firstSeenAt.toISOString().slice(0, 10)}; последняя проверка: ${client.lastCheckedAt?.toISOString().slice(0, 10) ?? "не проверялось"}
${last ? `Последний AI-анализ (${last.createdAt.toISOString().slice(0, 10)}): ${sanitizeExternal(last.summary, 1200)}` : "AI-анализ ещё не проводился"}
</client_profile>

<external_data>
${srcBlocks.join("\n") || "Источников нет."}
${pageBlocks.join("\n")}
</external_data>

<executor_profile>
${profileText}
Услуги в каталоге: ${Object.values(SERVICES).join(", ")}
</executor_profile>
${history}`;
  if (text.length > MAX_TOTAL_CHARS) text = text.slice(0, MAX_TOTAL_CHARS) + "\n[контекст обрезан по лимиту]";
  return { text, sourceMap, pagesAnalyzed };
}

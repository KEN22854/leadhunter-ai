import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../api";
import type { CurrentUser } from "../auth";
import { callStructured } from "../ai/provider";
import { PROMPTS } from "../ai/prompts";
import { RewriteSchema, SignalOutreachSchema } from "../ai/schemas";
import { approveAndSend, queueOutbound } from "../outreach";
import { logInteraction } from "../timeline";
import { SOURCE_MAP, sourceLabel, type ReplyMode } from "./catalog";
import { dncHit, ensureClientForLead, logProcessing, requireLead } from "./store";
import { LANGS, SIGNAL_SERVICES, type Lang } from "./lexicon";
import { publishThreadsReply, threadsAppUsage, threadsToken, THREADS_MAX_TEXT, ThreadsError } from "./threads";
import type { Identity } from "./identity";

// AI Personal Outreach + Outreach Channel Manager.
// Отправка через официальный канал есть только для email (SMTP через центр коммуникаций CRM).
// Для соцсетей и бирж — открытие исходного диалога / механизма отклика площадки и ручная отправка
// с подтверждением пользователем. Никакой автоматизации личных сообщений и массовых рассылок.

export const VARIANTS = { friendly: "Дружелюбное", business: "Деловое", short: "Краткое" } as const;
export type VariantKey = keyof typeof VARIANTS;

async function leadContext(leadId: string, signalId?: string | null) {
  const lead = await prisma.socialLead.findUniqueOrThrow({ where: { id: leadId }, include: { signals: { orderBy: { score: "desc" } }, identities: true, attempts: { orderBy: { createdAt: "desc" }, take: 5 } } });
  const signal = (signalId && lead.signals.find((s) => s.id === signalId)) || lead.signals[0];
  if (!signal) throw new ApiError(409, "no_signal", "У лида нет публикаций");
  return { lead, signal };
}

// ---------------- Шаблоны без AI (только факты из публикации и профиля) ----------------

const TPL: Record<Lang, Record<VariantKey, (v: { title: string; service: string; about: string; portfolio: string; source: string; name: string }) => string>> = {
  ru: {
    friendly: (v) => `Здравствуйте! Увидел(а) ваш запрос на ${v.source}: «${v.title}». ${v.about ? `Моя специализация — ${v.about}.` : `Занимаюсь направлением «${v.service}».`} ${v.portfolio ? `Примеры работ: ${v.portfolio}. ` : ""}Если задача ещё актуальна, буду рад(а) обсудить детали и предложить пару идей.\n${v.name}`.trim(),
    business: (v) => `Добрый день!\n\nПо вашему запросу «${v.title}» (${v.source}): ${v.about ? `моя специализация — ${v.about}` : `работаю в направлении «${v.service}»`}.\n${v.portfolio ? `Портфолио: ${v.portfolio}\n` : ""}Чтобы предложить решение и оценку, уточните, пожалуйста, сроки и ключевые требования. Готов(а) созвониться или продолжить здесь.\n\nС уважением,\n${v.name}`.trim(),
    short: (v) => `Здравствуйте! По запросу «${v.title}» — могу помочь${v.portfolio ? `, портфолио: ${v.portfolio}` : ""}. Актуально?`,
  },
  en: {
    friendly: (v) => `Hi! I saw your post on ${v.source}: "${v.title}". ${v.about ? `I specialize in: ${v.about}.` : `I work in ${v.service}.`} ${v.portfolio ? `Some of my work: ${v.portfolio}. ` : ""}If it's still open, I'd be happy to chat about the details and share a couple of ideas.\n${v.name}`.trim(),
    business: (v) => `Hello,\n\nRegarding your request "${v.title}" (${v.source}): ${v.about ? `I specialize in: ${v.about}` : `I work in ${v.service}`}.\n${v.portfolio ? `Portfolio: ${v.portfolio}\n` : ""}To suggest an approach and an estimate, could you share the timeline and key requirements? Happy to continue here or jump on a call.\n\nBest regards,\n${v.name}`.trim(),
    short: (v) => `Hi! Re "${v.title}" — I can help${v.portfolio ? ` (portfolio: ${v.portfolio})` : ""}. Still looking?`,
  },
  de: {
    friendly: (v) => `Hallo! Ich habe Ihren Beitrag auf ${v.source} gesehen: „${v.title}“. ${v.about ? `Mein Schwerpunkt: ${v.about}.` : ""} ${v.portfolio ? `Arbeitsproben: ${v.portfolio}. ` : ""}Falls noch aktuell, bespreche ich gern die Details.\n${v.name}`.trim(),
    business: (v) => `Guten Tag,\n\nzu Ihrer Anfrage „${v.title}“ (${v.source}): ${v.about ? `mein Schwerpunkt: ${v.about}` : "ich kann Sie dabei unterstützen"}.\n${v.portfolio ? `Portfolio: ${v.portfolio}\n` : ""}Für ein Angebot würde ich gern Zeitrahmen und Anforderungen kennen.\n\nMit freundlichen Grüßen\n${v.name}`.trim(),
    short: (v) => `Hallo! Zu „${v.title}“ — ich kann helfen${v.portfolio ? ` (Portfolio: ${v.portfolio})` : ""}. Noch aktuell?`,
  },
  fr: {
    friendly: (v) => `Bonjour ! J'ai vu votre publication sur ${v.source} : « ${v.title} ». ${v.about ? `Ma spécialité : ${v.about}.` : ""} ${v.portfolio ? `Mes réalisations : ${v.portfolio}. ` : ""}Si c'est toujours d'actualité, je serais ravi(e) d'en discuter.\n${v.name}`.trim(),
    business: (v) => `Bonjour,\n\nConcernant votre demande « ${v.title} » (${v.source}) : ${v.about ? `ma spécialité : ${v.about}` : "je peux vous accompagner"}.\n${v.portfolio ? `Portfolio : ${v.portfolio}\n` : ""}Pour vous proposer une approche et un devis, pourriez-vous préciser le délai et les besoins clés ?\n\nCordialement,\n${v.name}`.trim(),
    short: (v) => `Bonjour ! Pour « ${v.title} » — je peux vous aider${v.portfolio ? ` (portfolio : ${v.portfolio})` : ""}. Toujours d'actualité ?`,
  },
  es: {
    friendly: (v) => `¡Hola! Vi tu publicación en ${v.source}: «${v.title}». ${v.about ? `Mi especialidad: ${v.about}.` : ""} ${v.portfolio ? `Algunos trabajos: ${v.portfolio}. ` : ""}Si sigue en pie, me encantaría hablar de los detalles.\n${v.name}`.trim(),
    business: (v) => `Hola,\n\nSobre tu solicitud «${v.title}» (${v.source}): ${v.about ? `mi especialidad: ${v.about}` : "puedo ayudarte con esto"}.\n${v.portfolio ? `Portafolio: ${v.portfolio}\n` : ""}Para proponerte un enfoque y presupuesto, ¿podrías compartir plazos y requisitos clave?\n\nSaludos,\n${v.name}`.trim(),
    short: (v) => `¡Hola! Sobre «${v.title}» — puedo ayudarte${v.portfolio ? ` (portafolio: ${v.portfolio})` : ""}. ¿Sigue disponible?`,
  },
};

function templateDrafts(lang: Lang, v: Parameters<(typeof TPL)["ru"]["short"]>[0]) {
  const t = TPL[lang] ?? TPL.en;
  return (Object.keys(VARIANTS) as VariantKey[]).map((key) => ({ key, subject: key === "short" ? "" : lang === "ru" ? `По вашему запросу: ${v.title.slice(0, 60)}` : `Re: ${v.title.slice(0, 60)}`, body: t[key](v).replace(/ {2,}/g, " "), facts: [`Заголовок публикации: «${v.title}»`, `Площадка: ${v.source}`, ...(v.portfolio ? ["Портфолио из профиля"] : [])] }));
}

/** Генерация трёх вариантов: AI (если доступен) или шаблон по фактам публикации. */
export async function generateDrafts(user: CurrentUser, leadId: string, opts: { signalId?: string | null; language?: string; mode: "ai" | "template"; instructions?: string; channel?: string }) {
  await requireLead(user, leadId);
  const { lead, signal } = await leadContext(leadId, opts.signalId);
  const lang = ((opts.language && opts.language in LANGS ? opts.language : signal.language) || "ru") as Lang;
  const profile = await prisma.executorProfile.findUnique({ where: { userId: user.id } });
  const svc = SIGNAL_SERVICES[lead.service]?.label ?? lead.service;
  const generationId = randomUUID();
  let variants: { key: VariantKey; subject: string; body: string; facts: string[] }[];
  let warnings: string[] = [];
  let model = "";
  let origin = "template";
  if (opts.mode === "ai") {
    const history = await prisma.outreachAttempt.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 5 });
    const { data, model: m } = await callStructured(
      { userId: user.id, clientId: lead.clientId, operation: "signals.outreach" },
      {
        system: PROMPTS.signalOutreach.system,
        user: [
          `Параметры: язык=${LANGS[lang]} (${lang}); канал=${opts.channel ?? SOURCE_MAP[signal.source]?.replyHint ?? "ответ на публикацию"}; услуга исполнителя=${svc}.`,
          `<executor_profile>\n${JSON.stringify({ name: profile?.displayName, company: profile?.companyName, specialization: profile?.specialization, description: profile?.description, advantages: profile?.advantages, cases: profile?.cases, portfolioUrl: profile?.portfolioUrl, website: profile?.website, signature: profile?.signature, pricingNotes: profile?.pricingNotes })}\n</executor_profile>`,
          `<external_data>\n${JSON.stringify({ source: sourceLabel(signal.source), url: signal.url, published: signal.publishedAt, title: signal.title, text: signal.text.slice(0, 3000), author: signal.authorName, authorProfile: lead.headline, budget: signal.budget, country: lead.country, city: lead.city })}\n</external_data>`,
          history.length ? `<conversation_history>\n${JSON.stringify(history.map((h) => ({ at: h.createdAt, status: h.status, outcome: h.outcome, body: h.body.slice(0, 500) })))}\n</conversation_history>` : "",
          opts.instructions ? `<user_instructions>\n${opts.instructions.slice(0, 1000)}\n</user_instructions>` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        schema: SignalOutreachSchema,
        effort: "medium",
        maxTokens: 8000,
      },
    );
    variants = (Object.keys(VARIANTS) as VariantKey[]).map((k) => data.variants.find((v) => v.key === k)).filter((v): v is NonNullable<typeof v> => Boolean(v));
    warnings = data.warnings;
    model = m;
    origin = "ai";
  } else {
    variants = templateDrafts(lang, {
      title: signal.title.slice(0, 120),
      service: svc,
      about: [profile?.specialization, profile?.advantages].filter(Boolean).join(", ").slice(0, 160),
      portfolio: profile?.portfolioUrl ?? "",
      source: sourceLabel(signal.source),
      name: profile?.signature || profile?.displayName || "",
    });
    warnings = ["Шаблон без AI: персонализация — только заголовок публикации и данные профиля. Проверьте текст перед отправкой."];
    if (!profile?.specialization && !profile?.portfolioUrl) warnings.push("Профиль исполнителя не заполнен — добавьте специализацию и портфолио в настройках.");
  }
  await prisma.outreachDraft.updateMany({ where: { leadId, status: "draft" }, data: { status: "archived" } });
  const drafts = [];
  for (const v of variants)
    drafts.push(
      await prisma.outreachDraft.create({
        data: { leadId, signalId: signal.id, generationId, variant: v.key, language: lang, subject: v.subject, body: v.body, evidence: v.facts as unknown as Prisma.InputJsonValue, warnings: warnings as unknown as Prisma.InputJsonValue, origin, model, promptVersion: origin === "ai" ? PROMPTS.signalOutreach.version : "template-v1" },
      }),
    );
  return { drafts, warnings };
}

export const REWRITE_OPS = {
  friendlier: "Сделай тон дружелюбнее и теплее",
  formal: "Сделай тон более деловым",
  shorter: "Сократи примерно вдвое, сохранив суть и ссылку на запрос",
  translate: "Переведи на язык",
} as const;

export async function rewriteDraft(user: CurrentUser, draftId: string, op: keyof typeof REWRITE_OPS, targetLang?: string) {
  const d = await prisma.outreachDraft.findUnique({ where: { id: draftId }, include: { lead: true } });
  if (!d) throw new ApiError(404, "not_found", "Черновик не найден");
  await requireLead(user, d.leadId);
  if (op === "translate" && !(targetLang && targetLang in LANGS)) throw new ApiError(400, "bad_lang", "Укажите язык перевода");
  const cmd = op === "translate" ? `${REWRITE_OPS.translate} ${LANGS[targetLang as Lang]} (${targetLang}). Тему письма тоже переведи — верни её первой строкой в формате «Тема: ...», если она есть.` : REWRITE_OPS[op];
  const { data } = await callStructured(
    { userId: user.id, clientId: d.lead.clientId, operation: `signals.rewrite.${op}` },
    { system: PROMPTS.rewrite.system, user: `Команда: ${cmd}\n\n<external_data>\n${d.subject ? `Тема: ${d.subject}\n\n` : ""}${d.body}\n</external_data>`, schema: RewriteSchema, effort: "low", maxTokens: 4000 },
  );
  let subject = d.subject;
  let body = data.text.trim();
  const m = body.match(/^Тема:\s*(.+)\n+/);
  if (m) {
    subject = m[1].trim();
    body = body.slice(m[0].length);
  }
  return prisma.outreachDraft.update({ where: { id: d.id }, data: { subject, body, origin: "rewrite", version: { increment: 1 }, language: op === "translate" ? targetLang! : d.language, status: "saved" } });
}

// ---------------- Channel Manager ----------------

export type ChannelOption = { mode: ReplyMode; channel: string; label: string; target: string; available: boolean; reason: string };

export async function channelOptions(leadId: string, signalId?: string | null): Promise<ChannelOption[]> {
  const { lead, signal } = await leadContext(leadId, signalId);
  const meta = SOURCE_MAP[signal.source];
  const out: ChannelOption[] = [];
  for (const mode of meta?.reply ?? ["open_dialog"]) {
    const target = mode === "open_dialog" && lead.profileUrl && ["telegram", "reddit", "vk", "x", "threads"].includes(signal.source) ? lead.profileUrl : signal.url;
    out.push({ mode, channel: signal.source, label: mode === "platform_reply" ? `Отклик на ${meta?.label}` : `Открыть ${mode === "open_dialog" && target === lead.profileUrl ? "профиль автора" : "публикацию"} (${meta?.label ?? signal.source})`, target, available: Boolean(target), reason: target ? meta?.replyHint ?? "" : "Нет ссылки на публикацию" });
  }
  if (signal.source === "threads") {
    const hasId = /^\d{5,30}$/.test(signal.externalId);
    const token = Boolean(threadsToken());
    out.push({
      mode: "api",
      channel: "threads",
      label: "Ответ в Threads через официальный API",
      target: hasId ? signal.externalId : "",
      available: hasId && token,
      reason: !token ? "Токен Threads не задан (Настройки → Подключения)" : !hasId ? "Пост добавлен вручную — у него нет ID Threads API" : `Ответ публикуется под вашим профилем; до ${THREADS_MAX_TEXT} символов, с лимитами приложения`,
    });
  }
  const email = lead.identities.find((i) => i.kind === "email");
  out.push({
    mode: "api",
    channel: "email",
    label: email ? `Email ${email.value}` : "Email",
    target: email?.value ?? "",
    available: Boolean(email),
    reason: email ? "Адрес опубликован автором в запросе; отправка через SMTP центра коммуникаций с подтверждением" : "Автор не публиковал email — официальной отправки нет",
  });
  return out;
}

export type PrecheckIssue = { code: string; message: string; blocking: boolean };

/** Обязательные проверки перед подготовкой: контакт, Do Not Contact, отказ, повторное обращение. */
export async function precheck(user: CurrentUser, leadId: string, mode: ReplyMode, target: string, channel = "email"): Promise<PrecheckIssue[]> {
  const lead = await prisma.socialLead.findUniqueOrThrow({ where: { id: leadId }, include: { identities: true, attempts: true } });
  const issues: PrecheckIssue[] = [];
  if (!target) issues.push({ code: "no_target", message: "Нет контакта или ссылки для выбранного способа связи", blocking: true });
  if (lead.doNotContact) issues.push({ code: "dnc", message: "Лид в списке Do Not Contact", blocking: true });
  if (lead.status === "declined" || lead.attempts.some((a) => a.outcome === "negative")) issues.push({ code: "declined", message: "Человек уже отказался от общения — повторные обращения запрещены", blocking: true });
  const hit = await dncHit(user.id, lead.identities.map((i) => ({ kind: i.kind as Identity["kind"], value: i.value })));
  if (hit) issues.push({ code: "suppressed", message: `Идентификатор в глобальном списке Do Not Contact (${hit.value})`, blocking: true });
  const recent = lead.attempts.filter((a) => ["confirmed_sent", "sent"].includes(a.status) && Date.now() - (a.sentAt ?? a.createdAt).getTime() < 14 * 86_400_000);
  if (recent.length) issues.push({ code: "recent", message: `Вы уже писали этому человеку ${recent[0].sentAt?.toLocaleDateString("ru-RU") ?? "недавно"} — не отправляйте повторно без ответа`, blocking: recent.length >= 2 });
  if (mode === "api" && channel === "threads") {
    if (!threadsToken()) issues.push({ code: "no_token", message: "Threads не подключён", blocking: true });
    // Не больше одного ответа одному человеку через API — главная защита от спама
    if (lead.attempts.some((a) => a.channel === "threads" && ["sent", "confirmed_sent", "queued", "sending"].includes(a.status)))
      issues.push({ code: "already_replied", message: "Этому автору уже отправлен или поставлен в очередь ответ в Threads", blocking: true });
  } else if (mode === "api") {
    const email = lead.identities.find((i) => i.kind === "email");
    if (!email) issues.push({ code: "no_email", message: "Нет опубликованного автором email", blocking: true });
    else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.value)) issues.push({ code: "bad_email", message: "Email некорректен", blocking: true });
  }
  return issues;
}

export async function prepareAttempt(user: CurrentUser, leadId: string, p: { mode: ReplyMode; channel?: string; draftId?: string | null; signalId?: string | null; subject: string; body: string }) {
  await requireLead(user, leadId);
  if (!p.body.trim()) throw new ApiError(400, "empty", "Текст сообщения пуст");
  const opts = await channelOptions(leadId, p.signalId);
  const opt = opts.find((o) => o.mode === p.mode && (!p.channel || o.channel === p.channel)) ?? opts.find((o) => o.mode === p.mode && o.available) ?? opts.find((o) => o.mode === p.mode);
  if (!opt) throw new ApiError(400, "mode_not_allowed", "Этот способ связи недоступен для источника");
  const issues = await precheck(user, leadId, p.mode, opt.target, opt.channel);
  if (issues.some((i) => i.blocking)) throw new ApiError(409, "outreach_blocked", "Обращение заблокировано проверками", { issues });
  if (opt.channel === "threads" && [...p.body.trim()].length > THREADS_MAX_TEXT)
    throw new ApiError(400, "too_long", `В Threads — не больше ${THREADS_MAX_TEXT} символов (сейчас ${[...p.body.trim()].length}). Используйте «Короче» или краткий вариант.`);
  const attempt = await prisma.outreachAttempt.create({
    data: { leadId, draftId: p.draftId ?? null, signalId: p.signalId ?? null, mode: p.mode, channel: opt.channel, target: opt.target, subject: p.subject, body: p.body.trim(), status: "prepared" },
  });
  if (p.draftId) await prisma.outreachDraft.updateMany({ where: { id: p.draftId, leadId }, data: { status: "used", body: p.body.trim(), subject: p.subject } });
  return { attempt, issues };
}

async function requireAttempt(user: CurrentUser, id: string) {
  const a = await prisma.outreachAttempt.findUnique({ where: { id }, include: { lead: true } });
  if (!a || (a.lead.ownerId !== user.id && user.role !== "admin")) throw new ApiError(404, "not_found", "Обращение не найдено");
  return a;
}

async function afterContact(user: CurrentUser, leadId: string, attemptId: string, summary: string) {
  const lead = await prisma.socialLead.findUniqueOrThrow({ where: { id: leadId } });
  await prisma.socialLead.update({ where: { id: leadId }, data: { status: ["new", "qualified", "converted"].includes(lead.status) ? "contacted" : lead.status, firstContactAt: lead.firstContactAt ?? new Date() } });
  // Интеграция с CRM: карточка клиента + задача follow-up через 3 дня
  const { client } = await ensureClientForLead(user, leadId, { createTask: false });
  await logInteraction(client.id, "message_sent", summary, user, { attemptId, leadId });
  await prisma.clientTask.create({ data: { clientId: client.id, title: `Проверить ответ: ${lead.displayName}`, description: "Если ответа нет — не пишите повторно больше одного раза.", kind: "follow_up", source: "ai", dueAt: new Date(Date.now() + 3 * 86_400_000), assigneeId: user.id } });
  await logProcessing(user.id, { leadId, subject: lead.displayName, action: "contacted", basis: lead.primarySource && SOURCE_MAP[lead.primarySource]?.kind === "directory" ? "legitimate_interest" : "published_request", note: summary });
}

export async function attemptAction(user: CurrentUser, id: string, a: { action: "open" | "confirm" | "send" | "queue" | "outcome" | "cancel"; confirm?: boolean; outcome?: "replied" | "positive" | "negative" | "no_response"; idempotencyKey?: string; note?: string }) {
  const at = await requireAttempt(user, id);
  if (a.action === "open") {
    if (!["prepared", "opened"].includes(at.status)) throw new ApiError(409, "bad_state", "Обращение уже завершено");
    return prisma.outreachAttempt.update({ where: { id }, data: { status: "opened", openedAt: at.openedAt ?? new Date() } });
  }
  if (a.action === "cancel") {
    if (!["prepared", "opened", "failed", "queued"].includes(at.status)) throw new ApiError(409, "bad_state", "Отменить можно только неотправленное обращение");
    return prisma.outreachAttempt.update({ where: { id }, data: { status: "cancelled" } });
  }
  if (a.action === "confirm") {
    // Ручная отправка: пользователь подтверждает, что сам отправил сообщение в исходном диалоге
    if (at.mode === "api") throw new ApiError(400, "use_send", "Для email используйте отправку через официальный канал");
    if (a.confirm !== true) throw new ApiError(400, "confirm_required", "Подтвердите, что сообщение отправлено вами");
    if (!["prepared", "opened"].includes(at.status)) throw new ApiError(409, "bad_state", "Обращение уже обработано");
    const issues = await precheck(user, at.leadId, at.mode as ReplyMode, at.target);
    if (issues.some((i) => i.blocking && i.code !== "recent")) throw new ApiError(409, "outreach_blocked", "Обращение заблокировано проверками", { issues });
    const upd = await prisma.outreachAttempt.update({ where: { id }, data: { status: "confirmed_sent", sentAt: new Date() } });
    await afterContact(user, at.leadId, id, `Отправлено вручную (${sourceLabel(at.channel)}), подтверждено пользователем`);
    return upd;
  }
  if (a.action === "queue") {
    // Одобрение для автоотправки: фоновая задача отправит с паузами и в пределах дневного лимита
    if (at.channel !== "threads" || at.mode !== "api") throw new ApiError(400, "not_queueable", "Очередь автоотправки — только для ответов в Threads через API");
    if (a.confirm !== true) throw new ApiError(400, "confirm_required", "Подтвердите одобрение");
    if (!["prepared", "opened", "failed"].includes(at.status)) throw new ApiError(409, "bad_state", "Обращение уже обработано");
    const issues = await precheck(user, at.leadId, "api", at.target, "threads");
    if (issues.some((i) => i.blocking && i.code !== "recent")) throw new ApiError(409, "outreach_blocked", "Обращение заблокировано проверками", { issues });
    return prisma.outreachAttempt.update({ where: { id }, data: { status: "queued", error: "" } });
  }
  if (a.action === "send" && at.channel === "threads") {
    if (a.confirm !== true) throw new ApiError(400, "confirm_required", "Подтвердите отправку");
    return sendThreadsAttempt(user, id, { manual: true });
  }
  if (a.action === "send") {
    if (at.mode !== "api" || at.channel !== "email") throw new ApiError(400, "not_api", "Автоматическая отправка доступна только для email");
    if (a.confirm !== true) throw new ApiError(400, "confirm_required", "Подтвердите отправку");
    if (at.status === "sent") return at;
    if (!["prepared", "opened", "failed"].includes(at.status)) throw new ApiError(409, "bad_state", "Обращение уже обработано");
    const issues = await precheck(user, at.leadId, "api", at.target);
    if (issues.some((i) => i.blocking && i.code !== "recent")) throw new ApiError(409, "outreach_blocked", "Обращение заблокировано проверками", { issues });
    const { client, contactIds } = await ensureClientForLead(user, at.leadId, { createTask: false });
    const contact = await prisma.contact.findFirst({ where: { clientId: client.id, type: "email", normalizedValue: at.target.toLowerCase(), id: contactIds ? { in: contactIds } : undefined } });
    if (!contact) throw new ApiError(409, "no_contact", "Email не найден в карточке CRM");
    try {
      const outbound = at.outboundId ? { item: { id: at.outboundId } } : await queueOutbound(user, client.id, { channel: "email", contactId: contact.id, subject: at.subject || "Ваш запрос", body: at.body });
      await prisma.outreachAttempt.update({ where: { id }, data: { outboundId: outbound.item.id } });
      const sent = await approveAndSend(user, outbound.item.id, a.idempotencyKey || `signal:${id}`);
      if (sent.status !== "sent" && sent.status !== "delivered") throw new ApiError(502, "send_failed", sent.error || "Отправка не удалась");
      const upd = await prisma.outreachAttempt.update({ where: { id }, data: { status: "sent", sentAt: new Date(), error: "" } });
      await afterContact(user, at.leadId, id, `Email отправлен через SMTP на ${at.target}`);
      return upd;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      await prisma.outreachAttempt.update({ where: { id }, data: { status: "failed", error: msg.slice(0, 500) } });
      throw e;
    }
  }
  // outcome
  if (!["confirmed_sent", "sent"].includes(at.status)) throw new ApiError(409, "not_sent", "Результат можно отметить только у отправленного обращения");
  if (!a.outcome) throw new ApiError(400, "no_outcome", "Укажите результат");
  const upd = await prisma.outreachAttempt.update({ where: { id }, data: { outcome: a.outcome, repliedAt: a.outcome === "no_response" ? null : new Date() } });
  const lead = at.lead;
  if (a.outcome === "negative") {
    const { addLeadToDnc } = await import("./store");
    await prisma.socialLead.update({ where: { id: lead.id }, data: { status: "declined" } });
    await addLeadToDnc(user, lead.id, a.note || "Отказ от общения");
  } else if (a.outcome === "positive") {
    await prisma.socialLead.update({ where: { id: lead.id }, data: { status: "positive" } });
    if (lead.clientId) {
      await prisma.client.updateMany({ where: { id: lead.clientId, ownerId: user.id }, data: { status: "negotiating" } });
      await prisma.clientTask.create({ data: { clientId: lead.clientId, title: `Положительный ответ: подготовить предложение для ${lead.displayName}`, kind: "task", source: "ai", priority: "high", dueAt: new Date(Date.now() + 86_400_000), assigneeId: user.id } });
      await logInteraction(lead.clientId, "reply_received", "Положительный ответ на обращение из «Спроса»", user, { attemptId: id });
    }
  } else if (a.outcome === "replied") {
    await prisma.socialLead.update({ where: { id: lead.id }, data: { status: "replied" } });
    if (lead.clientId) await logInteraction(lead.clientId, "reply_received", "Получен ответ на обращение из «Спроса»", user, { attemptId: id });
  }
  return upd;
}

// ---------------- Threads: отправка и очередь ----------------

/**
 * Отправка одного ответа в Threads. Перед отправкой — повторные проверки (Do Not Contact, отказ,
 * «один ответ одному автору»), дневной лимит и пауза между ответами. Атомарная блокировка от двойной отправки.
 */
export async function sendThreadsAttempt(user: CurrentUser, id: string, opts: { manual: boolean }) {
  const at = await prisma.outreachAttempt.findUniqueOrThrow({ where: { id }, include: { lead: true } });
  if (at.status === "sent") return at;
  const usage = await threadsAppUsage(at.lead.ownerId);
  if (usage.sent24h >= usage.limit) {
    if (!opts.manual) return null;
    throw new ApiError(429, "daily_limit", `Дневной лимит ответов в Threads исчерпан (${usage.sent24h}/${usage.limit}). Изменить — в «Настройки → Подключения».`);
  }
  if (!opts.manual && usage.lastAt && Date.now() - usage.lastAt.getTime() < usage.intervalMin * 60_000) return null; // ещё рано
  // Сама эта попытка (в очереди) не считается «уже отправленным» ответом
  const others = await prisma.outreachAttempt.count({ where: { leadId: at.leadId, channel: "threads", id: { not: id }, status: { in: ["sent", "confirmed_sent", "queued", "sending"] } } });
  const issues = (await precheck(user, at.leadId, "api", at.target, "threads")).filter((i) => i.code !== "already_replied");
  if (others) issues.push({ code: "already_replied", message: "Этому автору уже отправлен ответ в Threads", blocking: true });
  if (issues.some((i) => i.blocking && i.code !== "recent")) {
    await prisma.outreachAttempt.update({ where: { id }, data: { status: "cancelled", error: issues.filter((i) => i.blocking).map((i) => i.message).join("; ").slice(0, 500) } });
    if (!opts.manual) return null;
    throw new ApiError(409, "outreach_blocked", "Отправка заблокирована проверками", { issues });
  }
  const lock = await prisma.outreachAttempt.updateMany({ where: { id, status: { in: ["prepared", "opened", "failed", "queued"] } }, data: { status: "sending" } });
  if (!lock.count) {
    if (!opts.manual) return null;
    throw new ApiError(409, "bad_state", "Обращение уже отправляется или обработано");
  }
  try {
    const r = await publishThreadsReply(at.target, at.body);
    const upd = await prisma.outreachAttempt.update({ where: { id }, data: { status: "sent", sentAt: new Date(), outboundId: r.id, error: "" } });
    await afterContact(user, at.leadId, id, `Ответ в Threads опубликован через API (${opts.manual ? "вручную" : "очередь автоотправки"})`);
    return upd;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const retry = e instanceof ThreadsError && e.retryable && !opts.manual;
    // Временные ошибки в очереди — вернуть в очередь; иначе — «ошибка» с причиной
    await prisma.outreachAttempt.update({ where: { id }, data: { status: retry ? "queued" : "failed", error: msg.slice(0, 500) } });
    if (opts.manual) throw new ApiError(502, "threads_failed", msg);
    return null;
  }
}

/** Фоновая задача: не больше одного ответа за запуск на владельца, с паузой и дневным лимитом. */
export async function processThreadsQueue() {
  if (!threadsToken()) return { sent: 0 };
  const queued = await prisma.outreachAttempt.findMany({ where: { channel: "threads", mode: "api", status: "queued" }, orderBy: { updatedAt: "asc" }, include: { lead: { select: { ownerId: true } } }, take: 50 });
  const owners = new Set<string>();
  let sent = 0;
  for (const q of queued) {
    if (owners.has(q.lead.ownerId)) continue;
    owners.add(q.lead.ownerId);
    const u = await prisma.user.findUnique({ where: { id: q.lead.ownerId }, select: { id: true, email: true, name: true, role: true } });
    if (!u) continue;
    const r = await sendThreadsAttempt(u, q.id, { manual: false }).catch(() => null);
    if (r) sent++;
  }
  return { sent, queued: queued.length };
}

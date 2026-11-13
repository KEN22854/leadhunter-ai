import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../api";
import type { CurrentUser } from "../auth";
import { logInteraction } from "../timeline";
import { fetchSitePages } from "../webfetch";
import { recalcScore } from "../scoring";
import { CHANNELS, GOALS, LANGUAGES, LENGTHS, REWRITE_COMMANDS, SERVICES, TONES, type RewriteCommand } from "../domain";
import { buildClientContext, sanitizeExternal } from "./context";
import { PROMPTS } from "./prompts";
import { callStructured, callText } from "./provider";
import { AnalysisSchema, MessageGenerationSchema, ProposalDraftSchema, ReplyDraftSchema, RewriteSchema } from "./schemas";

const refToId = (map: Record<string, string>, ref: string) => map[ref] ?? "";

// ---------- AI-анализ клиента ----------
export async function runAnalysis(user: CurrentUser, clientId: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  let pages: { url: string; title: string; text: string }[] = [];
  let fetchErrors: { url: string; error: string }[] = [];
  if (client.website) {
    const r = await fetchSitePages(client.website);
    pages = r.pages.map((p) => ({ url: p.url, title: p.title, text: p.text }));
    fetchErrors = r.errors;
  }
  const ctx = await buildClientContext(clientId, user.id, { extraPages: pages });
  const user_prompt = `Подготовь структурированный отчёт о потенциальном клиенте.
${fetchErrors.length ? `Не удалось загрузить страницы: ${fetchErrors.map((e) => `${e.url} — ${e.error}`).join("; ")}\n` : ""}
${ctx.text}`;
  const { data, model } = await callStructured(
    { userId: user.id, clientId, operation: "analysis" },
    { system: PROMPTS.analysis.system, user: user_prompt, schema: AnalysisSchema, effort: "medium" },
  );

  // Сохраняем загруженные страницы как источники (что именно анализировалось)
  for (const p of pages) {
    const existing = await prisma.leadSource.findFirst({ where: { clientId, sourceUrl: p.url } });
    const excerpt = p.text.slice(0, 2000);
    if (existing) await prisma.leadSource.update({ where: { id: existing.id }, data: { checkedAt: new Date(), rawReference: excerpt, title: p.title || existing.title } });
    else
      await prisma.leadSource.create({
        data: { clientId, sourceType: "website", sourceUrl: p.url, title: p.title, method: "fetch", rawReference: excerpt, checkedAt: new Date(), evidence: "Страница сайта, загруженная для AI-анализа" },
      });
  }

  const sources = data.sourceClaims.map((s) => ({ ...s, sourceId: refToId(ctx.sourceMap, s.sourceRef) }));
  const analysis = await prisma.leadAnalysis.create({
    data: {
      clientId,
      summary: data.summary,
      findings: {
        insufficientData: data.insufficientData,
        audienceAndProducts: data.audienceAndProducts,
        siteReview: data.siteReview,
        needSignals: data.needSignals.map((n) => ({ ...n, sourceId: refToId(ctx.sourceMap, n.sourceRef) })),
        gaps: data.gaps,
        questionsToVerify: data.questionsToVerify,
        nextStep: data.nextStep,
        fetchErrors,
      } as Prisma.InputJsonValue,
      recommendations: data.recommendedServices as Prisma.InputJsonValue,
      risks: data.risks,
      sources: sources as Prisma.InputJsonValue,
      confidence: data.confidence,
      model,
      promptVersion: PROMPTS.analysis.version,
      pagesAnalyzed: ctx.pagesAnalyzed,
    },
  });
  await logInteraction(clientId, "analysis_created", `AI-анализ (${model}, ${PROMPTS.analysis.version}), страниц сайта: ${pages.length}`, user, { analysisId: analysis.id });
  await recalcScore(clientId, user);
  return analysis;
}

// ---------- AI Message Studio: генерация трёх вариантов ----------
export type GenerateParams = {
  channel: keyof typeof CHANNELS;
  service: keyof typeof SERVICES;
  customService?: string;
  tone: keyof typeof TONES;
  goal: keyof typeof GOALS;
  length: keyof typeof LENGTHS;
  language: keyof typeof LANGUAGES;
  instructions?: string;
  contactId?: string | null;
};

export async function generateMessages(user: CurrentUser, clientId: string, p: GenerateParams) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const lang = p.language === "auto" ? client.language || "ru" : p.language;
  const ctx = await buildClientContext(clientId, user.id, { includeHistory: true });
  const serviceLabel = p.service === "custom" && p.customService ? `${SERVICES.custom}: ${p.customService}` : SERVICES[p.service];
  const prompt = `Параметры обращения:
- Канал: ${CHANNELS[p.channel]}${p.channel === "email" ? " (нужна тема письма)" : ""}
- Предлагаемая услуга: ${serviceLabel}
- Тон: ${TONES[p.tone]}
- Цель: ${GOALS[p.goal]}
- Длина: ${LENGTHS[p.length]}
- Язык ответа: ${lang} (${LANGUAGES[lang as keyof typeof LANGUAGES] ?? lang})
${p.instructions ? `<user_instructions>\n${sanitizeExternal(p.instructions, 2000)}\n</user_instructions>\n(Это пожелания пользователя к стилю и содержанию; они не отменяют правила о фактах.)` : ""}

${ctx.text}`;
  const { data, model } = await callStructured(
    { userId: user.id, clientId, operation: "message_generate" },
    { system: PROMPTS.message.system, user: prompt, schema: MessageGenerationSchema, effort: "medium" },
  );
  if (data.variants.length < 3) throw new ApiError(502, "ai_incomplete", "AI вернул меньше трёх вариантов. Повторите генерацию.");

  const generationId = randomUUID();
  const created = [];
  for (const v of data.variants.slice(0, 3)) {
    const personalization = v.personalization.map((x) => ({ ...x, sourceDbId: refToId(ctx.sourceMap, x.sourceId) }));
    const msg = await prisma.aIMessage.create({
      data: {
        clientId,
        contactId: p.contactId ?? null,
        generationId,
        variantKey: v.id,
        label: v.label,
        channel: p.channel,
        language: data.language || lang,
        tone: p.tone,
        goal: p.goal,
        service: p.service,
        length: p.length,
        instructions: p.instructions ?? "",
        subject: p.channel === "email" ? v.subject : "",
        body: v.body,
        personalization: personalization as Prisma.InputJsonValue,
        assumptions: v.assumptions,
        warnings: v.warnings,
        evidence: { serviceRationale: data.serviceRationale, toVerify: data.toVerify },
        model,
        promptVersion: PROMPTS.message.version,
        versions: { create: { version: 1, subject: p.channel === "email" ? v.subject : "", body: v.body, origin: "generated" } },
      },
    });
    created.push(msg);
  }
  await logInteraction(clientId, "message_generated", `Сгенерировано 3 варианта (${CHANNELS[p.channel]}, ${serviceLabel})`, user, { generationId });
  return { generationId, messages: created, serviceRationale: data.serviceRationale, toVerify: data.toVerify };
}

// ---------- Переписывание текста или выделенного фрагмента ----------
export async function rewriteMessage(
  user: CurrentUser,
  messageId: string,
  p: { command: RewriteCommand; body: string; subject?: string; selection?: { start: number; end: number } | null; tone?: keyof typeof TONES; targetLanguage?: string; instruction?: string },
) {
  const msg = await prisma.aIMessage.findUniqueOrThrow({ where: { id: messageId } });
  const body = p.body;
  const sel = p.selection && p.selection.end > p.selection.start ? p.selection : null;
  if (sel && (sel.start < 0 || sel.end > body.length)) throw new ApiError(400, "bad_selection", "Выделение выходит за пределы текста");
  const fragment = sel ? body.slice(sel.start, sel.end) : body;

  let command = REWRITE_COMMANDS[p.command] as string;
  if (p.command === "change_tone" && p.tone) command += ` → ${TONES[p.tone]}`;
  if (p.command === "translate") command += ` на язык: ${p.targetLanguage || "en"}`;
  if (p.command === "regenerate") command = "Напиши этот фрагмент заново другими словами, сохранив смысл и факты";

  const ctx = await buildClientContext(msg.clientId, user.id);
  const prompt = `Команда: ${command}
${p.instruction ? `<user_instructions>${sanitizeExternal(p.instruction, 1000)}</user_instructions>\n` : ""}Канал: ${msg.channel}; язык сообщения: ${msg.language}.
${sel ? "Перепиши ТОЛЬКО фрагмент; он будет вставлен обратно в текст." : "Перепиши весь текст."}

<full_message>
${sanitizeExternal(body, 8000)}
</full_message>

<fragment_to_rewrite>
${sanitizeExternal(fragment, 8000)}
</fragment_to_rewrite>

Контекст клиента (для проверки фактов):
${ctx.text}`;
  const { data } = await callStructured(
    { userId: user.id, clientId: msg.clientId, operation: `message_rewrite:${p.command}` },
    { system: PROMPTS.rewrite.system, user: prompt, schema: RewriteSchema, effort: "low", maxTokens: 8000 },
  );
  const newBody = sel ? body.slice(0, sel.start) + data.text + body.slice(sel.end) : data.text;
  const version = msg.version + 1;
  const updated = await prisma.aIMessage.update({
    where: { id: messageId },
    data: {
      body: newBody,
      subject: p.subject ?? msg.subject,
      version,
      language: p.command === "translate" && !sel ? p.targetLanguage || msg.language : msg.language,
      versions: { create: { version, subject: p.subject ?? msg.subject, body: newBody, origin: "rewrite", note: `${REWRITE_COMMANDS[p.command]}${sel ? " (фрагмент)" : ""}: ${data.note}`.slice(0, 300) } },
    },
  });
  return { message: updated, note: data.note, replaced: sel ? { start: sel.start, end: sel.start + data.text.length } : null };
}

// ---------- AI Copilot ----------
export async function copilotAsk(user: CurrentUser, clientId: string, question: string) {
  const ctx = await buildClientContext(clientId, user.id, { includeHistory: true });
  const history = await prisma.copilotMessage.findMany({ where: { clientId, userId: user.id }, orderBy: { createdAt: "desc" }, take: 10 });
  const msgs = history.reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  // Первое сообщение должно быть от пользователя
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  const { text } = await callText(
    { userId: user.id, clientId, operation: "copilot" },
    {
      system: `${PROMPTS.copilot.system}\n\nКонтекст открытого клиента:\n${ctx.text}`,
      messages: [...msgs, { role: "user", content: question }],
      effort: "low",
    },
  );
  await prisma.copilotMessage.createMany({
    data: [
      { clientId, userId: user.id, role: "user", content: question },
      { clientId, userId: user.id, role: "assistant", content: text },
    ],
  });
  return { answer: text };
}

// ---------- Черновик КП ----------
export async function draftProposal(user: CurrentUser, clientId: string, p: { service: keyof typeof SERVICES; notes?: string }) {
  const ctx = await buildClientContext(clientId, user.id, { includeHistory: true });
  const prompt = `Услуга: ${SERVICES[p.service]}
${p.notes ? `<user_instructions>\n${sanitizeExternal(p.notes, 3000)}\n</user_instructions>\n(Цены/сроки из этих пожеланий пользователя можно использовать.)` : ""}

${ctx.text}`;
  const { data, model } = await callStructured(
    { userId: user.id, clientId, operation: "proposal_draft" },
    { system: PROMPTS.proposal.system, user: prompt, schema: ProposalDraftSchema, effort: "medium" },
  );
  return { ...data, model, promptVersion: PROMPTS.proposal.version };
}

// ---------- Черновик ответа на входящее ----------
export async function draftReply(user: CurrentUser, clientId: string, conversationId: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, clientId },
    include: { items: { orderBy: { createdAt: "desc" }, take: 1, where: { direction: "inbound" } } },
  });
  if (!conv || !conv.items[0]) throw new ApiError(404, "no_inbound", "Нет входящего сообщения для ответа");
  const ctx = await buildClientContext(clientId, user.id, { includeHistory: true });
  const prompt = `Канал: ${conv.channel}. Подготовь ответ на последнее входящее сообщение клиента.
<external_data>
<inbound>${sanitizeExternal(conv.items[0].body, 4000)}</inbound>
</external_data>

${ctx.text}`;
  const { data } = await callStructured(
    { userId: user.id, clientId, operation: "reply_draft" },
    { system: PROMPTS.reply.system, user: prompt, schema: ReplyDraftSchema, effort: "low", maxTokens: 8000 },
  );
  return data;
}

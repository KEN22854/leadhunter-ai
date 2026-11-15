import "server-only";
import type { Prisma, SignalCampaign } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../api";
import type { CurrentUser } from "../auth";
import { callStructured, isAIConfigured } from "../ai/provider";
import { PROMPTS } from "../ai/prompts";
import { SignalIntentSchema } from "../ai/schemas";
import { ADAPTERS, buildQueries, sourceReadiness, type FetchCtx, type RawPost } from "./adapters";
import { SOURCE_MAP, manualSearchUrl } from "./catalog";
import { classifyIntent, detectLanguage, extractBudget, matchService, normalizeText, temperatureOf, termRegex, type IntentResult } from "./classify";
import { SourceError } from "./http";
import { extractPublicContacts, identitiesFor } from "./identity";
import { LANG_KEYS, SIGNAL_SERVICES, type IntentKey, type Lang } from "./lexicon";
import { ageDays, scoreSignal } from "./scoring";
import { ingestSignal } from "./store";

// Движок поисковых кампаний: опрос источников → фильтрация → намерение (правила + AI) → скоринг →
// дедупликация и сохранение. Ошибки одного источника не останавливают кампанию.

export type SourceRunStat = { status: "ok" | "error" | "skipped" | "manual"; fetched: number; matched: number; saved: number; duplicates: number; filtered: Record<string, number>; error?: string; attempts?: number; links?: { query: string; url: string }[] };

type Candidate = { post: RawPost; source: string; text: string; lang: Lang; intent: IntentResult; svc: ReturnType<typeof matchService>; ai?: { intent: IntentKey; confidence: number; serviceFit: number; reason: string } };

export function campaignCtx(c: SignalCampaign): FetchCtx {
  const ch = (c.channels as { telegram?: string[]; reddit?: string[]; discord?: string[] } | null) ?? {};
  return {
    service: c.service,
    languages: ((c.languages as string[]) ?? ["ru"]).filter((l): l is Lang => (LANG_KEYS as string[]).includes(l)),
    keywords: (c.keywords as string[]) ?? [],
    businessType: c.businessType,
    country: c.country,
    city: c.city,
    since: new Date(Date.now() - c.periodDays * 86_400_000),
    limit: c.maxResults || 100, // размер выборки на запрос к источнику
    channels: { telegram: ch.telegram ?? [], reddit: ch.reddit ?? [], discord: ch.discord ?? [] },
    feeds: (c.feeds as string[] | null) ?? [],
  };
}

export function nextRunAt(schedule: string, from = new Date()) {
  if (schedule === "daily") return new Date(from.getTime() + 86_400_000);
  if (schedule === "weekly") return new Date(from.getTime() + 7 * 86_400_000);
  return null;
}

/** Предварительная оценка публикации правилами. null — отфильтрована (причина в filtered). */
export function evaluatePost(
  post: RawPost,
  source: string,
  c: Pick<SignalCampaign, "service" | "orderType" | "businessType" | "city" | "country"> & { languages: Lang[]; keywords: string[]; exclude: string[] },
): { cand?: Candidate; reason?: string } {
  const text = `${post.title}\n${post.text}`.trim();
  const meta = SOURCE_MAP[source];
  const lang = detectLanguage(text);
  const t = normalizeText(text);
  if (c.exclude.some((w) => w.trim().length >= 2 && termRegex(w).test(t))) return { reason: "стоп-слова" };
  if (!post.listing && c.languages.length && !c.languages.includes(lang)) return { reason: "язык" };
  const svc = post.listing
    ? { score: c.service === "website" && !post.website ? 70 : 35, matched: [post.website ? "есть сайт" : "нет сайта"], userMatched: [] }
    : matchService(text, c.service, c.keywords, post.title);
  // Запуск продукта (Product Hunt, Crunchbase) — потенциальный клиент для любых услуг, даже без упоминания
  if (meta?.kind === "launch" && svc.score < 40) {
    svc.score = 40;
    svc.matched = [...svc.matched, "новый проект"];
  }
  if (!post.listing && svc.score < 20) return { reason: svc.offRole ? "другая роль" : "не по услуге" };
  const intent = post.listing
    ? { intent: "interest" as IntentKey, confidence: 30, commercial: true, reasons: ["Компания из каталога: явного запроса нет, потенциальный клиент"], concrete: [], negatives: [] }
    : classifyIntent(text, { lang, sourceKind: meta?.kind });
  if (c.orderType === "ongoing" && intent.intent !== "ongoing" && !/постоян|long[- ]term|ongoing|retainer/i.test(t)) return { reason: "тип заказа" };
  if (c.orderType === "launch" && intent.intent !== "launch") return { reason: "тип заказа" };
  if (c.orderType === "one_time" && intent.intent === "ongoing") return { reason: "тип заказа" };
  return { cand: { post, source, text, lang, intent, svc } };
}

function scoreCandidate(cand: Candidate, c: Pick<SignalCampaign, "city" | "country" | "businessType"> & { languages: Lang[] }) {
  const { post, source, text } = cand;
  const meta = SOURCE_MAP[source];
  const ai = cand.ai;
  let intent = cand.intent.intent;
  let confidence = cand.intent.confidence;
  let serviceMatch = cand.svc.score;
  const reasons = [...cand.intent.reasons];
  if (ai) {
    reasons.unshift(`AI: ${ai.reason}`);
    // AI уточняет правила: при уверенном расхождении побеждает AI, иначе — среднее
    if (ai.confidence >= 70 || ai.intent === intent) {
      intent = ai.intent;
      confidence = Math.round(ai.intent === cand.intent.intent ? Math.max(confidence, ai.confidence) : ai.confidence);
    } else confidence = Math.round((confidence + ai.confidence) / 2);
    serviceMatch = Math.round((serviceMatch + ai.serviceFit) / 2);
  }
  const contacts = extractPublicContacts(text);
  const budget = post.budget || extractBudget(text);
  const t = normalizeText(text);
  const geoMatch = c.city || c.country ? [c.city, c.country].filter(Boolean).some((g) => termRegex(g).test(t)) || (post.city ? normalizeText(post.city) === normalizeText(c.city) : false) : null;
  const businessMatch = c.businessType ? termRegex(c.businessType).test(t) : null;
  const s = scoreSignal({
    intent,
    confidence,
    serviceMatch,
    matchedTerms: [...cand.svc.userMatched, ...cand.svc.matched],
    concrete: cand.intent.concrete,
    budget,
    publishedAt: post.publishedAt,
    source,
    contact: { email: contacts.emails.length > 0, phone: contacts.phones.length > 0 || Boolean(post.phone), profile: Boolean(post.authorUrl), platformReply: (meta?.reply ?? []).includes("platform_reply") },
    audience: { languageOk: !c.languages.length || c.languages.includes(cand.lang), geoMatch, businessMatch },
  });
  const temperature = temperatureOf({ intent, confidence, serviceMatch, ageDays: ageDays(post.publishedAt), sourceKind: post.listing ? "directory" : meta?.kind });
  return { intent, confidence, serviceMatch, reasons, budget, contacts, score: s, temperature };
}

async function aiClassify(userId: string, service: string, cands: Candidate[]) {
  const def = SIGNAL_SERVICES[service];
  const items = cands.map((c, i) => ({ id: `p${i}`, source: SOURCE_MAP[c.source]?.label ?? c.source, text: c.text.slice(0, 1200) }));
  const { data } = await callStructured(
    { userId, operation: "signals.intent" },
    {
      system: PROMPTS.signalIntent.system,
      user: `Услуга исполнителя: ${def?.label ?? service}.\n<external_data>\n${JSON.stringify(items)}\n</external_data>\nВерни классификацию для каждого id.`,
      schema: SignalIntentSchema,
      effort: "low",
      maxTokens: 6000,
      timeoutMs: 180_000,
    },
  );
  for (const it of data.items) {
    const idx = Number(it.id.slice(1));
    if (cands[idx]) cands[idx].ai = { intent: it.intent, confidence: it.confidence, serviceFit: it.serviceFit, reason: it.reason };
  }
}

async function fetchWithRetry(key: string, ctx: FetchCtx, stat: SourceRunStat) {
  const adapter = ADAPTERS[key];
  for (let attempt = 1; attempt <= 3; attempt++) {
    stat.attempts = attempt;
    try {
      return await adapter.fetch(ctx);
    } catch (e) {
      const transient = e instanceof SourceError ? e.transient : true;
      if (!transient || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, attempt * 4000));
    }
  }
  return [];
}

const running = new Set<string>();

export async function runCampaign(campaignId: string, trigger: "manual" | "schedule" | "retry" = "manual", onlySources?: string[]) {
  if (running.has(campaignId)) throw new ApiError(409, "already_running", "Кампания уже выполняется");
  running.add(campaignId);
  const c = await prisma.signalCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  const run = await prisma.signalRun.create({ data: { campaignId, trigger } });
  const stats: Record<string, SourceRunStat> = {};
  const ctx = campaignCtx(c);
  const filterCfg = { service: c.service, orderType: c.orderType, businessType: c.businessType, city: c.city, country: c.country, languages: ctx.languages, keywords: ctx.keywords, exclude: (c.excludeWords as string[] | null) ?? [] };
  let aiNote = "";
  try {
    const sources = ((c.sources as string[]) ?? []).filter((s) => !onlySources || onlySources.includes(s));
    const cands: Candidate[] = [];
    for (const key of sources) {
      const st: SourceRunStat = { status: "ok", fetched: 0, matched: 0, saved: 0, duplicates: 0, filtered: {} };
      stats[key] = st;
      const ready = sourceReadiness(key);
      if (!ready.ready) {
        const meta = SOURCE_MAP[key];
        st.status = meta?.access === "manual" ? "manual" : "skipped";
        st.error = ready.reason;
        if (meta?.searchUrl) st.links = buildQueries(ctx, undefined, 4).map((q) => ({ query: q, url: manualSearchUrl(key, q)! }));
        continue;
      }
      try {
        const posts = await fetchWithRetry(key, ctx, st);
        st.fetched = posts.length;
        const seen = new Set<string>();
        for (const p of posts) {
          if (seen.has(p.externalId)) continue;
          seen.add(p.externalId);
          const r = evaluatePost(p, key, filterCfg);
          if (!r.cand) {
            st.filtered[r.reason!] = (st.filtered[r.reason!] ?? 0) + 1;
            continue;
          }
          st.matched++;
          cands.push(r.cand);
        }
      } catch (e) {
        st.status = "error";
        st.error = e instanceof Error ? e.message : String(e);
      }
    }

    // AI-уточнение намерений для самых перспективных кандидатов (если включено и AI доступен)
    if (c.useAI && cands.length) {
      if (await isAIConfigured()) {
        const pick = cands
          .filter((x) => !x.post.listing)
          .sort((a, b) => b.intent.confidence + b.svc.score - (a.intent.confidence + a.svc.score))
          .slice(0, 45);
        try {
          for (let i = 0; i < pick.length; i += 15) await aiClassify(c.ownerId, c.service, pick.slice(i, i + 15));
          aiNote = `AI уточнил намерение для ${pick.filter((x) => x.ai).length} публикаций`;
        } catch (e) {
          aiNote = `AI недоступен, использованы правила: ${e instanceof Error ? e.message : e}`;
        }
      } else aiNote = "AI не подключён — намерения определены правилами";
    }

    let saved = 0;
    let newLeads = 0;
    const scored = cands.map((cand) => ({ cand, r: scoreCandidate(cand, { city: c.city, country: c.country, businessType: c.businessType, languages: ctx.languages }) })).sort((a, b) => b.r.score.score - a.r.score.score);
    for (const { cand, r } of scored) {
      const st = stats[cand.source];
      if (r.score.score < c.minScore) {
        st.filtered["ниже мин. score"] = (st.filtered["ниже мин. score"] ?? 0) + 1;
        continue;
      }
      if (c.maxResults && saved >= c.maxResults) {
        st.filtered["лимит результатов"] = (st.filtered["лимит результатов"] ?? 0) + 1;
        continue;
      }
      const p = cand.post;
      const ids = identitiesFor({ source: cand.source, authorId: p.authorId, authorUrl: p.authorUrl, externalId: p.externalId, emails: r.contacts.emails, phones: [...r.contacts.phones, ...(p.phone ? [p.phone] : [])], domains: r.contacts.domains, website: p.website });
      const res = await ingestSignal({
        ownerId: c.ownerId,
        campaignId: c.id,
        runId: run.id,
        source: cand.source,
        externalId: p.externalId,
        url: p.url,
        title: p.title,
        text: p.text,
        authorName: p.authorName ?? "",
        authorUrl: p.authorUrl,
        headline: p.headline,
        publishedAt: p.publishedAt,
        language: cand.lang,
        budget: r.budget,
        matchedTerms: [...cand.svc.userMatched, ...cand.svc.matched],
        intent: r.intent,
        intentScore: r.confidence,
        intentReasons: r.reasons,
        aiIntent: cand.ai,
        serviceMatch: r.serviceMatch,
        score: r.score.score,
        scoreFactors: r.score.factors,
        temperature: r.temperature,
        identities: ids,
        service: c.service,
        country: c.country,
        city: p.city ?? (r.score.factors.find((f) => f.key === "audience")?.reason.includes("гео совпадает") ? c.city : ""),
        basis: p.listing || SOURCE_MAP[cand.source]?.kind === "launch" ? "legitimate_interest" : "published_request",
      });
      if (res.status === "duplicate") st.duplicates++;
      else if (res.status === "dnc") st.filtered["Do Not Contact"] = (st.filtered["Do Not Contact"] ?? 0) + 1;
      else {
        st.saved++;
        saved++;
        if (res.status === "new") newLeads++;
      }
    }
    const errors = Object.entries(stats).filter(([, s]) => s.status === "error");
    const okCount = Object.values(stats).filter((s) => s.status === "ok").length;
    const status = errors.length && !okCount ? "failed" : errors.length ? "partial" : "done";
    await prisma.signalRun.update({
      where: { id: run.id },
      data: {
        status,
        stats: { sources: stats, ai: aiNote } as unknown as Prisma.InputJsonValue,
        fetched: Object.values(stats).reduce((s, x) => s + x.fetched, 0),
        matched: cands.length,
        saved,
        newLeads,
        error: errors.map(([k, s]) => `${SOURCE_MAP[k]?.label ?? k}: ${s.error}`).join("; ").slice(0, 1000),
        finishedAt: new Date(),
      },
    });
    await prisma.signalCampaign.update({ where: { id: c.id }, data: { lastRunAt: new Date(), nextRunAt: c.status === "active" ? nextRunAt(c.schedule) : null } });
    return prisma.signalRun.findUniqueOrThrow({ where: { id: run.id } });
  } catch (e) {
    await prisma.signalRun.update({ where: { id: run.id }, data: { status: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: new Date(), stats: { sources: stats, ai: aiNote } as unknown as Prisma.InputJsonValue } });
    throw e;
  } finally {
    running.delete(campaignId);
  }
}

export function isRunning(campaignId: string) {
  return running.has(campaignId);
}

/** Запуск в фоне из API: ответ сразу, результат — в SignalRun. */
export function startCampaignRun(user: CurrentUser, campaignId: string, onlySources?: string[]) {
  if (running.has(campaignId)) throw new ApiError(409, "already_running", "Кампания уже выполняется");
  void runCampaign(campaignId, onlySources ? "retry" : "manual", onlySources).catch((e) => console.error("[signals] run failed", campaignId, e));
  return { started: true, by: user.id };
}

/**
 * Ручное добавление публикации (для площадок без разрешённого API: LinkedIn, Facebook, Upwork…).
 * Проходит тот же анализ намерения, скоринг и дедупликацию; фильтры кампании не применяются.
 */
export async function addManualSignal(
  user: CurrentUser,
  p: { source: string; url: string; text: string; title?: string; authorName?: string; authorUrl?: string; publishedAt?: Date | null; service: string; country?: string; city?: string; languages?: Lang[] },
) {
  const post: RawPost = {
    externalId: p.url,
    url: p.url,
    title: p.title || p.text.split("\n")[0].slice(0, 140),
    text: p.text,
    authorName: p.authorName || "Автор публикации",
    authorUrl: p.authorUrl || undefined,
    publishedAt: p.publishedAt ?? null,
  };
  const source = SOURCE_MAP[p.source] ? p.source : "manual";
  const langs = p.languages ?? [];
  const r0 = evaluatePost(post, source, { service: p.service, orderType: "any", businessType: "", city: p.city ?? "", country: p.country ?? "", languages: [], keywords: [], exclude: [] });
  const lang = detectLanguage(post.text);
  const cand: Candidate = r0.cand ?? { post, source, text: `${post.title}\n${post.text}`, lang, intent: classifyIntent(post.text, { lang, sourceKind: SOURCE_MAP[source]?.kind }), svc: { score: 0, matched: [], userMatched: [] } };
  const r = scoreCandidate(cand, { city: p.city ?? "", country: p.country ?? "", businessType: "", languages: langs });
  const ids = identitiesFor({ source, authorUrl: post.authorUrl, externalId: post.externalId, emails: r.contacts.emails, phones: r.contacts.phones, domains: r.contacts.domains });
  const res = await ingestSignal({
    ownerId: user.id,
    campaignId: null,
    runId: null,
    source,
    externalId: post.externalId,
    url: post.url,
    title: post.title,
    text: post.text,
    authorName: post.authorName!,
    authorUrl: post.authorUrl,
    publishedAt: post.publishedAt,
    language: cand.lang,
    budget: r.budget,
    matchedTerms: [...cand.svc.userMatched, ...cand.svc.matched],
    intent: r.intent,
    intentScore: r.confidence,
    intentReasons: [...r.reasons, ...(r0.reason ? [`Предупреждение: ${r0.reason}`] : [])],
    serviceMatch: r.serviceMatch,
    score: r.score.score,
    scoreFactors: r.score.factors,
    temperature: r.temperature,
    identities: ids,
    service: p.service,
    country: p.country,
    city: p.city,
    basis: "published_request",
  });
  if (res.status === "dnc") throw new ApiError(409, "dnc", "Автор публикации в списке Do Not Contact — добавление запрещено");
  return { ...res, score: r.score, intent: r.intent };
}

/** Фоновый мониторинг: запуск кампаний по расписанию (ежедневно/еженедельно). */
export async function processDueCampaigns() {
  const due = await prisma.signalCampaign.findMany({ where: { status: "active", schedule: { in: ["daily", "weekly"] }, nextRunAt: { lte: new Date() } }, take: 3 });
  let started = 0;
  for (const c of due) {
    if (running.has(c.id)) continue;
    // Сдвигаем срок заранее, чтобы падение не вызывало бесконечных перезапусков
    await prisma.signalCampaign.update({ where: { id: c.id }, data: { nextRunAt: nextRunAt(c.schedule) } });
    await runCampaign(c.id, "schedule").catch((e) => console.error("[signals] scheduled run failed", c.id, e));
    started++;
  }
  return { due: due.length, started };
}

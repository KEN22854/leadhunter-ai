import { SOURCE_MAP } from "./catalog";
import { INTENTS, type IntentKey } from "./lexicon";

// Объяснимый Lead Score для лидов из соцсетей/бирж: 7 факторов, сумма максимумов = 100.

export type SignalFactor = { key: string; label: string; points: number; max: number; reason: string };
export type SignalScore = { score: number; factors: SignalFactor[]; explanation: string };

export type ScoreInput = {
  intent: IntentKey;
  confidence: number;
  serviceMatch: number;
  matchedTerms: string[];
  concrete: string[];
  budget: string;
  publishedAt: Date | null;
  source: string;
  contact: { email: boolean; phone: boolean; profile: boolean; platformReply: boolean };
  audience: { languageOk: boolean; geoMatch: boolean | null; businessMatch: boolean | null };
  now?: Date;
};

const INTENT_WEIGHT: Record<IntentKey, number> = { order: 1, hire: 0.9, ongoing: 0.9, recommendation: 0.75, partner: 0.6, launch: 0.55, interest: 0.6, none: 0 };

export function ageDays(publishedAt: Date | null, now = new Date()) {
  return publishedAt ? Math.max(0, (now.getTime() - publishedAt.getTime()) / 86_400_000) : null;
}

export function scoreSignal(p: ScoreInput): SignalScore {
  const f: SignalFactor[] = [];
  const now = p.now ?? new Date();

  const intentPts = Math.round(25 * INTENT_WEIGHT[p.intent] * (p.confidence / 100));
  f.push({ key: "intent", label: "Актуальность запроса", max: 25, points: intentPts, reason: p.intent === "none" ? "Нет признаков намерения заказать" : `${INTENTS[p.intent].label}, уверенность ${p.confidence}%` });

  const svc = Math.round((20 * p.serviceMatch) / 100);
  f.push({ key: "service", label: "Соответствие услуге", max: 20, points: svc, reason: p.matchedTerms.length ? `Совпадения: ${p.matchedTerms.slice(0, 5).join(", ")}` : "Совпадений с услугой не найдено" });

  let conc = 0;
  if (p.intent === "order") conc += 6;
  if (p.budget) conc += 4;
  conc += Math.min(5, p.concrete.filter((c) => !/бюджет/i.test(c)).length * 3);
  conc = Math.min(15, conc);
  f.push({ key: "concrete", label: "Наличие конкретного проекта", max: 15, points: conc, reason: [p.budget && `бюджет: ${p.budget}`, ...p.concrete].filter(Boolean).join("; ") || "Деталей проекта нет" });

  const age = ageDays(p.publishedAt, now);
  const fresh = age === null ? 5 : age <= 1 ? 15 : age <= 3 ? 12 : age <= 7 ? 9 : age <= 14 ? 6 : age <= 30 ? 3 : 0;
  f.push({ key: "freshness", label: "Свежесть публикации", max: 15, points: fresh, reason: age === null ? "Дата публикации неизвестна" : age < 1 ? "Опубликовано сегодня" : `${Math.round(age)} дн. назад` });

  const q = SOURCE_MAP[p.source]?.quality ?? 5;
  f.push({ key: "source", label: "Качество источника", max: 10, points: q, reason: `${SOURCE_MAP[p.source]?.label ?? p.source}: ${q}/10` });

  const c = p.contact;
  const contactPts = c.email || c.platformReply ? 10 : c.phone ? 8 : c.profile ? 7 : 4;
  f.push({
    key: "contact",
    label: "Достоверность контактов",
    max: 10,
    points: contactPts,
    reason: c.platformReply ? "Ответ через механизм площадки" : c.email ? "Email опубликован автором" : c.phone ? "Телефон опубликован автором" : c.profile ? "Публичный профиль автора" : "Только ссылка на публикацию",
  });

  let aud = p.audience.languageOk ? 3 : 0;
  if (p.audience.geoMatch === true) aud += 1;
  if (p.audience.businessMatch === true) aud += 1;
  if (p.audience.geoMatch === null && p.audience.businessMatch === null && p.audience.languageOk) aud = 5;
  f.push({
    key: "audience",
    label: "Соответствие ЦА",
    max: 5,
    points: Math.min(5, aud),
    reason: [p.audience.languageOk ? "язык подходит" : "другой язык", p.audience.geoMatch === true ? "гео совпадает" : p.audience.geoMatch === false ? "гео не указано/не совпадает" : null, p.audience.businessMatch === true ? "тип бизнеса совпадает" : p.audience.businessMatch === false ? "тип бизнеса не найден" : null]
      .filter(Boolean)
      .join(", "),
  });

  // Без коммерческого намерения итог ограничен: высокое качество площадки не делает обсуждение лидом
  let score = f.reduce((s, x) => s + x.points, 0);
  if (p.intent === "none") score = Math.min(score, 25);
  const top = [...f].sort((a, b) => b.points / b.max - a.points / a.max);
  const explanation = `${score}/100. Сильнее всего: ${top.slice(0, 2).map((x) => x.label.toLowerCase()).join(", ")}. Слабее всего: ${top.at(-1)!.label.toLowerCase()} (${top.at(-1)!.reason}).`;
  return { score: Math.max(0, Math.min(100, score)), factors: f, explanation };
}

/** Итог по лиду = лучшая публикация + бонус за повторные запросы (до +9). */
export function combineLeadScore(signalScores: number[]) {
  if (!signalScores.length) return 0;
  const best = Math.max(...signalScores);
  return Math.min(100, best + Math.min(9, (signalScores.length - 1) * 3));
}

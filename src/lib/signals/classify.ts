import { CONCRETE_PATTERNS, INTENTS, INTENT_PATTERNS, LANG_KEYS, NEGATIVE_PATTERNS, SIGNAL_SERVICES, type IntentKey, type Lang } from "./lexicon";

// Rule-based анализ публикаций: язык, соответствие услуге (термины + синонимы + пользовательские ключи),
// намерение автора с объяснением, признаки конкретного заказа, температура лида.
// AI-классификация (если доступна) уточняет результат поверх этих правил — см. engine.ts.

export function normalizeText(s: string) {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeEntities(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

const STOP: Record<Exclude<Lang, "ru">, string[]> = {
  en: ["the", "and", "for", "with", "you", "looking", "need", "is", "are", "my", "our", "this", "that", "have"],
  de: ["der", "die", "das", "und", "ich", "wir", "suche", "nicht", "für", "eine", "einen", "mit", "ist"],
  fr: ["le", "la", "les", "et", "je", "nous", "cherche", "pour", "une", "des", "avec", "est", "un"],
  es: ["el", "la", "los", "y", "busco", "para", "una", "que", "necesito", "con", "es", "un", "por"],
};

export function detectLanguage(text: string): Lang {
  const t = normalizeText(text);
  const cyr = (t.match(/[а-я]/g) ?? []).length;
  const lat = (t.match(/[a-z]/g) ?? []).length;
  if (cyr > lat * 0.5) return "ru";
  const words = t.split(/[^\p{L}']+/u);
  let best: Lang = "en";
  let bestN = 0;
  for (const [lang, list] of Object.entries(STOP) as [Exclude<Lang, "ru">, string[]][]) {
    const set = new Set(list);
    const n = words.filter((w) => set.has(w)).length;
    if (n > bestN) {
      best = lang;
      bestN = n;
    }
  }
  if (/[äöüß]/.test(t) && best === "en") return "de";
  if (/[ñ¿¡]/.test(t) && best === "en") return "es";
  return best;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Совпадение термина: длинные термины — как начало слова (покрывает словоформы), короткие — целым словом. */
export function termRegex(term: string) {
  const t = normalizeText(term).trim();
  const body = escapeRe(t).replace(/\s+/g, "\\s+");
  return t.replace(/[^\p{L}]/gu, "").length >= 4 ? new RegExp(`(^|[^\\p{L}])${body}`, "u") : new RegExp(`(^|[^\\p{L}])${body}($|[^\\p{L}])`, "u");
}

export type ServiceMatch = { score: number; matched: string[]; userMatched: string[]; offRole?: string };

/** Роли, которые часто встречаются рядом со словами «сайт/дизайн», но не являются заказом этих услуг */
const OFF_ROLES = [
  "sales", "closer", "appointment setter", "cold call", "telemarket", "data entry", "virtual assistant", "translator", "translation", "transcription",
  "accountant", "bookkeep", "recruiter", "guest post", "link building", "backlink", "lead generation", "customer support", "call center", "tutor",
  "менеджер по продажам", "продажник", "оператор", "колл-центр", "лидогенерац", "переводчик", "перевод текст", "бухгалтер", "рекрутер", "набор текста",
  "наполнение", "модератор", "отзывы", "диспетчер", "писать клиентам", "холодн",
];

const termsOf = (service: string) => {
  const def = SIGNAL_SERVICES[service];
  return def ? LANG_KEYS.flatMap((l) => def.terms[l] ?? []).map((x) => x.trim()) : [];
};

/**
 * Насколько публикация относится к услуге, 0–100. Термины услуги на всех языках (со словоформами) и ключи
 * пользователя; совпадение в заголовке весит больше, одиночное упоминание в длинном тексте — слабый сигнал.
 * Если заголовок называет другую роль (продажи, перевод, ввод данных…), а услуги в нём нет — сильный штраф.
 */
export function matchService(text: string, service: string, userKeywords: string[] = [], title = ""): ServiceMatch {
  const t = normalizeText(text);
  const tt = normalizeText(title);
  const terms = [...new Set(termsOf(service))];
  const inTitle = new Set(tt ? terms.filter((x) => termRegex(x).test(tt)) : []);
  const inBody = new Set(terms.filter((x) => termRegex(x).test(t)));
  const userMatched = userKeywords.map((k) => k.trim()).filter((k) => k.length >= 2 && termRegex(k).test(t));
  let score: number;
  if (!tt) score = inBody.size ? 45 + (inBody.size - 1) * 15 : 0;
  else if (inTitle.size) score = 60 + (inTitle.size - 1) * 15 + Math.min(20, (inBody.size - inTitle.size) * 5);
  else score = inBody.size >= 2 ? 30 + (inBody.size - 2) * 10 : inBody.size * 15;
  if (userMatched.length) score += 40 + (userMatched.length - 1) * 10;
  const offRole = tt ? OFF_ROLES.find((r) => termRegex(r).test(tt)) : undefined;
  if (offRole) score -= 45;
  return { score: Math.max(0, Math.min(100, score)), matched: [...inBody], userMatched, offRole };
}

export type IntentResult = {
  intent: IntentKey;
  confidence: number; // 0–100
  commercial: boolean;
  reasons: string[];
  concrete: string[];
  negatives: string[];
};

/**
 * Классификация намерения автора. Учитывает: шаблоны запроса на языке публикации и английском,
 * признаки самопрезентации исполнителя (снижают), конкретику (бюджет/сроки/ТЗ), тип площадки.
 * kind=freelance: публикация с биржи — это заказ по определению (если не заблокирована негативом).
 */
export function classifyIntent(text: string, opts: { lang?: Lang; sourceKind?: string } = {}): IntentResult {
  const t = normalizeText(text);
  const lang = opts.lang ?? detectLanguage(text);
  const langs: Lang[] = lang === "en" ? ["en"] : [lang, "en"];
  const hits: Partial<Record<IntentKey, string[]>> = {};
  for (const l of langs) {
    for (const [k, arr] of Object.entries(INTENT_PATTERNS[l] ?? {}) as [IntentKey, RegExp[]][]) {
      for (const r of arr) {
        const m = t.match(r);
        if (m) (hits[k] ??= []).push(m[0].trim().slice(0, 60));
      }
    }
  }
  const negatives: string[] = [];
  for (const l of langs) for (const n of NEGATIVE_PATTERNS[l] ?? []) if (n.re.test(t)) negatives.push(n.reason);
  const concrete = CONCRETE_PATTERNS.filter((c) => c.re.test(t)).map((c) => c.reason);
  if (t.length > 350) concrete.push("Подробное описание задачи");

  const reasons: string[] = [];
  const weight: Partial<Record<IntentKey, number>> = {};
  const base: Record<string, number> = { hire: 70, ongoing: 55, recommendation: 60, partner: 60, launch: 50, interest: 50 };
  for (const [k, list] of Object.entries(hits) as [IntentKey, string[]][]) {
    weight[k] = base[k] + Math.min(20, (list.length - 1) * 10);
    reasons.push(`«${list[0]}» — ${INTENTS[k].label.toLowerCase()}`);
  }
  const isFreelance = opts.sourceKind === "freelance";
  if (isFreelance) {
    weight.order = Math.max(weight.order ?? 0, 75);
    reasons.push("Публикация размещена на бирже как заказ");
  }
  if (opts.sourceKind === "jobs") {
    weight.hire = Math.max(weight.hire ?? 0, 70);
    reasons.push("Вакансия/заказ на площадке для найма");
  }
  // Постоянная основа — уточнение запроса исполнителя
  if (weight.ongoing && (weight.hire || weight.order)) {
    weight.ongoing = Math.max(weight.ongoing, (weight.hire ?? weight.order ?? 0) + 5);
  }
  // Конкретный заказ = запрос исполнителя + конкретика
  if ((weight.hire || isFreelance) && concrete.length) {
    weight.order = Math.max(weight.order ?? 0, (weight.hire ?? 70) + 5 + concrete.length * 5);
    reasons.push(...concrete.map((c) => `${c} — признак конкретного заказа`));
  }

  let intent: IntentKey = "none";
  let confidence = 0;
  for (const [k, w] of Object.entries(weight) as [IntentKey, number][]) {
    if (w > confidence) {
      intent = k;
      confidence = w;
    }
  }
  if (negatives.length) {
    // Самопрезентация исполнителя почти всегда означает «не заказ», если нет явного «ищу исполнителя»
    const strongHire = (hits.hire?.length ?? 0) >= 2 || isFreelance;
    confidence -= strongHire ? 20 : 45;
    reasons.push(...negatives.map((n) => `${n} — снижает уверенность`));
    if (confidence < 35) {
      intent = "none";
    }
  }
  if (intent === "none") {
    if (!reasons.length) reasons.push("Нет фраз запроса исполнителя, рекомендаций или запуска проекта");
    return { intent, confidence: Math.max(0, Math.min(100, negatives.length ? 80 : 60)), commercial: false, reasons, concrete, negatives };
  }
  return { intent, confidence: Math.max(0, Math.min(100, confidence)), commercial: true, reasons, concrete, negatives };
}

/** Бюджет из текста — только то, что написано автором. */
export function extractBudget(text: string): string {
  const t = decodeEntities(text).replace(/<[^>]+>/g, " ");
  const m =
    t.match(/(бюджет|budget|оплата|presupuesto|prix|preis)[\s:—-]{0,4}((до|от|up to|bis|hasta)?\s?[$€£]?\s?\d[\d\s.,]{0,9}\s?(k|к|тыс\.?|000)?\s?(₽|руб\.?|р\.|rub|usd|eur|\$|€|£|долл\.?)?)/i) ??
    t.match(/([$€£]\s?\d[\d\s.,]{0,9}(k)?|\d[\d\s.,]{0,9}\s?(₽|руб\.?|rub|usd|eur|\$|€|£))/i);
  return m ? (m[2] ?? m[0]).trim().replace(/\s+/g, " ").slice(0, 40) : "";
}

export type Temperature = "hot" | "warm" | "potential" | "cold";
export const TEMPERATURES: Record<Temperature, { label: string; hint: string }> = {
  hot: { label: "Горячий", hint: "Конкретный запрос исполнителя по вашей услуге, свежий" },
  warm: { label: "Тёплый", hint: "Ищет исполнителя/рекомендации, но меньше конкретики или совпадения" },
  potential: { label: "Потенциальный", hint: "Запуск проекта, интерес к услуге или компания без явного запроса" },
  cold: { label: "Нет интереса", hint: "Обсуждение темы без намерения заказать" },
};

export function temperatureOf(p: { intent: IntentKey; confidence: number; serviceMatch: number; ageDays: number | null; sourceKind?: string }): Temperature {
  if (p.sourceKind === "directory") return p.serviceMatch >= 0 ? "potential" : "cold";
  if (p.intent === "none") return "cold";
  const fresh = p.ageDays === null || p.ageDays <= 7;
  if ((p.intent === "order" || p.intent === "hire" || p.intent === "ongoing") && p.confidence >= 70 && p.serviceMatch >= 45 && fresh) return "hot";
  if (["order", "hire", "ongoing", "recommendation", "partner"].includes(p.intent) && p.confidence >= 50 && p.serviceMatch >= 30) return "warm";
  return "potential";
}

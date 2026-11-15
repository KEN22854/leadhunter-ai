import { z } from "zod";

// Схемы структурированных ответов модели (JSON Schema через structured outputs).
// Ограничения длины не задаём в схеме — проверяем/обрезаем после разбора.

const confidence = z.enum(["high", "medium", "low"]);
const serviceKey = z.enum(["website", "branding", "smm", "marketplace_cards", "app", "digital_magazine", "custom"]);

export const AnalysisSchema = z.object({
  insufficientData: z.boolean().describe("true, если данных недостаточно для содержательных выводов"),
  summary: z.string().describe("Краткое описание бизнеса и позиционирования — только по данным"),
  audienceAndProducts: z.string().describe("Целевая аудитория и продукты/услуги, если известны; иначе прямо сказать, что нет данных"),
  siteReview: z.object({
    observed: z.boolean().describe("true только если в контексте есть фактически загруженные страницы сайта"),
    structure: z.string(),
    visual: z.string().describe("Только то, что можно судить по тексту/структуре; визуал без скриншотов не оценивать"),
    ux: z.string(),
    content: z.string(),
  }),
  needSignals: z.array(
    z.object({
      signal: z.string(),
      sourceRef: z.string().describe("id источника из контекста (src_N) или пустая строка"),
      confirmed: z.boolean().describe("true только если прямо подтверждено источником"),
    }),
  ),
  recommendedServices: z.array(
    z.object({ service: serviceKey, rationale: z.string(), arguments: z.array(z.string()), isHypothesis: z.boolean() }),
  ),
  risks: z.array(z.string()),
  gaps: z.array(z.string()).describe("Пробелы в информации"),
  questionsToVerify: z.array(z.string()),
  sourceClaims: z.array(z.object({ sourceRef: z.string(), claims: z.array(z.string()) })),
  nextStep: z.string(),
  confidence,
});
export type AnalysisOutput = z.infer<typeof AnalysisSchema>;

export const MessageGenerationSchema = z.object({
  variants: z.array(
    z.object({
      id: z.enum(["recommended", "short", "expert"]),
      label: z.string(),
      subject: z.string().describe("Тема письма для email, иначе пустая строка"),
      body: z.string(),
      personalization: z.array(z.object({ claim: z.string(), sourceId: z.string(), confidence })),
      assumptions: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
  ),
  language: z.string(),
  serviceRationale: z.string().describe("Почему выбранная услуга релевантна (с оговорками)"),
  toVerify: z.array(z.string()).describe("Что проверить перед отправкой"),
});
export type MessageGenerationOutput = z.infer<typeof MessageGenerationSchema>;

export const RewriteSchema = z.object({
  text: z.string().describe("Только переписанный фрагмент/текст, без пояснений"),
  note: z.string().describe("Короткое пояснение изменений"),
});
export type RewriteOutput = z.infer<typeof RewriteSchema>;

// ---------- Модуль «Спрос»: классификация намерений и персональные обращения ----------
export const SignalIntentSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      intent: z.enum(["order", "hire", "ongoing", "recommendation", "partner", "launch", "interest", "none"]),
      confidence: z.number().int().min(0).max(100),
      serviceFit: z.number().int().min(0).max(100),
      reason: z.string(),
    }),
  ),
});
export type SignalIntentOutput = z.infer<typeof SignalIntentSchema>;

export const SignalOutreachSchema = z.object({
  variants: z.array(
    z.object({
      key: z.enum(["friendly", "business", "short"]),
      subject: z.string(),
      body: z.string(),
      facts: z.array(z.string()),
    }),
  ),
  warnings: z.array(z.string()),
});
export type SignalOutreachOutput = z.infer<typeof SignalOutreachSchema>;

export const ProposalDraftSchema = z.object({
  title: z.string(),
  blocks: z.array(
    z.object({
      key: z.enum(["task", "solution", "stages", "timeline", "price", "terms", "next_step"]),
      body: z.string(),
    }),
  ),
  missingInputs: z.array(z.string()).describe("Что пользователь должен заполнить сам (цены, сроки, условия и т.п.)"),
});
export type ProposalDraftOutput = z.infer<typeof ProposalDraftSchema>;

export const ReplyDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  assumptions: z.array(z.string()),
  suggestedNextStep: z.string(),
});
export type ReplyDraftOutput = z.infer<typeof ReplyDraftSchema>;

// ---------- Референс: концепция улучшений и письмо ----------
const impact = z.enum(["high", "medium", "low"]);
export const ReferenceConceptSchema = z.object({
  title: z.string().describe("Название концепции, напр. «Концепция обновления сайта кофейни …»"),
  diagnosis: z.string().describe("2–3 предложения: текущее состояние по данным аудита, без выдумок"),
  problems: z.array(z.object({ title: z.string(), evidence: z.string().describe("Наблюдаемый факт из аудита/страниц"), severity: impact })),
  improvements: z.array(z.object({ title: z.string(), why: z.string(), how: z.string(), impact })),
  structure: z.array(z.object({ section: z.string(), purpose: z.string(), content: z.string() })).describe("Предлагаемая структура сайта/лендинга"),
  style: z.object({
    mood: z.string(),
    palette: z.array(z.object({ name: z.string(), hex: z.string().describe("Цвет в формате #RRGGBB") })),
    typography: z.string(),
  }),
  copy: z.object({ heroTitle: z.string(), heroSubtitle: z.string(), cta: z.string() }),
  email: z.object({
    subject: z.string().describe("Тема письма, до 70 символов, без кликбейта"),
    body: z.string().describe("Короткое письмо от первого лица исполнителя со ссылкой на концепцию во вложении; без строки об отписке"),
  }),
  assumptions: z.array(z.string()),
});
export type ReferenceConcept = z.infer<typeof ReferenceConceptSchema>;

export const PrototypeSchema = z.object({
  html: z.string().describe("Полный самодостаточный HTML-документ: <!doctype html>, встроенный <style>, без <script> и внешних ресурсов"),
  notes: z.string().describe("Что показано в прототипе и что заменить реальными материалами"),
});
export type PrototypeOutput = z.infer<typeof PrototypeSchema>;

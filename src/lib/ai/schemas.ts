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

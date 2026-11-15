import { z } from "zod";

export const CampaignSettings = z.object({
  attachPdf: z.boolean().default(true),
  attachHtml: z.boolean().default(false),
  dailyLimit: z.number().int().min(1).max(200).default(25),
  intervalMin: z.number().int().min(1).max(240).default(4),
  windowStart: z.number().int().min(0).max(23).default(9),
  windowEnd: z.number().int().min(1).max(24).default(19),
});

import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prepareAttempt, precheck, channelOptions } from "@/lib/signals/outreach";
import { requireLead } from "@/lib/signals/store";

export const runtime = "nodejs";

/** Предварительные проверки по всем способам связи */
export const GET = handler(async (_req, p) => {
  const user = await requireUser();
  await requireLead(user, p.leadId);
  const opts = await channelOptions(p.leadId);
  return { options: await Promise.all(opts.map(async (o) => ({ ...o, issues: await precheck(user, p.leadId, o.mode, o.target, o.channel) }))) };
});

/** Подготовка обращения: проверки + сохранение в статусе «подготовлено» */
export const POST = handler(async (req, p) => {
  const user = await requireUser();
  const b = await parseBody(
    req,
    z.object({
      mode: z.enum(["api", "open_dialog", "platform_reply"]),
      channel: z.string().max(30).optional(),
      draftId: z.string().max(40).optional(),
      signalId: z.string().max(40).optional(),
      subject: z.string().max(300).default(""),
      body: z.string().trim().min(1, "Пустое сообщение").max(8000),
    }),
  );
  return prepareAttempt(user, p.leadId, b);
});

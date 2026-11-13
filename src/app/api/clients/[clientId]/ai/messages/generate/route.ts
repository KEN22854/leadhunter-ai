import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CHANNELS, GOALS, LANGUAGES, LENGTHS, SERVICES, TONES, keysOf } from "@/lib/domain";
import { generateMessages } from "@/lib/ai/service";

export const maxDuration = 300;

const Body = z.object({
  channel: z.enum(keysOf(CHANNELS)),
  service: z.enum(keysOf(SERVICES)),
  customService: z.string().max(300).optional(),
  tone: z.enum(keysOf(TONES)),
  goal: z.enum(keysOf(GOALS)),
  length: z.enum(keysOf(LENGTHS)),
  language: z.enum(keysOf(LANGUAGES)),
  instructions: z.string().max(2000).optional(),
  contactId: z.string().nullable().optional(),
});

export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const b = await parseBody(req, Body);
  if (b.contactId && !(await prisma.contact.findFirst({ where: { id: b.contactId, clientId } }))) throw new ApiError(400, "bad_contact", "Контакт не принадлежит клиенту");
  return await generateMessages(user, clientId, b);
});

import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAIMessage } from "@/lib/guards";
import { logInteraction } from "@/lib/timeline";

/** Восстановление предыдущей версии создаёт новую версию (история не переписывается). */
export const POST = handler(async (req, { messageId }) => {
  const user = await requireUser();
  const msg = await requireAIMessage(user, messageId);
  const { version } = await parseBody(req, z.object({ version: z.number().int().min(1) }));
  const v = await prisma.aIMessageVersion.findUnique({ where: { messageId_version: { messageId, version } } });
  if (!v) throw new ApiError(404, "not_found", "Версия не найдена");
  const next = msg.version + 1;
  const message = await prisma.aIMessage.update({
    where: { id: messageId },
    data: {
      body: v.body,
      subject: v.subject,
      version: next,
      versions: { create: { version: next, body: v.body, subject: v.subject, origin: "restore", note: `Восстановлена версия ${version}` } },
    },
  });
  await logInteraction(msg.clientId, "message_edited", `Восстановлена версия ${version} сообщения`, user, { messageId });
  return { message };
});

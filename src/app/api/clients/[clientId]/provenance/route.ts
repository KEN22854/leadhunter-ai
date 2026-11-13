import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recalcScore } from "@/lib/scoring";
import { logInteraction } from "@/lib/timeline";

const FIELD_LABELS: Record<string, string> = {
  companyName: "Название",
  website: "Сайт",
  industry: "Отрасль",
  city: "Город",
  country: "Страна",
  description: "Описание",
};

/** Разрешение конфликта: пользователь выбирает корректное значение поля из источников. */
export const POST = handler(async (req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const { provenanceId } = await parseBody(req, z.object({ provenanceId: z.string() }));
  const p = await prisma.fieldProvenance.findFirst({ where: { id: provenanceId, clientId } });
  if (!p || !(p.field in FIELD_LABELS)) throw new ApiError(404, "not_found", "Значение не найдено");
  await prisma.fieldProvenance.updateMany({ where: { clientId, field: p.field }, data: { selected: false } });
  await prisma.fieldProvenance.update({ where: { id: p.id }, data: { selected: true } });
  await prisma.client.update({ where: { id: clientId }, data: { [p.field]: p.value } });
  await logInteraction(clientId, "data_checked", `Конфликт «${FIELD_LABELS[p.field]}» разрешён: выбрано «${p.value.slice(0, 80)}»`, user);
  await recalcScore(clientId, user);
  return { ok: true };
});

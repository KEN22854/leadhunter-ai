import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeContact, normalizeDomain } from "@/lib/normalize";
import { audit } from "@/lib/timeline";
import { normalizeProfileUrl } from "@/lib/signals/identity";

const Body = z.object({
  type: z.enum(["email", "phone", "telegram", "whatsapp", "domain", "profile", "other"]),
  value: z.string().min(2).max(300),
  reason: z.string().max(500).optional(),
});

export const GET = handler(async () => {
  const user = await requireUser();
  return { items: await prisma.suppressionEntry.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" } }) };
});

export const POST = handler(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, Body);
  const value = b.type === "profile" ? "profile:" + normalizeProfileUrl(b.value) : b.type === "domain" ? "@" + normalizeDomain(b.value.replace(/^@/, "")) : normalizeContact(b.type, b.value);
  const item = await prisma.suppressionEntry.upsert({
    where: { ownerId_value: { ownerId: user.id, value } },
    update: { reason: b.reason ?? "" },
    create: { ownerId: user.id, value, type: b.type, reason: b.reason ?? "" },
  });
  await audit(user.id, "suppression.add", "SuppressionEntry", item.id, { value });
  return { item };
});

export const DELETE = handler(async (req) => {
  const user = await requireUser();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  await prisma.suppressionEntry.deleteMany({ where: { id, ownerId: user.id } });
  await audit(user.id, "suppression.remove", "SuppressionEntry", id);
  return { ok: true };
});

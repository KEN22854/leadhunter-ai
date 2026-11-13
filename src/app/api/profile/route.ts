import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const s = (max: number) => z.string().max(max).optional();
const Body = z.object({
  displayName: s(200),
  companyName: s(200),
  description: s(4000),
  specialization: s(1000),
  advantages: s(3000),
  portfolioUrl: s(500),
  website: s(500),
  signature: s(1000),
  cases: s(6000),
  pricingNotes: s(3000),
  requisites: s(3000),
});

export const GET = handler(async () => {
  const user = await requireUser();
  return { profile: await prisma.executorProfile.findUnique({ where: { userId: user.id } }) };
});

export const PUT = handler(async (req) => {
  const user = await requireUser();
  const data = await parseBody(req, Body);
  const profile = await prisma.executorProfile.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
  return { profile };
});

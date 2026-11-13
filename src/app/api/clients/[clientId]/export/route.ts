import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireClientAccess, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/timeline";

/** Экспорт всех данных по клиенту (JSON) — для запросов субъекта данных и переноса. */
export const GET = handler(async (_req, { clientId }) => {
  const user = await requireUser();
  await requireClientAccess(user, clientId);
  const data = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      contacts: true,
      sources: true,
      provenance: true,
      analyses: true,
      scores: true,
      messages: { include: { versions: true } },
      conversations: { include: { items: true } },
      interactions: true,
      tasks: true,
      proposals: { include: { versions: true } },
      consents: true,
    },
  });
  await audit(user.id, "client.export", "Client", clientId);
  return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), client: data }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="client-${clientId}.json"`,
    },
  });
});

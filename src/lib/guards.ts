import "server-only";
import { prisma } from "./db";
import { ApiError } from "./api";
import type { CurrentUser } from "./auth";

// Проверки владения для сущностей, адресуемых собственным id. Чужое = 404.
const deny = () => new ApiError(404, "not_found", "Объект не найден или нет прав доступа");
const owns = (user: CurrentUser, ownerId: string) => ownerId === user.id || user.role === "admin";

export async function requireContact(user: CurrentUser, id: string) {
  const c = await prisma.contact.findUnique({ where: { id }, include: { client: { select: { ownerId: true } } } });
  if (!c || !owns(user, c.client.ownerId)) throw deny();
  return c;
}
export async function requireAIMessage(user: CurrentUser, id: string) {
  const m = await prisma.aIMessage.findUnique({ where: { id }, include: { client: { select: { ownerId: true } } } });
  if (!m || !owns(user, m.client.ownerId)) throw deny();
  return m;
}
export async function requireTask(user: CurrentUser, id: string) {
  const t = await prisma.clientTask.findUnique({ where: { id }, include: { client: { select: { ownerId: true } } } });
  if (!t || !owns(user, t.client.ownerId)) throw deny();
  return t;
}
export async function requireProposal(user: CurrentUser, id: string) {
  const p = await prisma.proposal.findUnique({ where: { id }, include: { client: { select: { ownerId: true, companyName: true } } } });
  if (!p || !owns(user, p.client.ownerId)) throw deny();
  return p;
}
export async function requireOutbound(user: CurrentUser, id: string) {
  const i = await prisma.conversationMessage.findUnique({
    where: { id },
    include: { conversation: { include: { client: { select: { ownerId: true } } } } },
  });
  if (!i || !owns(user, i.conversation.client.ownerId)) throw deny();
  return i;
}

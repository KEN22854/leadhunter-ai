import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiError } from "../api";
import type { CurrentUser } from "../auth";
import { logInteraction } from "../timeline";
import { fetchSitePages } from "../webfetch";
import { buildClientContext, sanitizeExternal } from "../ai/context";
import { PROMPTS } from "../ai/prompts";
import { callStructured, isAIConfigured } from "../ai/provider";
import { PrototypeSchema, ReferenceConceptSchema, type ReferenceConcept } from "../ai/schemas";
import type { SiteAudit } from "../discovery/audit";
import { referenceToPdf } from "./pdf";
import { sanitizePrototype } from "./sanitize";

function auditBlock(audit: SiteAudit | null) {
  if (!audit) return "<site_audit>Аудит сайта не проводился.</site_audit>";
  const items = audit.items
    .filter((i) => i.severity !== "ok")
    .map((i) => `- [${i.severity}] ${i.title}: ${i.detail}`)
    .join("\n");
  return `<site_audit checked="${audit.checkedAt.slice(0, 10)}" score="${audit.score}/100" url="${sanitizeExternal(audit.url ?? "", 300)}">
${sanitizeExternal(audit.summary, 600)}
${sanitizeExternal(items, 4000) || "Явных проблем не найдено."}
</site_audit>`;
}

/** Концепция улучшений + письмо (AI). */
export async function generateReference(user: CurrentUser, clientId: string, instructions = "") {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  // Без AI не тратим время на загрузку сайта — сразу понятная ошибка
  if (!(await isAIConfigured()))
    throw new ApiError(503, "ai_not_configured", "AI не подключён: войдите в Claude Code на этом компьютере (команда `claude`) или задайте ANTHROPIC_API_KEY в .env и перезапустите приложение.");
  const audit = client.siteAudit as unknown as SiteAudit | null;
  let pages: { url: string; title: string; text: string }[] = [];
  if (client.website) {
    const r = await fetchSitePages(client.website, 2).catch(() => ({ pages: [] as { url: string; title: string; text: string }[] }));
    pages = r.pages.map((p) => ({ url: p.url, title: p.title, text: p.text.slice(0, 4000) }));
  }
  const ctx = await buildClientContext(clientId, user.id, { extraPages: pages });
  const prompt = `Подготовь референс (концепцию улучшений) и первое письмо для этой компании.
${auditBlock(audit)}
${instructions ? `<user_instructions>${sanitizeExternal(instructions, 1500)}</user_instructions>\n` : ""}
${ctx.text}`;
  const { data, model } = await callStructured(
    { userId: user.id, clientId, operation: "reference" },
    { system: PROMPTS.reference.system, user: prompt, schema: ReferenceConceptSchema, effort: "medium" },
  );
  const ref = await prisma.reference.create({
    data: {
      clientId,
      title: data.title.slice(0, 200),
      concept: data as unknown as Prisma.InputJsonValue,
      emailSubject: data.email.subject.slice(0, 200),
      emailBody: data.email.body,
      model,
      promptVersion: PROMPTS.reference.version,
    },
  });
  await logInteraction(clientId, "reference_created", `Референс: «${ref.title}» (${model})`, user, { referenceId: ref.id });
  return ref;
}

/** HTML-прототип по концепции (AI), очищенный от активного содержимого. */
export async function generatePrototype(user: CurrentUser, referenceId: string) {
  const ref = await prisma.reference.findUniqueOrThrow({ where: { id: referenceId }, include: { client: true } });
  const c = ref.client;
  const prompt = `Сделай HTML-прототип главной страницы по концепции.
<company name="${sanitizeExternal(c.companyName, 200)}" city="${sanitizeExternal(c.city, 100)}" category="${sanitizeExternal(c.category, 100)}" website="${sanitizeExternal(c.website, 200)}">
${sanitizeExternal(c.description, 1500)}
</company>
<concept>
${JSON.stringify({ title: ref.concept && (ref.concept as unknown as ReferenceConcept).title, ...(ref.concept as object), email: undefined })}
</concept>`;
  const { data, model } = await callStructured(
    { userId: user.id, clientId: c.id, operation: "prototype" },
    { system: PROMPTS.prototype.system, user: prompt, schema: PrototypeSchema, effort: "medium", maxTokens: 32000, timeoutMs: 420_000 },
  );
  const html = sanitizePrototype(data.html);
  const updated = await prisma.reference.update({ where: { id: referenceId }, data: { html, model } });
  await logInteraction(c.id, "reference_created", `HTML-прототип готов (${model}). ${data.notes.slice(0, 200)}`, user, { referenceId });
  return updated;
}

export function slugify(s: string) {
  const map: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  return (
    s
      .toLowerCase()
      .split("")
      .map((ch) => map[ch] ?? ch)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "client"
  );
}

export type Attachment = { filename: string; content: Buffer; contentType: string };

/** Файлы референса для письма. */
export async function buildReferenceAttachments(referenceId: string, opts: { pdf: boolean; html: boolean }): Promise<Attachment[]> {
  const ref = await prisma.reference.findUnique({ where: { id: referenceId }, include: { client: { include: { owner: { include: { profile: true } } } } } });
  if (!ref) throw new ApiError(404, "not_found", "Референс не найден");
  const profile = ref.client.owner.profile;
  const out: Attachment[] = [];
  const base = `koncepciya-${slugify(ref.client.companyName)}`;
  if (opts.pdf) {
    const pdf = await referenceToPdf(ref.concept as unknown as ReferenceConcept, {
      companyName: ref.client.companyName,
      executorName: profile?.displayName || profile?.companyName || "",
      executorContacts: [profile?.website, profile?.portfolioUrl].filter(Boolean).join(" · "),
      date: ref.updatedAt,
    });
    out.push({ filename: `${base}.pdf`, content: pdf, contentType: "application/pdf" });
  }
  if (opts.html && ref.html) out.push({ filename: `${base}-prototip.html`, content: Buffer.from(ref.html, "utf8"), contentType: "text/html; charset=utf-8" });
  return out;
}

/** Рабочая папка проекта после согласия клиента: бриф, концепция, прототип и CLAUDE.md для продолжения работы в Claude Code. */
export async function createWorkspace(user: CurrentUser, clientId: string) {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { references: { orderBy: { createdAt: "desc" }, take: 1 }, contacts: { where: { doNotContact: false } }, tasks: { where: { status: { in: ["new", "in_progress"] } } } },
  });
  const root = path.resolve(process.env.WORKSPACE_DIR || path.join(process.cwd(), "workspace"));
  const dir = client.workspacePath && client.workspacePath.startsWith(root) ? client.workspacePath : path.join(root, `${slugify(client.companyName)}-${client.id.slice(-6)}`);
  await mkdir(dir, { recursive: true });
  const ref = client.references[0];
  const concept = ref?.concept as unknown as ReferenceConcept | undefined;
  const audit = client.siteAudit as unknown as SiteAudit | null;
  const brief = `# ${client.companyName}

- Категория: ${client.category || "—"}
- Город: ${[client.city, client.country].filter(Boolean).join(", ") || "—"}
- Сайт сейчас: ${client.website || "нет"}
- Контакты: ${client.contacts.map((c) => `${c.type}: ${c.value}`).join("; ") || "—"}

## Описание
${client.description || "—"}

## Аудит текущего сайта${audit ? ` (${audit.score}/100, ${audit.checkedAt.slice(0, 10)})` : ""}
${audit ? audit.items.filter((i) => i.severity !== "ok").map((i) => `- **${i.title}** — ${i.detail} → ${i.recommendation}`).join("\n") : "Не проводился."}

## Открытые задачи
${client.tasks.map((t) => `- ${t.title}`).join("\n") || "—"}
`;
  await writeFile(path.join(dir, "brief.md"), brief, "utf8");
  if (concept) {
    const md = `# ${concept.title}

${concept.diagnosis}

## Улучшения
${concept.improvements.map((i, n) => `${n + 1}. **${i.title}** — ${i.why}\n   Как: ${i.how}`).join("\n")}

## Структура
${concept.structure.map((s) => `- **${s.section}** — ${s.purpose}. ${s.content}`).join("\n")}

## Стиль
${concept.style.mood}. Шрифты: ${concept.style.typography}.
Палитра: ${concept.style.palette.map((p) => `${p.name} ${p.hex}`).join(", ")}

## Первый экран
- Заголовок: ${concept.copy.heroTitle}
- Подзаголовок: ${concept.copy.heroSubtitle}
- Кнопка: ${concept.copy.cta}
`;
    await writeFile(path.join(dir, "concept.md"), md, "utf8");
  }
  if (ref?.html) await writeFile(path.join(dir, "prototype.html"), ref.html, "utf8");
  await writeFile(
    path.join(dir, "CLAUDE.md"),
    `# Проект: сайт для «${client.companyName}»

Клиент согласился на работу по концепции. Исходные материалы:
- brief.md — данные клиента и аудит текущего сайта
- concept.md — согласованная концепция (структура, стиль, тексты первого экрана)
${ref?.html ? "- prototype.html — концепт-прототип главной (отправная точка дизайна)\n" : ""}
Задача: на основе концепции сделать рабочий сайт. Перед стартом уточни у меня стек и хостинг.
Реальные тексты, цены, фото и часы работы клиента пока неизвестны — оставляй явные плейсхолдеры, ничего не выдумывай.
`,
    "utf8",
  );
  if (client.workspacePath !== dir) {
    await prisma.client.update({ where: { id: clientId }, data: { workspacePath: dir } });
    await logInteraction(clientId, "workspace_created", `Создан рабочий проект: ${dir}`, user);
  }
  return { path: dir, command: `cd "${dir}" && claude` };
}

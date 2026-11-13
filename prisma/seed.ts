// Сид для локальной разработки: тестовый пользователь и ДЕМО-лиды с вымышленными данными
// (домены *.example — зарезервированы и не принадлежат реальным компаниям).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const prisma = new PrismaClient();

function ensureAuthSecret() {
  if (!existsSync(".env")) return;
  const env = readFileSync(".env", "utf8");
  if (/AUTH_SECRET="[^"]{32,}"/.test(env)) return;
  writeFileSync(".env", env.replace(/AUTH_SECRET=".*"/, `AUTH_SECRET="${randomBytes(32).toString("hex")}"`));
  console.log("AUTH_SECRET сгенерирован в .env");
}

const days = (n: number) => new Date(Date.now() - n * 86_400_000);

async function main() {
  ensureAuthSecret();
  const email = (process.env.SEED_USER_EMAIL || "demo@leadhunter.local").toLowerCase();
  const password = process.env.SEED_USER_PASSWORD || "leadhunter-demo-2026";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Демо-менеджер", passwordHash: await bcrypt.hash(password, 10) },
  });
  await prisma.executorProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      displayName: "Демо-исполнитель",
      companyName: "Студия «Пример»",
      specialization: "Разработка сайтов, брендинг, карточки маркетплейсов",
      description: "Небольшая студия digital-услуг. ЗАПОЛНИТЕ профиль своими данными в Настройках — ИИ использует только эти факты.",
      advantages: "",
      cases: "",
      pricingNotes: "",
    },
  });

  if (await prisma.client.count({ where: { ownerId: user.id } })) {
    console.log("Демо-данные уже есть — пропускаю.");
    return;
  }

  const demo = [
    {
      companyName: "Пекарня «Утренний хлеб» (демо)",
      industry: "Общепит / пекарня",
      category: "Малый бизнес",
      country: "Россия",
      city: "Казань",
      website: "https://bakery.example",
      description: "ДЕМО-ЗАПИСЬ. Семейная пекарня с двумя точками и доставкой. Данные вымышлены для проверки интерфейса.",
      sources: [
        { sourceType: "directory", sourceUrl: "https://catalog.example/bakery", title: "Каталог компаний города (демо)", evidence: "Название, адрес, сфера деятельности", capturedAt: days(12) },
      ],
      contacts: [
        { type: "email", value: "hello@bakery.example", verificationStatus: "found" },
        { type: "phone", value: "+7 900 000-00-01", verificationStatus: "found" },
      ],
    },
    {
      companyName: "ООО «Северный текстиль» (демо)",
      industry: "Производство одежды",
      category: "Селлер маркетплейсов",
      country: "Россия",
      city: "Иваново",
      website: "https://textile.example",
      description: "ДЕМО-ЗАПИСЬ. Производитель домашнего текстиля, продаёт на маркетплейсах.",
      sources: [
        { sourceType: "job_post", sourceUrl: "https://freelance.example/task/123", title: "Заказ: инфографика для 20 карточек (демо)", evidence: "Опубликованный запрос на дизайн карточек маркетплейса, бюджет не указан", capturedAt: days(5) },
        { sourceType: "marketplace", sourceUrl: "https://market.example/seller/textile", title: "Страница продавца (демо)", evidence: "Ассортимент: постельное бельё, полотенца", capturedAt: days(5) },
      ],
      contacts: [{ type: "telegram", value: "@textile_demo_seller", verificationStatus: "found" }],
    },
    {
      companyName: "Клиника «Здоровая улыбка» (демо)",
      industry: "Стоматология",
      category: "Медицина",
      country: "Россия",
      city: "Новосибирск",
      website: "",
      description: "",
      sources: [{ sourceType: "manual", sourceUrl: "", title: "Внесено вручную", evidence: "Название и город", capturedAt: days(120) }],
      contacts: [],
    },
  ];

  for (const d of demo) {
    const { sources, contacts, ...data } = d;
    const client = await prisma.client.create({ data: { ...data, ownerId: user.id, firstSeenAt: sources[0].capturedAt } });
    const created = [];
    for (const s of sources) created.push(await prisma.leadSource.create({ data: { ...s, clientId: client.id, method: "manual" } }));
    for (const c of contacts)
      await prisma.contact.create({
        data: {
          ...c,
          clientId: client.id,
          sourceId: created[0].id,
          normalizedValue: c.type === "email" ? c.value.toLowerCase() : c.type === "telegram" ? c.value.replace(/^@/, "").toLowerCase() : c.value.replace(/[^\d+]/g, ""),
        },
      });
    for (const f of ["companyName", "website", "industry", "city", "country"] as const)
      if (data[f]) await prisma.fieldProvenance.create({ data: { clientId: client.id, field: f, value: data[f], sourceId: created[0].id, selected: true } });
    await prisma.interaction.create({ data: { clientId: client.id, type: "lead_discovered", summary: `Лид обнаружен: ${client.companyName}`, actorLabel: "seed", payload: {} } });
  }
  // Пример конфликта источников (город)
  const textile = await prisma.client.findFirst({ where: { ownerId: user.id, companyName: { contains: "текстиль" } }, include: { sources: true } });
  if (textile) await prisma.fieldProvenance.create({ data: { clientId: textile.id, field: "city", value: "Шуя", sourceId: textile.sources[1]?.id } });

  console.log(`Готово. Вход: ${email} (пароль — SEED_USER_PASSWORD из .env / .env.example)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

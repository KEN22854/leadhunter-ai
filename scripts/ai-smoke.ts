// Проверка AI-конвейера на реальной модели: npm run ai:smoke -- "Название клиента" [proto]
// Тратит лимиты подписки Claude (или токены API). Не часть приложения.
import { prisma } from "../src/lib/db";
import { generateReference, generatePrototype } from "../src/lib/reference/service";

async function main() {
  const client = await prisma.client.findFirstOrThrow({ where: { companyName: process.argv[2] } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: client.ownerId } });
  const user = { id: owner.id, email: owner.email, name: owner.name, role: owner.role };
  console.time("reference");
  const ref = await generateReference(user, client.id);
  console.timeEnd("reference");
  const c = ref.concept as { title: string; problems: unknown[]; improvements: { title: string }[] };
  console.log("TITLE:", c.title, "| problems:", c.problems.length, "| improvements:", c.improvements.map((i) => i.title).join("; "));
  console.log("SUBJECT:", ref.emailSubject);
  console.log("BODY:\n" + ref.emailBody);
  if (process.argv[3] === "proto") {
    console.time("prototype");
    const p = await generatePrototype(user, ref.id);
    console.timeEnd("prototype");
    console.log("HTML length:", p.html.length, "| has <script>:", /<script/i.test(p.html), "| CSP:", p.html.includes("Content-Security-Policy"));
  }
  console.log("REF_ID:", ref.id);
}
main().catch((e) => {
  console.error("FAILED:", e?.code ?? "", e?.message ?? e);
  process.exit(1);
}).finally(() => prisma.$disconnect());

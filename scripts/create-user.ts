// Создание или обновление пользователя:
//   npm run user:create -- <логин или email> "<Имя>" [admin|manager]
// Пароль берётся из переменной окружения NEW_USER_PASSWORD (не попадает в историю команд как аргумент).
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

async function main() {
  const [login, name = "Администратор", role = "admin"] = process.argv.slice(2);
  const password = process.env.NEW_USER_PASSWORD ?? "";
  if (!login) throw new Error("Укажите логин");
  if (password.length < 8) throw new Error("Задайте NEW_USER_PASSWORD (не короче 8 символов)");
  if (!["admin", "manager"].includes(role)) throw new Error("Роль: admin или manager");
  const email = login.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({ where: { email }, update: { passwordHash, role, name }, create: { email, name, role, passwordHash } });
  await prisma.executorProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, displayName: name } });
  console.log(`Пользователь «${user.email}» (${user.role}) готов.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

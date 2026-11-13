import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// Отдельная тестовая БД: накатываем миграции с нуля (проверка миграций на чистой базе).
export default function setup() {
  for (const f of ["prisma/test.db", "prisma/test.db-journal"]) rmSync(f, { force: true });
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: "file:./test.db" } });
  return () => {
    for (const f of ["prisma/test.db", "prisma/test.db-journal"]) rmSync(f, { force: true });
  };
}

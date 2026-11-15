import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
      // server-only бросает исключение вне React Server-окружения; в тестах это пустой модуль
      "server-only": path.resolve(process.cwd(), "tests/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
      ANTHROPIC_API_KEY: "",
      AI_DISABLE_CLAUDE_CODE: "1",
    },
  },
});

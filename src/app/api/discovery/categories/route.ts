import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { CATEGORIES } from "@/lib/discovery/categories";

export const GET = handler(async () => {
  await requireUser();
  return { categories: Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label })) };
});

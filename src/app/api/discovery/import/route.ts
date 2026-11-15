import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { importResults } from "@/lib/discovery/service";

export const runtime = "nodejs";

export const POST = handler(async (req) => {
  const user = await requireUser();
  const { resultIds } = await parseBody(req, z.object({ resultIds: z.array(z.string()).min(1).max(300) }));
  return await importResults(user, resultIds);
});

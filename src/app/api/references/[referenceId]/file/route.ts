import { ApiError, handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { requireReference } from "@/lib/guards";
import { buildReferenceAttachments } from "@/lib/reference/service";

export const runtime = "nodejs";

/** Скачивание файлов референса: ?format=pdf|html */
export const GET = handler(async (req, { referenceId }) => {
  const user = await requireUser();
  await requireReference(user, referenceId);
  const format = new URL(req.url).searchParams.get("format") === "html" ? "html" : "pdf";
  const [file] = await buildReferenceAttachments(referenceId, { pdf: format === "pdf", html: format === "html" });
  if (!file) throw new ApiError(404, "not_found", "HTML-прототип ещё не сгенерирован");
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="reference.${format}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    },
  });
});

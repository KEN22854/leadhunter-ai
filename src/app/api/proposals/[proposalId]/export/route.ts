import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireProposal } from "@/lib/guards";
import { proposalToDocx, proposalToPdf, type ProposalExportData } from "@/lib/export/proposal";
import { audit } from "@/lib/timeline";

export const runtime = "nodejs";

export const POST = handler(async (req, { proposalId }) => {
  const user = await requireUser();
  const p = await requireProposal(user, proposalId);
  const { format } = await parseBody(req, z.object({ format: z.enum(["pdf", "docx"]) }));
  const profile = await prisma.executorProfile.findUnique({ where: { userId: user.id } });
  const content = p.content as { blocks?: { key: string; title?: string; body: string }[] };
  const data: ProposalExportData = {
    title: p.title,
    clientName: p.client.companyName,
    version: p.version,
    date: new Date(),
    executor: {
      name: [profile?.displayName, profile?.companyName].filter(Boolean).join(", "),
      requisites: profile?.requisites ?? "",
      contacts: [profile?.website, profile?.portfolioUrl].filter(Boolean).join(" · "),
    },
    blocks: content.blocks ?? [],
  };
  const buf = format === "pdf" ? await proposalToPdf(data) : await proposalToDocx(data);
  await audit(user.id, "proposal.export", "Proposal", proposalId, { format, version: p.version });
  const safe = p.title.replace(/[^\p{L}\p{N}\-_ ]/gu, "").trim().slice(0, 60) || "proposal";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="proposal.${format}"; filename*=UTF-8''${encodeURIComponent(`${safe} v${p.version}.${format}`)}`,
    },
  });
});

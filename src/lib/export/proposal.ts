import "server-only";
import { createRequire } from "node:module";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PROPOSAL_BLOCKS } from "../domain";

// Экспорт КП в PDF (pdfmake + Roboto с кириллицей) и DOCX (docx).

export type ProposalExportData = {
  title: string;
  clientName: string;
  executor: { name: string; requisites: string; contacts: string };
  version: number;
  date: Date;
  blocks: { key: string; title?: string; body: string }[];
};

const titleFor = (key: string, fallback?: string) => fallback || PROPOSAL_BLOCKS.find((b) => b.key === key)?.title || key;

type PdfMake = {
  addFonts(f: unknown): void;
  setUrlAccessPolicy?(fn: (url: string) => boolean): void;
  createPdf(doc: unknown): { getBuffer(): Promise<Buffer> };
};

let pdfmakeInstance: PdfMake | null = null;
function pdfmake(): PdfMake {
  if (!pdfmakeInstance) {
    const require = createRequire(import.meta.url);
    const pm = require("pdfmake") as PdfMake;
    pm.addFonts(require("pdfmake/fonts/Roboto"));
    // Документ не загружает внешние ресурсы
    pm.setUrlAccessPolicy?.(() => false);
    pdfmakeInstance = pm;
  }
  return pdfmakeInstance;
}

export async function proposalToPdf(d: ProposalExportData): Promise<Buffer> {
  const content: unknown[] = [
    { text: d.title, style: "h1" },
    { text: `Для: ${d.clientName}`, style: "meta" },
    { text: `От: ${d.executor.name || "—"}  ·  Версия ${d.version}  ·  ${d.date.toLocaleDateString("ru-RU")}`, style: "meta", margin: [0, 0, 0, 16] },
  ];
  for (const b of d.blocks) {
    if (!b.body.trim()) continue;
    content.push({ text: titleFor(b.key, b.title), style: "h2" });
    content.push({ text: b.body, style: "body" });
  }
  if (d.executor.requisites || d.executor.contacts) {
    content.push({ text: "Реквизиты и контакты", style: "h2" });
    content.push({ text: [d.executor.requisites, d.executor.contacts].filter(Boolean).join("\n"), style: "small" });
  }
  const doc = {
    info: { title: d.title, creator: "LEADHUNTER AI" },
    pageSize: "A4",
    pageMargins: [48, 56, 48, 56],
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.3 },
    styles: {
      h1: { fontSize: 20, bold: true, margin: [0, 0, 0, 8] },
      h2: { fontSize: 13, bold: true, margin: [0, 14, 0, 6], color: "#3b2f8f" },
      meta: { fontSize: 9.5, color: "#555555" },
      body: { margin: [0, 0, 0, 4] },
      small: { fontSize: 9, color: "#444444" },
    },
    content,
    footer: (page: number, count: number) => ({ text: `${page} / ${count}`, alignment: "right", margin: [0, 0, 48, 0], fontSize: 8, color: "#888888" }),
  };
  return pdfmake().createPdf(doc).getBuffer();
}

export async function proposalToDocx(d: ProposalExportData): Promise<Buffer> {
  const para = (text: string) =>
    text.split("\n").map((line) => new Paragraph({ children: [new TextRun({ text: line, size: 22 })], spacing: { after: 80 } }));
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: d.title, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `Для: ${d.clientName}`, color: "555555", size: 20 })] }),
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: `От: ${d.executor.name || "—"} · Версия ${d.version} · ${d.date.toLocaleDateString("ru-RU")}`, color: "555555", size: 20 })],
    }),
  ];
  for (const b of d.blocks) {
    if (!b.body.trim()) continue;
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: titleFor(b.key, b.title) })] }));
    children.push(...para(b.body));
  }
  if (d.executor.requisites || d.executor.contacts) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun({ text: "Реквизиты и контакты" })] }));
    children.push(...para([d.executor.requisites, d.executor.contacts].filter(Boolean).join("\n")));
  }
  children.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Подготовлено в LEADHUNTER AI", size: 16, color: "999999" })] }));
  const doc = new Document({ creator: "LEADHUNTER AI", title: d.title, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

import "server-only";
import type { ReferenceConcept } from "../ai/schemas";
import { pdfmake } from "../export/proposal";

// PDF-версия референса — вложение к письму. Без внешних ресурсов; цвета палитры рисуются прямоугольниками.

const IMPACT: Record<string, string> = { high: "высокий эффект", medium: "средний эффект", low: "небольшой эффект" };
const isHex = (h: string) => /^#[0-9a-f]{6}$/i.test(h.trim());

export async function referenceToPdf(c: ReferenceConcept, meta: { companyName: string; executorName: string; executorContacts: string; date: Date }): Promise<Buffer> {
  const accent = c.style.palette.map((p) => p.hex.trim()).find(isHex) ?? "#4f46e5";
  const content: unknown[] = [
    { text: c.title, style: "h1", color: accent },
    { text: `Для: ${meta.companyName}${meta.executorName ? `   ·   Подготовил: ${meta.executorName}` : ""}   ·   ${meta.date.toLocaleDateString("ru-RU")}`, style: "meta", margin: [0, 0, 0, 12] },
    { text: c.diagnosis, style: "lead" },
  ];
  if (c.problems.length) {
    content.push({ text: "Что мы заметили", style: "h2", color: accent });
    content.push({ ul: c.problems.map((p) => ({ text: [{ text: p.title, bold: true }, p.evidence ? ` — ${p.evidence}` : ""] })), margin: [0, 0, 0, 4] });
  }
  if (c.improvements.length) {
    content.push({ text: "Что предлагаем улучшить", style: "h2", color: accent });
    c.improvements.forEach((i, n) =>
      content.push({
        stack: [
          { text: `${n + 1}. ${i.title}`, bold: true },
          { text: i.why, style: "body" },
          { text: [{ text: "Как: ", bold: true }, i.how], style: "body" },
          { text: IMPACT[i.impact] ?? "", style: "small", color: "#777777" },
        ],
        margin: [0, 0, 0, 8],
      }),
    );
  }
  if (c.structure.length) {
    content.push({ text: "Структура страницы", style: "h2", color: accent });
    content.push({
      table: {
        widths: [110, "*"],
        body: c.structure.map((s) => [{ text: s.section, bold: true }, { text: [s.purpose, s.content ? `\n${s.content}` : ""].join(""), style: "small" }]),
      },
      layout: "lightHorizontalLines",
    });
  }
  content.push({ text: "Стиль", style: "h2", color: accent });
  content.push({ text: `${c.style.mood}. Шрифты: ${c.style.typography}.`, style: "body" });
  const swatches = c.style.palette.filter((p) => isHex(p.hex)).slice(0, 6);
  if (swatches.length)
    content.push({
      columns: swatches.map((p) => ({
        width: 80,
        stack: [{ canvas: [{ type: "rect", x: 0, y: 0, w: 70, h: 28, r: 4, color: p.hex.trim() }] }, { text: `${p.name}\n${p.hex.toUpperCase()}`, style: "small", margin: [0, 3, 0, 0] }],
      })),
      margin: [0, 4, 0, 8],
    });
  content.push({ text: "Пример первого экрана", style: "h2", color: accent });
  content.push({
    table: {
      widths: ["*"],
      body: [[{ stack: [{ text: c.copy.heroTitle, fontSize: 16, bold: true }, { text: c.copy.heroSubtitle, margin: [0, 4, 0, 8] }, { text: `[ ${c.copy.cta} ]`, bold: true, color: accent }], margin: [12, 12, 12, 12] }]],
    },
    layout: { hLineColor: () => accent, vLineColor: () => accent },
  });
  if (c.assumptions.length) {
    content.push({ text: "Допущения", style: "h2", color: "#777777" });
    content.push({ ul: c.assumptions, style: "small" });
  }
  content.push({ text: `\nКонцепция подготовлена как предложение на основе публичных данных и автоматического аудита сайта.${meta.executorContacts ? `\n${meta.executorContacts}` : ""}`, style: "small", color: "#888888" });

  const doc = {
    info: { title: c.title, creator: "LEADHUNTER AI" },
    pageSize: "A4",
    pageMargins: [48, 52, 48, 52],
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.3 },
    styles: {
      h1: { fontSize: 19, bold: true, margin: [0, 0, 0, 6] },
      h2: { fontSize: 13, bold: true, margin: [0, 14, 0, 6] },
      lead: { fontSize: 11.5, margin: [0, 0, 0, 4] },
      meta: { fontSize: 9, color: "#666666" },
      body: { margin: [0, 1, 0, 1] },
      small: { fontSize: 9, color: "#444444" },
    },
    content,
    footer: (page: number, count: number) => ({ text: `${page} / ${count}`, alignment: "right", margin: [0, 0, 48, 0], fontSize: 8, color: "#999999" }),
  };
  return pdfmake().createPdf(doc).getBuffer();
}

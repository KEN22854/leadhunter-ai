// Рейтинг выдачи «Поиска лидов», 0–100. Сортировка по умолчанию, если пользователь не задал иное.
// Честные прокси: у OpenStreetMap нет отзывов и звёзд, поэтому «рейтинг» = известность по Nominatim (importance,
// основан на Википедии) и наличию в Wikidata, «популярность» = бренд/сеть и полнота карточки,
// «возможность написать» = email > собственный сайт > телефон > соцсети.

export type RankInput = {
  hasEmail: boolean;
  website: string;
  websiteIsSocial: boolean;
  phone: string;
  hasSocial: boolean;
  tags: Record<string, string>;
  importance?: number | null;
  opportunity?: string | null; // high | medium | low
};

/** Баллы «возможности написать» */
export function contactPoints(p: Pick<RankInput, "hasEmail" | "website" | "websiteIsSocial" | "phone" | "hasSocial">) {
  return p.hasEmail ? 50 : p.website && !p.websiteIsSocial ? 32 : p.phone ? 22 : p.hasSocial || p.websiteIsSocial ? 15 : 0;
}
export const opportunityPoints = (o?: string | null) => (o === "high" ? 10 : o === "medium" ? 5 : 0);

const INFO_TAGS = ["opening_hours", "cuisine", "description", "image", "addr:street", "addr:housenumber", "contact:instagram", "contact:vk", "contact:telegram", "contact:facebook", "wheelchair", "takeaway", "delivery", "level"];

export function rankPlace(p: RankInput): { rank: number; note: string } {
  const parts: string[] = [];
  let contact = 0;
  if (p.hasEmail) {
    contact = 50;
    parts.push("есть email");
  } else if (p.website && !p.websiteIsSocial) {
    contact = 32;
    parts.push("есть сайт");
  } else if (p.phone) {
    contact = 22;
    parts.push("есть телефон");
  } else if (p.hasSocial || p.websiteIsSocial) {
    contact = 15;
    parts.push("только соцсети");
  } else parts.push("нет контактов");

  let popularity = 0;
  const t = p.tags ?? {};
  if (t.wikidata || t.wikipedia || t["brand:wikidata"]) {
    popularity += 10;
    parts.push("в Wikidata");
  }
  if (t.brand || t.operator) {
    popularity += 6;
    parts.push("бренд/сеть");
  }
  const info = INFO_TAGS.filter((k) => t[k]).length;
  popularity += Math.min(8, info * 2);
  popularity = Math.min(20, popularity);

  const fame = p.importance ? Math.min(20, Math.round(p.importance * 40)) : 0;
  if (fame >= 8) parts.push("известное место");

  const opp = p.opportunity === "high" ? 10 : p.opportunity === "medium" ? 5 : 0;
  if (opp) parts.push(p.opportunity === "high" ? "много что улучшить" : "есть что улучшить");

  return { rank: Math.max(0, Math.min(100, contact + popularity + fame + opp)), note: parts.join(" · ") };
}

/** Порядок обхода стран при поиске «по всему миру»: крупные рынки первыми, затем остальные. */
export const WORLD_COUNTRIES = [
  "us", "gb", "de", "fr", "ru", "it", "es", "ca", "au", "nl", "pl", "tr", "br", "mx", "jp", "in", "kz", "by", "ua", "ae", "se", "ch", "at", "be", "pt",
  "cz", "ie", "dk", "no", "fi", "il", "ar", "cl", "co", "za", "nz", "sg", "kr", "id", "th", "vn", "my", "ph", "gr", "ro", "hu", "rs", "bg", "hr", "sk",
  "si", "lt", "lv", "ee", "ge", "am", "az", "uz", "kg", "md", "cy", "mt", "lu", "is", "eg", "ma", "ng", "ke", "sa", "qa", "pe", "uy", "ec", "cr", "pa",
];

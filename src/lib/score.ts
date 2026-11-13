// Объяснимый эвристический Lead Score (0–100). НЕ является вероятностью покупки.
// Чистая функция: на входе снимок данных клиента, на выходе — факторы с вкладом, основанием и уверенностью.

export type ScoreFactor = {
  key: string;
  label: string;
  max: number;
  points: number;
  basis: string;
  confidence: "high" | "medium" | "low";
};

export type ScoreInput = {
  now?: Date;
  client: { industry: string; description: string; country: string; city: string; website: string; lastCheckedAt: Date | null };
  contacts: { type: string; verificationStatus: string; doNotContact: boolean }[];
  sources: { sourceType: string; capturedAt: Date; checkedAt: Date | null }[];
  analysis: { recommendations: unknown; confidence: string; createdAt: Date } | null;
  conflicts: number;
};

const DAY = 86_400_000;
const ageDays = (now: Date, d: Date | null | undefined) => (d ? (now.getTime() - d.getTime()) / DAY : Infinity);

/** Накопитель баллов с пояснениями. */
function tally() {
  let points = 0;
  const why: string[] = [];
  return {
    add(n: number, reason: string) {
      points += n;
      why.push(reason);
    },
    note(reason: string) {
      why.push(reason);
    },
    get points() {
      return points;
    },
    set points(v: number) {
      points = v;
    },
    why,
  };
}

export function computeLeadScore(input: ScoreInput): { score: number; factors: ScoreFactor[]; explanation: string } {
  const now = input.now ?? new Date();
  const { client, contacts, sources, analysis } = input;
  const factors: ScoreFactor[] = [];
  const recs = Array.isArray(analysis?.recommendations) ? (analysis.recommendations as unknown[]) : [];

  // 1. Соответствие целевой аудитории
  {
    const t = tally();
    if (client.industry) t.add(6, `отрасль указана (${client.industry})`);
    if (client.description.length >= 40) t.add(6, "есть описание деятельности");
    if (analysis) t.add(8, "есть AI-анализ профиля");
    factors.push({
      key: "audience_fit",
      label: "Соответствие целевой аудитории",
      max: 20,
      points: t.points,
      basis: t.why.length ? t.why.join("; ") : "Нет данных об отрасли и деятельности",
      confidence: analysis ? "medium" : "low",
    });
  }

  // 2. Релевантность услуги
  {
    const hasRequest = sources.some((s) => s.sourceType === "job_post");
    let points = 0;
    let basis = "Релевантность услуги не оценена — запустите AI-анализ";
    if (hasRequest) {
      points = 20;
      basis = "Есть опубликованный запрос/заказ с источником";
    } else if (recs.length) {
      points = 14;
      basis = `AI-анализ предложил ${recs.length} релевантн. услуг(и) (гипотеза, требует проверки)`;
    }
    factors.push({
      key: "service_relevance",
      label: "Релевантность услуги",
      max: 20,
      points,
      basis,
      confidence: hasRequest ? "high" : recs.length ? "medium" : "low",
    });
  }

  // 3. Актуальность публичного запроса
  {
    const req = sources.filter((s) => s.sourceType === "job_post").sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
    let points = 0;
    let basis = "Публичный запрос не обнаружен";
    if (req) {
      const age = Math.round(ageDays(now, req.capturedAt));
      if (age <= 30) {
        points = 15;
        basis = `Запрос обнаружен ${age} дн. назад`;
      } else if (age <= 90) {
        points = 8;
        basis = `Запрос обнаружен ${age} дн. назад — мог потерять актуальность`;
      } else {
        points = 2;
        basis = `Запросу больше ${age} дн. — вероятно неактуален`;
      }
    }
    factors.push({ key: "request_freshness", label: "Актуальность публичного запроса", max: 15, points, basis, confidence: req ? "high" : "medium" });
  }

  // 4. Качество и свежесть данных
  {
    const t = tally();
    const age = ageDays(now, client.lastCheckedAt);
    if (age <= 30) t.add(10, "данные проверены в последние 30 дней");
    else if (age <= 90) t.add(5, "данные проверены в последние 90 дней");
    else t.note(client.lastCheckedAt ? "данные давно не проверялись" : "данные ни разу не проверялись");
    if (sources.length >= 2) t.add(6, `${sources.length} источника(ов)`);
    else if (sources.length === 1) t.add(3, "1 источник");
    else t.note("нет источников");
    if (client.website) t.add(4, "указан сайт");
    if (input.conflicts > 0) {
      t.points = Math.max(0, t.points - 4);
      t.note(`конфликтов данных: ${input.conflicts}`);
    }
    factors.push({ key: "data_quality", label: "Качество и свежесть данных", max: 20, points: Math.min(20, t.points), basis: t.why.join("; "), confidence: "high" });
  }

  // 5. Доступность делового контакта
  {
    const usable = contacts.filter((c) => !c.doNotContact && c.verificationStatus !== "invalid" && c.type !== "website");
    const verified = usable.filter((c) => c.verificationStatus === "formal" || c.verificationStatus === "confirmed");
    let points = 0;
    let basis = "Нет пригодных контактов";
    if (verified.length) {
      points = 15;
      basis = `Проверенных контактов: ${verified.length}`;
    } else if (usable.length) {
      points = 8;
      basis = `Контакты найдены (${usable.length}), но не проверены`;
    }
    factors.push({ key: "contact_availability", label: "Доступность делового контакта", max: 15, points, basis, confidence: "high" });
  }

  // 6. География и критерии кампании
  {
    const t = tally();
    if (client.country) t.add(6, `страна: ${client.country}`);
    if (client.city) t.add(4, `город: ${client.city}`);
    factors.push({
      key: "geo",
      label: "География и критерии кампании",
      max: 10,
      points: t.points,
      basis: t.why.length ? t.why.join("; ") : "География не указана",
      confidence: "medium",
    });
  }

  const score = Math.max(0, Math.min(100, Math.round(factors.reduce((s, f) => s + f.points, 0))));
  const weak = factors.filter((f) => f.points / f.max < 0.4).map((f) => f.label.toLowerCase());
  const explanation =
    `Эвристическая оценка по ${factors.length} факторам (не вероятность покупки). ` + (weak.length ? `Слабые места: ${weak.join(", ")}.` : "Все факторы заполнены хорошо.");
  return { score, factors, explanation };
}

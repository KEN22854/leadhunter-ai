import type { CategoryKind } from "./categories";

// Автоматический аудит онлайн-присутствия по правилам (без AI): что можно или нужно улучшить.
// Каждый пункт — наблюдаемый факт с объяснением, а не догадка. Чистая функция, покрыта тестами.

export type AuditSeverity = "critical" | "major" | "minor" | "ok";
export type AuditItem = { key: string; severity: AuditSeverity; title: string; detail: string; recommendation: string };
export type SiteAudit = {
  version: 1;
  kind: CategoryKind;
  checkedAt: string;
  url: string | null;
  score: number; // 0–100: состояние сайта (100 — улучшать почти нечего)
  opportunity: "high" | "medium" | "low"; // насколько есть что предложить
  summary: string;
  items: AuditItem[];
};

export type AuditPage = { url: string; html: string; text: string; elapsedMs: number; bytes: number; truncated: boolean };

export type AuditInput = {
  kind: CategoryKind;
  website: string;
  fetchError?: string | null;
  pages: AuditPage[]; // первая — главная
  hasSocialInOsm?: boolean;
  now?: Date;
};

const PENALTY: Record<AuditSeverity, number> = { critical: 40, major: 12, minor: 4, ok: 0 };

const SOCIAL_HOSTS = /(^|\.)(vk\.com|vk\.ru|t\.me|telegram\.me|instagram\.com|facebook\.com|ok\.ru|wa\.me|taplink\.(cc|ws|ru)|linktr\.ee|2gis\.ru|yandex\.ru)$/i;

/** Ссылка ведёт не на собственный сайт, а на соцсеть/каталог. */
export function socialHost(website: string): string | null {
  if (!website) return null;
  try {
    const h = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "");
    return SOCIAL_HOSTS.test(h) ? h : null;
  } catch {
    return null;
  }
}

export function auditSite(input: AuditInput): SiteAudit {
  const now = input.now ?? new Date();
  const items: AuditItem[] = [];
  const push = (key: string, severity: AuditSeverity, title: string, detail: string, recommendation: string) => items.push({ key, severity, title, detail, recommendation });
  const home = input.pages[0];

  const social = socialHost(input.website);
  if (social) {
    push(
      "social_only",
      "critical",
      "Нет собственного сайта — только страница в соцсети",
      `Вместо сайта указана страница на ${social}.`,
      "Собственный сайт или лендинг: его находят в поиске и на картах, им можно делиться, в нём есть меню/услуги, цены и запись — независимо от правил соцсети.",
    );
  } else if (!input.website) {
    push(
      "no_website",
      "critical",
      "Нет собственного сайта",
      "В открытых данных у компании не указан сайт.",
      "Простой сайт-визитка или лендинг: меню/услуги, цены, адрес с картой, часы работы, кнопка звонка/брони. Это помогает в поиске и на картах.",
    );
  } else if (!home) {
    // Сбой может быть и на нашей стороне (сеть, защита от ботов), поэтому не «критично», а «проверить вручную»
    const dns = /домен не найден/i.test(input.fetchError ?? "");
    push(
      "site_unreachable",
      dns ? "critical" : "major",
      dns ? "Домен сайта не отвечает" : "Сайт не открылся при автоматической проверке",
      `${input.website}: ${input.fetchError || "нет ответа"}.`,
      dns
        ? "Проверить, продлён ли домен и настроен ли DNS — посетители сейчас не могут открыть сайт."
        : "Откройте сайт вручную: если он не работает и у вас — проблема в хостинге или SSL-сертификате; если работает — пункт можно не учитывать.",
    );
  }

  if (home) {
    const html = input.pages.map((p) => p.html).join("\n");
    const homeHtml = home.html;
    const text = input.pages.map((p) => p.text).join("\n").toLowerCase();
    const url = new URL(home.url);

    if (url.protocol !== "https:")
      push("no_https", "major", "Нет защищённого соединения (HTTPS)", "Сайт открывается по http://. Браузеры помечают такие сайты как «Не защищено».", "Подключить SSL-сертификат (часто бесплатно) и настроить редирект на https.");
    else push("https", "ok", "HTTPS включён", "Сайт открывается по защищённому протоколу.", "");

    if (!/<meta[^>]+name=["']viewport["']/i.test(homeHtml))
      push("no_viewport", "major", "Сайт не адаптирован под телефоны", "На главной нет meta viewport — на смартфоне страница, скорее всего, отображается уменьшенной копией десктопа.", "Адаптивная вёрстка под мобильные: большинство посетителей кафе и услуг заходят с телефона.");
    else push("viewport", "ok", "Есть мобильная разметка", "Найден meta viewport.", "");

    if (home.elapsedMs > 3000)
      push("slow", "major", "Медленная загрузка", `Главная отвечала ${(home.elapsedMs / 1000).toFixed(1)} с (только HTML, без картинок).`, "Оптимизировать хостинг, кеширование и изображения; цель — до 1–1,5 с на ответ сервера.");
    else if (home.elapsedMs > 1500)
      push("slowish", "minor", "Загрузка могла бы быть быстрее", `Ответ главной ~${(home.elapsedMs / 1000).toFixed(1)} с.`, "Проверить кеширование и хостинг.");
    if (home.truncated || home.bytes > 1_000_000)
      push("heavy", "major", "Тяжёлая главная страница", `HTML главной весит ${(home.bytes / 1024 / 1024).toFixed(1)} МБ и больше.`, "Убрать встроенные ресурсы и лишний код, сжать изображения.");

    const title = homeHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    if (!title || title.length < 10)
      push("weak_title", "minor", "Пустой или короткий заголовок страницы", title ? `Заголовок: «${title}».` : "Тег <title> пустой или отсутствует.", "Заголовок с названием, видом бизнеса и городом — так компанию проще найти в поиске.");
    if (!/<meta[^>]+name=["']description["'][^>]*content=["'][^"']{30,}/i.test(homeHtml))
      push("no_description", "minor", "Нет описания для поисковиков", "Не найден содержательный meta description.", "Добавить описание 120–160 символов: что, где, чем отличаетесь.");
    if (!/<h1[\s>]/i.test(homeHtml)) push("no_h1", "minor", "Нет главного заголовка H1", "На главной нет заголовка первого уровня.", "Добавить H1 с ключевым предложением.");
    if (!/property=["']og:(title|image)["']/i.test(homeHtml))
      push("no_og", "minor", "Ссылка на сайт без превью в мессенджерах", "Нет разметки Open Graph — в Telegram/WhatsApp ссылка выглядит как голый текст.", "Добавить og:title, og:description и og:image.");
    if (!/<link[^>]+rel=["'][^"']*icon/i.test(homeHtml)) push("no_favicon", "minor", "Нет иконки сайта (favicon)", "В HTML не указана иконка.", "Добавить favicon с логотипом.");
    if (!/application\/ld\+json/i.test(html))
      push("no_schema", "minor", "Нет микроразметки организации", "Не найдена разметка schema.org (JSON-LD).", "Разметка LocalBusiness/Restaurant с адресом, часами и телефоном улучшает сниппеты в поиске и картах.");

    const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:[^<\d]{0,20})?((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?/gi)].map((m) => Number(m[2] || m[1]));
    const lastYear = years.length ? Math.max(...years) : null;
    if (lastYear && now.getFullYear() - lastYear >= 2)
      push("stale", "minor", "Сайт давно не обновлялся", `В подвале указан ${lastYear} год.`, "Обновить контент и год в подвале — устаревший сайт снижает доверие.");

    if (/\.swf["']|<embed[^>]+flash/i.test(html)) push("flash", "major", "Используется Flash", "Найдены Flash-элементы, которые браузеры больше не показывают.", "Заменить на современные изображения/видео.");
    if (/jquery[.-]?1\.[0-9]/i.test(html)) push("old_jquery", "minor", "Устаревшие библиотеки", "Подключён jQuery 1.x.", "Обновить фронтенд-зависимости.");

    const hasPhone = /href=["']tel:/i.test(html);
    const hasMail = /href=["']mailto:/i.test(html) || /[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
    if (!hasPhone && !hasMail)
      push("no_contacts", "major", "Трудно связаться", "Не найдены кликабельный телефон (tel:) и email на проверенных страницах.", "Кнопка звонка, мессенджеры и форма заявки на видном месте.");
    else if (!hasPhone) push("no_tel_link", "minor", "Телефон не кликабелен", "Нет ссылок tel: — с телефона нельзя позвонить в одно касание.", "Оформить телефон ссылкой tel:.");

    const hasSocial = /(vk\.com|t\.me\/|instagram\.com|wa\.me|whatsapp|youtube\.com|ok\.ru|facebook\.com|tiktok\.com|dzen\.ru)/i.test(html);
    if (!hasSocial && !input.hasSocialInOsm) push("no_social", "minor", "Нет ссылок на соцсети и мессенджеры", "На сайте не найдены ссылки на VK, Telegram, WhatsApp и т.п.", "Добавить ссылки на активные каналы — для многих клиентов это основной способ связи.");
    const hasMap = /(yandex\.(ru|com)\/map|maps\.google|google\.[a-z.]+\/maps|2gis\.|api-maps\.yandex|openstreetmap)/i.test(html);
    if (["food", "beauty", "health", "hospitality", "service"].includes(input.kind) && !hasMap)
      push("no_map", "minor", "Нет карты проезда", "Не найдена встроенная карта или ссылка на карты.", "Добавить карту и ссылку «Построить маршрут».");

    if (input.kind === "food") {
      if (!/(меню|menu|блюд|напит|кофе|десерт)/i.test(text))
        push("no_menu", "major", "Не видно меню", "На проверенных страницах не найдено меню или упоминания блюд/напитков.", "Онлайн-меню с ценами и фото — самый посещаемый раздел сайта общепита.");
      if (!/(брон|резерв|заказ|доставк|order|book|reserv|delivery|самовывоз)/i.test(text))
        push("no_booking", "minor", "Нет онлайн-заказа или брони", "Не найдены бронь столика, предзаказ или доставка.", "Кнопка брони/предзаказа или ссылка на агрегатор доставки.");
    }
    if (input.kind === "beauty" || input.kind === "health" || input.kind === "service") {
      if (!/(запис|онлайн-запис|yclients|dikidi|book|appointment|заявк)/i.test(text))
        push("no_online_booking", "major", "Нет онлайн-записи", "Не найдена онлайн-запись или форма заявки.", "Подключить онлайн-запись (виджет) или форму с обратным звонком.");
      if (!/(цен|прайс|стоимост|руб|₽|price)/i.test(text)) push("no_prices", "minor", "Не указаны цены", "Не найден прайс или стоимость услуг.", "Добавить прайс или «цены от» — это снижает число лишних звонков.");
    }
    if (input.kind === "hospitality" && !/(брон|book|reserv|номер|room)/i.test(text))
      push("no_room_booking", "major", "Нет бронирования", "Не найдено бронирование номеров на сайте.", "Модуль бронирования напрямую — без комиссии агрегаторов.");
  }

  const score = Math.max(0, Math.min(100, 100 - items.reduce((s, i) => s + PENALTY[i.severity], 0)));
  const problems = items.filter((i) => i.severity !== "ok");
  const critical = problems.filter((i) => i.severity === "critical").length;
  const major = problems.filter((i) => i.severity === "major").length;
  const opportunity = critical || major >= 2 ? "high" : major || problems.length >= 3 ? "medium" : "low";
  const summary = !problems.length
    ? "Явных проблем по автоматическим проверкам не найдено."
    : `Найдено: ${critical ? `критичных — ${critical}, ` : ""}${major ? `важных — ${major}, ` : ""}мелких — ${problems.filter((i) => i.severity === "minor").length}. Главное: ${problems
        .sort((a, b) => PENALTY[b.severity] - PENALTY[a.severity])
        .slice(0, 2)
        .map((p) => p.title.toLowerCase())
        .join("; ")}.`;
  return { version: 1, kind: input.kind, checkedAt: now.toISOString(), url: input.pages[0]?.url ?? (input.website || null), score, opportunity, summary, items };
}

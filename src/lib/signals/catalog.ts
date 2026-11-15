// Каталог источников модуля «Спрос». Чистые метаданные (используются и на клиенте).
// access:
//  - public   — открытые данные без ключа (RSS, официальный публичный API, публичная страница, разрешённая robots.txt);
//  - api_key  — официальный API, нужен ключ/токен владельца аккаунта (переменные в .env);
//  - manual   — у площадки нет разрешённого способа автоматического поиска: система строит ссылки поиска,
//               а найденную публикацию пользователь добавляет вручную (дальше — тот же анализ и скоринг);
//  - closed   — официальный API закрыт площадкой.
// reply — допустимые способы связи (см. Outreach Channel Manager).

export type SourceGroup = "social" | "freelance" | "business" | "creative" | "community";
export type SourceAccess = "public" | "api_key" | "manual" | "closed";
export type ReplyMode = "api" | "open_dialog" | "platform_reply";
/** freelance — биржа (публикация = заказ), jobs — площадка вакансий, social — пост/комментарий, community — статья/обсуждение, directory — каталог компаний */
export type SourceKind = "freelance" | "jobs" | "social" | "community" | "directory" | "launch";

export type SourceMeta = {
  key: string;
  label: string;
  group: SourceGroup;
  kind: SourceKind;
  access: SourceAccess;
  env?: string[];
  quality: number; // 1–10, для скоринга
  reply: ReplyMode[];
  replyHint: string;
  note: string;
  /** Ссылка поиска на площадке для ручного режима, {q} — запрос */
  searchUrl?: string;
  docs?: string;
};

export const GROUPS: Record<SourceGroup, string> = {
  social: "Соцсети",
  freelance: "Фриланс-биржи",
  business: "Бизнес и поиск",
  creative: "Креативные платформы",
  community: "Сообщества",
};

export const SOURCES: SourceMeta[] = [
  // ---------- SOCIAL ----------
  { key: "threads", label: "Threads", group: "social", kind: "social", access: "api_key", env: ["THREADS_ACCESS_TOKEN"], quality: 6, reply: ["open_dialog"], replyHint: "Ответ в треде: через официальный API (с вашим одобрением, лимитами и паузами) или вручную", note: "Threads API: поиск по ключевым словам (threads_keyword_search, 2200 запросов/сутки) и ответы на найденные посты (threads_content_publish + threads_manage_replies, до 1000 ответов/сутки у Meta).", searchUrl: "https://www.threads.net/search?q={q}", docs: "https://developers.facebook.com/docs/threads/keyword-search" },
  { key: "instagram", label: "Instagram", group: "social", kind: "social", access: "api_key", env: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USER_ID"], quality: 5, reply: ["open_dialog"], replyHint: "Комментарий/Direct вручную в приложении", note: "Instagram Graph API: поиск по хэштегу (бизнес-аккаунт; до 30 хэштегов в неделю). Автор поста API не отдаёт.", searchUrl: "https://www.instagram.com/explore/tags/{tag}/", docs: "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search" },
  { key: "telegram", label: "Telegram", group: "social", kind: "social", access: "public", quality: 7, reply: ["open_dialog"], replyHint: "Открыть пост/автора и написать вручную", note: "Публичные каналы и чаты по их веб-превью t.me/s/<канал>. Список каналов задаётся в кампании. Личные чаты и закрытые группы не читаются." },
  { key: "linkedin", label: "LinkedIn", group: "social", kind: "social", access: "manual", quality: 7, reply: ["open_dialog"], replyHint: "Сообщение или комментарий вручную", note: "Публичного API поиска постов нет (Marketing API — только свои страницы). Ручной режим: ссылки поиска + добавление публикации.", searchUrl: "https://www.linkedin.com/search/results/content/?keywords={q}&sortBy=%22date_posted%22" },
  { key: "facebook", label: "Facebook", group: "social", kind: "social", access: "manual", quality: 5, reply: ["open_dialog"], replyHint: "Комментарий в группе вручную", note: "Поиск по группам через Graph API отключён Meta. Ручной режим.", searchUrl: "https://www.facebook.com/search/posts/?q={q}" },
  { key: "vk", label: "VK", group: "social", kind: "social", access: "api_key", env: ["VK_ACCESS_TOKEN"], quality: 6, reply: ["open_dialog"], replyHint: "Комментарий или сообщение вручную", note: "VK API newsfeed.search — поиск по открытым записям (нужен пользовательский токен).", searchUrl: "https://vk.com/search?c%5Bq%5D={q}&c%5Bsection%5D=statuses", docs: "https://dev.vk.com/ru/method/newsfeed.search" },
  { key: "reddit", label: "Reddit", group: "social", kind: "social", access: "api_key", env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], quality: 7, reply: ["open_dialog"], replyHint: "Ответ в теме или личное сообщение вручную", note: "Официальный OAuth API (app-only). Анонимные запросы Reddit блокирует. Сабреддиты задаются в кампании (по умолчанию r/forhire, r/slavelabour…).", searchUrl: "https://www.reddit.com/search/?q={q}&sort=new", docs: "https://www.reddit.com/dev/api/" },
  { key: "x", label: "X / Twitter", group: "social", kind: "social", access: "api_key", env: ["X_BEARER_TOKEN"], quality: 6, reply: ["open_dialog"], replyHint: "Ответ на пост вручную", note: "X API v2 recent search (платный тариф Basic и выше).", searchUrl: "https://x.com/search?q={q}&f=live", docs: "https://docs.x.com/x-api/posts/search-recent-posts" },
  { key: "discord", label: "Discord", group: "social", kind: "social", access: "api_key", env: ["DISCORD_BOT_TOKEN"], quality: 6, reply: ["open_dialog"], replyHint: "Ответ в канале вручную", note: "Бот читает только каналы серверов, куда его добавили администраторы (ID каналов — в кампании; нужен Message Content Intent).", docs: "https://discord.com/developers/docs/resources/message#get-channel-messages" },

  // ---------- FREELANCE ----------
  { key: "kwork", label: "Kwork", group: "freelance", kind: "freelance", access: "public", quality: 9, reply: ["platform_reply"], replyHint: "Предложение через биржу Kwork", note: "Первая страница открытой биржи проектов kwork.ru/projects (разрешена robots.txt), не чаще раза в 10 минут." },
  { key: "fl_ru", label: "FL.ru", group: "freelance", kind: "freelance", access: "public", quality: 9, reply: ["platform_reply"], replyHint: "Ответ на проект на FL.ru", note: "Официальная RSS-лента новых проектов FL.ru (опубликована площадкой для подписки)." },
  { key: "freelance_ru", label: "Freelance.ru", group: "freelance", kind: "freelance", access: "manual", quality: 8, reply: ["platform_reply"], replyHint: "Отклик на проект на Freelance.ru", note: "Нет API и RSS. Ручной режим: ссылка на поиск проектов.", searchUrl: "https://freelance.ru/project/search?q={q}" },
  { key: "upwork", label: "Upwork", group: "freelance", kind: "freelance", access: "manual", quality: 9, reply: ["platform_reply"], replyHint: "Proposal через Upwork (Connects)", note: "GraphQL API доступен только одобренным партнёрам; RSS отключён. Ручной режим.", searchUrl: "https://www.upwork.com/nx/search/jobs/?q={q}&sort=recency" },
  { key: "fiverr", label: "Fiverr", group: "freelance", kind: "freelance", access: "manual", quality: 6, reply: ["platform_reply"], replyHint: "Ответ через Fiverr", note: "Публичного API заказов нет (Buyer Requests видны только продавцам). Ручной режим.", searchUrl: "https://www.fiverr.com/search/gigs?query={q}" },
  { key: "peopleperhour", label: "PeoplePerHour", group: "freelance", kind: "freelance", access: "manual", quality: 7, reply: ["platform_reply"], replyHint: "Proposal через PeoplePerHour", note: "Публичного API нет. Ручной режим.", searchUrl: "https://www.peopleperhour.com/freelance-jobs?q={q}" },
  { key: "freelancer", label: "Freelancer.com", group: "freelance", kind: "freelance", access: "public", quality: 8, reply: ["platform_reply"], replyHint: "Bid через Freelancer.com", note: "Официальный публичный API активных проектов (без ключа).", docs: "https://developers.freelancer.com/docs/projects/projects" },

  // ---------- BUSINESS ----------
  { key: "google_maps", label: "Google Maps", group: "business", kind: "directory", access: "api_key", env: ["GOOGLE_PLACES_API_KEY"], quality: 5, reply: ["open_dialog"], replyHint: "Связь через сайт/контакты компании", note: "Places API (New) Text Search. Компании без явного запроса → потенциальные лиды.", docs: "https://developers.google.com/maps/documentation/places/web-service/text-search" },
  { key: "yandex_maps", label: "Яндекс Карты", group: "business", kind: "directory", access: "api_key", env: ["YANDEX_MAPS_API_KEY"], quality: 5, reply: ["open_dialog"], replyHint: "Связь через сайт/контакты компании", note: "API поиска по организациям (ключ из кабинета разработчика Яндекса).", docs: "https://yandex.ru/maps-api/docs/geosearch-api/" },
  { key: "2gis", label: "2ГИС", group: "business", kind: "directory", access: "api_key", env: ["DGIS_API_KEY"], quality: 5, reply: ["open_dialog"], replyHint: "Связь через сайт/контакты компании", note: "Places API 2ГИС (catalog.api.2gis.com).", docs: "https://docs.2gis.com/ru/api/search/places/overview" },
  { key: "google_search", label: "Google Search", group: "business", kind: "social", access: "api_key", env: ["GOOGLE_CSE_KEY", "GOOGLE_CSE_CX"], quality: 4, reply: ["open_dialog"], replyHint: "Открыть найденную страницу", note: "Custom Search JSON API (ключ + ID поисковой системы).", docs: "https://developers.google.com/custom-search/v1/overview" },
  { key: "yandex_search", label: "Яндекс Поиск", group: "business", kind: "social", access: "api_key", env: ["YANDEX_SEARCH_API_KEY", "YANDEX_FOLDER_ID"], quality: 4, reply: ["open_dialog"], replyHint: "Открыть найденную страницу", note: "Yandex Search API (Yandex Cloud), XML-ответ.", docs: "https://yandex.cloud/ru/docs/search-api/" },
  { key: "bing", label: "Bing", group: "business", kind: "social", access: "closed", quality: 4, reply: ["open_dialog"], replyHint: "—", note: "Microsoft закрыла Bing Search API 11.08.2025. Источник недоступен.", searchUrl: "https://www.bing.com/search?q={q}" },
  { key: "crunchbase", label: "Crunchbase", group: "business", kind: "launch", access: "api_key", env: ["CRUNCHBASE_API_KEY"], quality: 5, reply: ["open_dialog"], replyHint: "Связь через сайт компании", note: "Crunchbase API v4: недавно основанные компании по ключевым словам (сигнал «запуск»).", docs: "https://data.crunchbase.com/docs" },
  { key: "product_hunt", label: "Product Hunt", group: "business", kind: "launch", access: "public", quality: 5, reply: ["open_dialog"], replyHint: "Комментарий к запуску / сайт продукта", note: "Публичная Atom-лента запусков: свежие продукты = «планирует/запустил проект»." },
  { key: "clutch", label: "Clutch", group: "business", kind: "directory", access: "manual", quality: 4, reply: ["open_dialog"], replyHint: "—", note: "Каталог агентств, API нет, защищён от ботов. Ручной режим.", searchUrl: "https://clutch.co/search?q={q}" },

  // ---------- CREATIVE ----------
  { key: "behance", label: "Behance", group: "creative", kind: "jobs", access: "manual", quality: 6, reply: ["platform_reply"], replyHint: "Отклик через Behance", note: "Публичный API Behance закрыт Adobe. Ручной режим.", searchUrl: "https://www.behance.net/joblist?search={q}" },
  { key: "dribbble", label: "Dribbble", group: "creative", kind: "jobs", access: "public", quality: 7, reply: ["platform_reply"], replyHint: "Отклик на вакансию через Dribbble", note: "Официальная RSS-лента вакансий для дизайнеров." },
  { key: "pinterest", label: "Pinterest", group: "creative", kind: "social", access: "manual", quality: 3, reply: ["open_dialog"], replyHint: "—", note: "API поиска пинов доступен только одобренным приложениям. Ручной режим.", searchUrl: "https://www.pinterest.com/search/pins/?q={q}" },

  // ---------- COMMUNITIES ----------
  { key: "indie_hackers", label: "Indie Hackers", group: "community", kind: "community", access: "manual", quality: 5, reply: ["open_dialog"], replyHint: "Ответ в обсуждении вручную", note: "API нет, сайт защищён от автоматического доступа. Ручной режим.", searchUrl: "https://www.indiehackers.com/search?q={q}" },
  { key: "vc_ru", label: "VC.ru", group: "community", kind: "community", access: "public", quality: 5, reply: ["open_dialog"], replyHint: "Комментарий к статье / автор", note: "Официальная RSS-лента новых материалов; фильтрация по смыслу." },
  { key: "habr", label: "Хабр", group: "community", kind: "community", access: "public", quality: 5, reply: ["open_dialog"], replyHint: "Комментарий / личное сообщение вручную", note: "RSS поиска по публикациям Хабра." },
  { key: "habr_freelance", label: "Хабр Фриланс", group: "freelance", kind: "freelance", access: "manual", quality: 8, reply: ["platform_reply"], replyHint: "Отклик на заказ на Хабр Фрилансе", note: "robots.txt запрещает автоматический доступ. Ручной режим.", searchUrl: "https://freelance.habr.com/tasks?q={q}" },
  { key: "hn", label: "Hacker News", group: "community", kind: "community", access: "public", quality: 6, reply: ["open_dialog"], replyHint: "Ответ в обсуждении вручную", note: "Официальный поисковый API (Algolia) по постам и комментариям, включая «Who is hiring»." },
  { key: "custom_rss", label: "Свои RSS-ленты", group: "community", kind: "community", access: "public", quality: 5, reply: ["open_dialog"], replyHint: "Открыть публикацию", note: "Публичные бизнес-сообщества и блоги по их RSS/Atom — адреса задаются в кампании." },
  { key: "manual", label: "Добавлено вручную", group: "community", kind: "social", access: "manual", quality: 6, reply: ["open_dialog"], replyHint: "Открыть публикацию", note: "Публикация, которую пользователь нашёл сам и добавил в систему." },
];

export const SOURCE_MAP: Record<string, SourceMeta> = Object.fromEntries(SOURCES.map((s) => [s.key, s]));

export const SELECTABLE_SOURCES = SOURCES.filter((s) => s.key !== "manual");

export function sourceLabel(key: string) {
  return SOURCE_MAP[key]?.label ?? key;
}

export function manualSearchUrl(key: string, query: string) {
  const s = SOURCE_MAP[key];
  if (!s?.searchUrl) return null;
  const tag = query.toLowerCase().replace(/[^\p{L}\d]+/gu, "");
  return s.searchUrl.replace("{q}", encodeURIComponent(query)).replace("{tag}", encodeURIComponent(tag));
}

export const ACCESS_LABEL: Record<SourceAccess, string> = {
  public: "Открытые данные",
  api_key: "Официальный API (ключ)",
  manual: "Ручной режим",
  closed: "API закрыт",
};

export const REPLY_LABEL: Record<ReplyMode, string> = {
  api: "Отправка через официальный канал",
  open_dialog: "Открыть диалог и отправить вручную",
  platform_reply: "Отклик через механизм площадки",
};

// Многоязычные словари модуля «Спрос в соцсетях»: услуги, синонимы, шаблоны намерений.
// Расширяемая локализация: чтобы добавить язык, добавьте его ключ в LANGS и заполните записи
// INTENT_PATTERNS[lang], NEGATIVE_PATTERNS[lang] и terms[lang] у услуг (недостающие языки просто не участвуют).

export const LANGS = {
  ru: "Русский",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
} as const;
export type Lang = keyof typeof LANGS;
export const LANG_KEYS = Object.keys(LANGS) as Lang[];

export type ServiceDef = {
  label: string;
  /** Ключ услуги CRM (src/lib/domain.ts SERVICES) — для конвертации лида в клиента */
  crmService: string;
  /** Термины по языкам. Термин из ≥4 букв совпадает как начало слова («дизайнер» → «дизайнера»), короткие — целым словом */
  terms: Partial<Record<Lang, string[]>>;
  /** Поисковые фразы для источников с текстовым поиском (API, RSS-поиск) */
  queries: Partial<Record<Lang, string[]>>;
};

export const SIGNAL_SERVICES: Record<string, ServiceDef> = {
  website: {
    label: "Сайты и лендинги",
    crmService: "website",
    terms: {
      ru: ["сайт", "лендинг", "landing", "интернет-магазин", "веб-разработ", "веб-дизайн", "tilda", "тильд", "wordpress", "вордпресс", "битрикс", "webflow", "одностраничник", "посадочн"],
      en: ["website", "web site", "landing page", "web design", "web developer", "webflow", "wordpress", "shopify", "online store", "e-commerce site", "ecommerce site", "web page"],
      de: ["webseite", "website", "homepage", "landingpage", "onlineshop", "webdesign"],
      fr: ["site web", "site internet", "site vitrine", "page d'atterrissage", "boutique en ligne", "webdesign"],
      es: ["sitio web", "página web", "pagina web", "landing", "tienda online", "diseño web"],
    },
    queries: {
      ru: ["нужен сайт", "ищу разработчика сайта", "сделать лендинг", "кто делает сайты", "посоветуйте веб-студию"],
      en: ["need a website", "looking for a web developer", "hiring web designer", "need landing page", "looking for an agency website"],
      de: ["suche webdesigner", "brauche eine website"],
      fr: ["cherche développeur site web", "besoin d'un site internet"],
      es: ["busco diseñador web", "necesito una página web"],
    },
  },
  design: {
    label: "Дизайн (UI/UX, графика)",
    crmService: "branding",
    terms: {
      ru: ["дизайнер", "дизайн", "ui", "ux", "макет", "figma", "фигма", "баннер", "презентац", "иллюстрац", "веб-дизайнер", "графическ"],
      en: ["designer", "design", "ui", "ux", "figma", "mockup", "banner", "illustration", "graphic design", "pitch deck", "presentation design"],
      de: ["designer", "grafikdesign", "gestaltung", "figma"],
      fr: ["graphiste", "designer", "maquette", "figma", "conception graphique"],
      es: ["diseñador", "diseñadora", "diseño gráfico", "figma", "maqueta"],
    },
    queries: {
      ru: ["ищу дизайнера", "нужен дизайнер", "ищу ui/ux дизайнера"],
      en: ["looking for a designer", "hiring a designer", "need a ui ux designer"],
      de: ["suche designer", "suche grafikdesigner"],
      fr: ["cherche graphiste", "cherche designer"],
      es: ["busco diseñador", "necesito diseñador"],
    },
  },
  branding: {
    label: "Брендинг и логотипы",
    crmService: "branding",
    terms: {
      ru: ["логотип", "лого", "брендинг", "бренд", "фирменный стиль", "айдентик", "нейминг", "брендбук"],
      en: ["logo", "branding", "brand identity", "brand book", "brandbook", "visual identity", "rebrand", "naming"],
      de: ["logo", "branding", "markenidentität", "corporate design"],
      fr: ["logo", "branding", "identité visuelle", "charte graphique"],
      es: ["logo", "logotipo", "branding", "identidad de marca", "identidad visual"],
    },
    queries: {
      ru: ["нужен логотип", "запускаю бренд", "ищу специалиста по брендингу"],
      en: ["need a logo", "seeking a branding specialist", "launching a brand", "looking for branding agency"],
      de: ["suche logo designer"],
      fr: ["cherche créateur de logo"],
      es: ["necesito un logotipo"],
    },
  },
  smm: {
    label: "SMM и соцсети",
    crmService: "smm",
    terms: {
      ru: ["smm", "смм", "смм-специалист", "таргет", "таргетолог", "ведение соц", "ведение инст", "контент-план", "сторис", "рилс", "reels", "соцсет"],
      en: ["smm", "social media", "social media manager", "content creator", "community manager", "instagram manager", "tiktok", "reels", "content plan"],
      de: ["social media", "social-media-manager", "content creator"],
      fr: ["réseaux sociaux", "community manager", "social media"],
      es: ["redes sociales", "community manager", "social media"],
    },
    queries: {
      ru: ["нужен smm", "ищу smm специалиста", "ищу таргетолога"],
      en: ["need smm", "looking for social media manager", "hiring social media manager"],
      de: ["suche social media manager"],
      fr: ["cherche community manager"],
      es: ["busco community manager"],
    },
  },
  marketplace_cards: {
    label: "Карточки товаров для маркетплейсов",
    crmService: "marketplace_cards",
    terms: {
      ru: ["карточки товар", "карточек товар", "карточку товар", "инфографик", "wildberries", "вайлдберриз", "вб ", "ozon", "озон", "маркетплейс", "rich-контент", "яндекс маркет"],
      en: ["product listing", "amazon listing", "product images", "infographic", "marketplace", "etsy listing", "product photos"],
      de: ["produktbilder", "amazon listing", "marktplatz"],
      fr: ["fiche produit", "infographie", "marketplace"],
      es: ["ficha de producto", "infografía", "marketplace"],
    },
    queries: {
      ru: ["кто делает карточки товаров", "нужна инфографика для wildberries", "ищу дизайнера карточек ozon"],
      en: ["need amazon listing images", "looking for product infographics designer"],
    },
  },
  development: {
    label: "Разработка (приложения, боты)",
    crmService: "app",
    terms: {
      ru: ["разработчик", "программист", "бот", "телеграм-бот", "telegram-бот", "чат-бот", "приложени", "backend", "бэкенд", "frontend", "фронтенд", "python", "react", "автоматизац", "парсер", "интеграци"],
      en: ["developer", "programmer", "app", "mobile app", "bot", "chatbot", "telegram bot", "full-stack", "fullstack", "backend", "frontend", "react", "python", "automation", "mvp", "saas"],
      de: ["entwickler", "programmierer", "app", "softwareentwicklung"],
      fr: ["développeur", "developpeur", "application", "appli", "programmeur"],
      es: ["desarrollador", "programador", "aplicación", "app", "bot"],
    },
    queries: {
      ru: ["ищу разработчика", "нужен программист", "нужен телеграм бот", "ищу разработчика приложения"],
      en: ["hiring a developer", "looking for a developer", "need a developer for mvp", "looking for technical cofounder"],
      de: ["suche entwickler", "suche app entwickler"],
      fr: ["cherche développeur", "recherche développeur"],
      es: ["busco desarrollador", "busco programador"],
    },
  },
  video: {
    label: "Видео и моушн",
    crmService: "custom",
    terms: {
      ru: ["видеомонтаж", "монтаж видео", "монтажер", "моушн", "анимац", "ролик", "видеограф", "reels"],
      en: ["video editor", "video editing", "motion design", "animation", "explainer video", "videographer"],
      de: ["videoschnitt", "videograf", "animation"],
      fr: ["montage vidéo", "motion design", "vidéaste"],
      es: ["edición de video", "editor de video", "animación"],
    },
    queries: { ru: ["ищу монтажера", "нужен видеомонтаж"], en: ["looking for a video editor", "hiring video editor"] },
  },
  copywriting: {
    label: "Тексты и копирайтинг",
    crmService: "custom",
    terms: {
      ru: ["копирайтер", "копирайтинг", "тексты", "текст для сайта", "статьи", "рерайт", "редактор"],
      en: ["copywriter", "copywriting", "content writer", "blog posts", "ghostwriter"],
      de: ["texter", "copywriter"],
      fr: ["rédacteur", "copywriter", "rédaction"],
      es: ["redactor", "copywriter", "redacción"],
    },
    queries: { ru: ["ищу копирайтера", "нужны тексты для сайта"], en: ["looking for a copywriter", "hiring copywriter"] },
  },
  seo: {
    label: "SEO и продвижение",
    crmService: "custom",
    terms: {
      ru: ["seo", "сео", "продвижение сайта", "контекстн", "яндекс директ", "директолог", "трафик"],
      en: ["seo", "search engine optimization", "google ads", "ppc", "performance marketing"],
      de: ["seo", "suchmaschinenoptimierung", "google ads"],
      fr: ["seo", "référencement"],
      es: ["seo", "posicionamiento web"],
    },
    queries: { ru: ["нужно продвижение сайта", "ищу seo специалиста"], en: ["looking for seo specialist", "need seo help"] },
  },
};

export type IntentKey = "hire" | "recommendation" | "launch" | "partner" | "interest" | "ongoing" | "order" | "none";

export const INTENTS: Record<IntentKey, { label: string; commercial: boolean }> = {
  order: { label: "Конкретный заказ", commercial: true },
  hire: { label: "Ищет исполнителя", commercial: true },
  ongoing: { label: "Ищет подрядчика на постоянной основе", commercial: true },
  recommendation: { label: "Ищет рекомендации", commercial: true },
  partner: { label: "Ищет партнёра", commercial: true },
  launch: { label: "Планирует запуск бизнеса", commercial: true },
  interest: { label: "Интересуется услугой", commercial: true },
  none: { label: "Нет коммерческого интереса", commercial: false },
};

type PatternSet = Partial<Record<Exclude<IntentKey, "order" | "none">, RegExp[]>>;

// Шаблоны пишутся для нормализованного текста (нижний регистр, ё→е). \p{L} — любая буква.
const W = "[\\p{L}\\-]*"; // окончание слова

function re(src: string) {
  return new RegExp(src.replaceAll("~", W), "iu");
}

export const INTENT_PATTERNS: Record<Lang, PatternSet> = {
  ru: {
    hire: [
      re("(^|[^\\p{L}])(ищу|ищем|нужен|нужна|нужно|нужны|требуется|требуются|требуются|ищу~|разыскива~)\\s+(\\p{L}+\\s+){0,3}(дизайнер~|разработчик~|программист~|исполнител~|подрядчик~|специалист~|фрилансер~|верстальщик~|копирайтер~|таргетолог~|монтажер~|smm~|смм~|маркетолог~|студи~|агентств~|сео~|seo)"),
      re("(^|[^\\p{L}])(нужен|нужна|нужно|нужны|надо|хочу|хотим|требуется)\\s+(\\p{L}+\\s+){0,3}(сайт~|лендинг~|логотип~|дизайн~|бот~|приложени~|карточк~|инфографик~|интернет-магазин~|брендинг~|фирменн~|видео~|ролик~|текст~|продвижени~)"),
      re("(сделать|разработать|нарисовать|сверстать|создать|доработать|переделать)\\s+(\\p{L}+\\s+){0,2}(сайт~|лендинг~|логотип~|дизайн~|бот~|приложени~|карточк~|макет~)"),
      re("(кто (может|сможет|возьмется|возьмется|готов) (сделать|сделает|помочь))"),
      re("(ищу|ищем) (человека|того), (кто|который)"),
    ],
    recommendation: [
      re("(посоветуйте|порекомендуйте|подскажите|посоветуете|кого посоветуете|кто делает|у кого заказать|где заказать|где найти|кто занимается)"),
      re("(есть ли|есть у кого)\\s+(\\p{L}+\\s+){0,2}(контакт~|проверенн~|хорош~)"),
    ],
    launch: [
      re("(запускаю|запускаем|открываю|открываем|открываемся|стартуем|запуск)\\s+(\\p{L}+\\s+){0,3}(бренд~|бизнес~|магазин~|проект~|кофейн~|салон~|студи~|компани~|стартап~|производств~|линейк~|школ~|курс~|продукт~)"),
      re("(планирую|планируем|собираюсь|хочу)\\s+(открыть|запустить|начать)"),
    ],
    partner: [re("(ищу|ищем)\\s+(\\p{L}+\\s+){0,2}(партнер~|кофаундер~|сооснователь~|co-?founder|техническ~ партнер~)")],
    interest: [re("(сколько стоит|какая цена|сколько будет стоить|какие цены на|прайс на|интересует)\\s+(\\p{L}+\\s+){0,3}(сайт~|лендинг~|логотип~|дизайн~|smm|бот~|карточк~|продвижени~)")],
    ongoing: [re("(на постоянн~ основ~|постоянн~ сотрудничеств~|долгосрочн~|на долгую перспектив~|в штат|на постоянку|регулярн~ (работ~|заказ~)|ежемесячн~ ведени~)")],
  },
  en: {
    hire: [
      re("(^|[^\\p{L}])(looking for|seeking|searching for|in search of|hiring|need|needs|needed|want to hire|wanting to hire|we're hiring|we are hiring|in need of)\\s+(an? |some |the |experienced |freelance |skilled |talented |good )*(\\p{L}+\\s+){0,2}(designer~|developer~|dev |freelancer~|agency|agencies|contractor~|programmer~|copywriter~|editor~|specialist~|expert~|marketer~|studio~|consultant~|engineer~)"),
      re("(^|[^\\p{L}])(need|needs|looking for|want)\\s+(an? |some |the |new )*(\\p{L}+\\s+){0,2}(website|web site|landing page|logo|app|bot|redesign|branding|mvp|shopify store|online store)"),
      re("\\[(hiring|task)\\]"),
      re("(anyone|someone|somebody) (who )?(can|could|able to) (build|design|make|create|help)"),
    ],
    recommendation: [re("(any recommendations|can anyone recommend|recommend (a|an|me)|who (do you|would you) recommend|suggestions for (a|an)|know (a|an|any) good)")],
    launch: [
      re("(launching|starting|opening|kicking off|about to launch|planning to launch|soft launch|we just launched)\\s+(\\p{L}+\\s+){0,3}(brand|business|store|shop|startup|company|product|agency|cafe|restaurant|studio|app|saas)"),
      re("(i'm|i am|we're|we are) (starting|launching|building) (a|an|my|our)"),
    ],
    partner: [re("(looking for|seeking)\\s+(an? )?(\\p{L}+\\s+){0,2}(co-?founder|partner|cofounder)")],
    interest: [re("(how much (does|would|do) (it|a|an)?\\s*(\\p{L}+\\s+){0,3}cost|what (does|would) (a|an) (\\p{L}+\\s+){0,2}cost|pricing for (a|an)|quote for (a|an))")],
    ongoing: [re("(long[- ]term|ongoing|retainer|full[- ]time|part[- ]time|monthly basis|on a regular basis|permanent position)")],
  },
  de: {
    hire: [
      re("(^|[^\\p{L}])(suche|suchen|wir suchen|ich suche|brauche|brauchen|benötige|benötigen|gesucht)\\s+(einen |eine |ein |erfahrene~ |freiberufliche~ )*(\\p{L}+\\s+){0,2}(designer~|entwickler~|programmierer~|agentur~|freelancer~|texter~|webdesigner~|grafiker~|website|webseite|homepage|logo|app)"),
    ],
    recommendation: [re("(könnt ihr|kann jemand|wer kann) (\\p{L}+\\s+){0,2}empfehlen|empfehlung (für|gesucht)")],
    launch: [re("(gründe|gründen|starte|starten|eröffne|eröffnen)\\s+(\\p{L}+\\s+){0,3}(marke|firma|unternehmen|shop|laden|startup|café|cafe|studio)")],
    partner: [re("(suche|suchen)\\s+(einen )?(mitgründer|co-?founder|partner)")],
    interest: [re("(was kostet|wie viel kostet|preis für)\\s+(\\p{L}+\\s+){0,3}(website|webseite|logo|app|design)")],
    ongoing: [re("(langfristig|dauerhaft|festanstellung|regelmäßig|monatlich)")],
  },
  fr: {
    hire: [
      re("(^|[^\\p{L}])(je cherche|nous cherchons|on cherche|cherche|recherche|recherchons|besoin d'?u?n?e?|on recrute|recrute)\\s+(un |une |des |d'un |d'une )*(\\p{L}+\\s+){0,2}(graphiste~|designer~|développeur~|developpeur~|agence~|freelance~|rédacteur~|site~|logo~|application~|community manager)"),
    ],
    recommendation: [re("(vous me conseillez|quelqu'un (a|peut) (me )?(conseiller|recommander)|des recommandations|recommandez)")],
    launch: [re("(je lance|nous lançons|on lance|je crée|lancement de)\\s+(\\p{L}+\\s+){0,3}(marque|entreprise|boutique|startup|société|café|restaurant|studio|projet)")],
    partner: [re("(cherche|recherche)\\s+(un |une )?(associé~|co-?fondat~|partenaire~)")],
    interest: [re("(combien coûte|quel (est le )?prix (d'un|pour un))\\s+(\\p{L}+\\s+){0,3}(site|logo|application)")],
    ongoing: [re("(long terme|régulier|régulièrement|cdi|mensuel)")],
  },
  es: {
    hire: [
      re("(^|[^\\p{L}])(busco|buscamos|necesito|necesitamos|se busca|se necesita|contratamos|estoy buscando|estamos buscando)\\s+(un |una |unos |a un |a una )*(\\p{L}+\\s+){0,2}(diseñador~|desarrollador~|programador~|agencia~|freelance~|redactor~|community manager|página~|pagina~|web|logo~|logotipo~|aplicación~|app)"),
    ],
    recommendation: [re("(me recomiendan|alguien (me )?recomienda|recomendaciones (de|para)|conocen (a )?(algún|algun|alguna))")],
    launch: [re("(lanzo|lanzamos|estoy lanzando|voy a abrir|abrimos|empiezo|emprendo)\\s+(\\p{L}+\\s+){0,3}(marca|negocio|tienda|startup|empresa|café|restaurante|estudio|proyecto)")],
    partner: [re("(busco|buscamos)\\s+(un |una )?(socio~|cofundador~|co-?founder)")],
    interest: [re("(cuánto cuesta|cuanto cuesta|precio de (un|una))\\s+(\\p{L}+\\s+){0,3}(web|página|pagina|logo|app)")],
    ongoing: [re("(largo plazo|de forma continua|permanente|mensual|tiempo completo)")],
  },
};

/** Признаки того, что автор — исполнитель/продавец, ищет работу или просто обсуждает тему. */
export const NEGATIVE_PATTERNS: Record<Lang, { re: RegExp; reason: string }[]> = {
  ru: [
    { re: re("(^|[^\\p{L}])(я|мы)\\s+(\\p{L}+\\s+){0,2}(дизайнер~|разработчик~|программист~|верстальщик~|smm-?специалист~|таргетолог~|копирайтер~|студи~|агентств~)"), reason: "Автор представляет себя как исполнителя" },
    { re: re("(предлагаю|предлагаем|оказываю|оказываем|выполню|сделаю для вас|возьму в работу|беру заказы|принимаю заказы|ищу (клиентов|заказы|заказчиков|работу|подработку)|мое портфолио|наше портфолио|резюме)"), reason: "Предложение услуг или поиск работы, а не заказ" },
    { re: re("(как найти (клиентов|заказчиков)|как (стать|работать) (дизайнер~|фрилансер~)|курс по|вебинар|обучени~)"), reason: "Обсуждение/обучение, не заказ" },
  ],
  en: [
    { re: re("(\\[for hire\\]|\\[offer\\]|\\bfor hire\\b|i am an? (\\p{L}+\\s+){0,2}(designer|developer|freelancer)|i'm an? (\\p{L}+\\s+){0,2}(designer|developer|freelancer)|we are an? (\\p{L}+\\s+){0,2}(agency|studio)|my portfolio|our portfolio|available for (work|hire|projects)|open to (work|opportunities)|looking for (work|clients|gigs|a job))"), reason: "Автор предлагает услуги или ищет работу" },
    { re: re("(how (do|can|to) (i|you) find (clients|a designer)|tips for hiring|webinar|course on)"), reason: "Обсуждение темы, не заказ" },
  ],
  de: [{ re: re("(ich bin (\\p{L}+\\s+){0,2}(designer|entwickler)|biete (meine )?dienste|suche (einen )?(job|auftrag|aufträge|kunden)|mein portfolio)"), reason: "Автор предлагает услуги" }],
  fr: [{ re: re("(je suis (\\p{L}+\\s+){0,2}(graphiste|développeur|freelance)|je propose mes services|mon portfolio|cherche (des )?(clients|missions|un emploi))"), reason: "Автор предлагает услуги" }],
  es: [{ re: re("(soy (\\p{L}+\\s+){0,2}(diseñador|desarrollador|freelance)|ofrezco (mis )?servicios|mi portafolio|busco (clientes|trabajo|empleo))"), reason: "Автор предлагает услуги" }],
};

/** Признаки конкретного проекта: бюджет, сроки, ТЗ. */
export const CONCRETE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: re("(бюджет|budget|presupuesto|preis|prix|оплата|ставка|rate|\\$\\s?\\d|€\\s?\\d|£\\s?\\d|\\d\\s?(₽|руб|р\\.|usd|eur|\\$|€))"), reason: "Указан бюджет или оплата" },
  { re: re("(срок|дедлайн|до \\d{1,2}[./]|deadline|asap|срочно|urgent|by (monday|tuesday|wednesday|thursday|friday|next week|the end of)|bis (montag|freitag|ende)|plazo|délai|за \\d+ (дн|день|дня|недел))"), reason: "Указаны сроки" },
  { re: re("(тз|техническое задание|требования|задача:|что нужно сделать|requirements|scope|brief|deliverables|pflichtenheft|cahier des charges|requisitos)"), reason: "Описаны требования / ТЗ" },
];

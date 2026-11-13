# LEADHUNTER AI — карточка клиента и AI Message Studio

Рабочее пространство менеджера по продажам: профиль лида, контакты с происхождением и статусами проверки, объяснимый Lead Score, AI-анализ, генерация персональных сообщений (3 варианта), редактор с версиями, AI Copilot, центр коммуникаций с ручным подтверждением каждой отправки, коммерческие предложения с экспортом PDF/DOCX, задачи и хронология.

Стек: Next.js 15 (App Router) · React 19 · TypeScript · Prisma 6 + SQLite · Tailwind CSS · Framer Motion · Anthropic SDK (Claude) · Vitest.

## Быстрый старт

```bash
npm install
npm install-scripts approve @prisma/client @prisma/engines esbuild prisma   # npm 11+: разрешить скачивание движка Prisma
cp .env.example .env        # затем впишите ANTHROPIC_API_KEY (необязательно)
npm run setup               # миграции + AUTH_SECRET + тестовый пользователь и демо-лиды
npm run dev                 # http://localhost:3210
```

Вход — `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` из `.env` (тестовый локальный пользователь). Демо-лиды вымышлены и используют зарезервированные домены `*.example`.

Проверки: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Переменные окружения

См. `.env.example`. Секреты задаются только на сервере; в браузер, БД и промпты не попадают.

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | SQLite-файл (`file:./dev.db`); для продакшна — смените provider на PostgreSQL |
| `AUTH_SECRET` | Подпись сессий (≥ 32 символов, генерируется `npm run setup`) |
| `SEED_USER_EMAIL`, `SEED_USER_PASSWORD` | Тестовый пользователь сида |
| `ANTHROPIC_API_KEY` | Ключ Claude. Пусто → все AI-функции в состоянии «Не подключено» |
| `AI_MODEL` | Модель, по умолчанию `claude-opus-5-5` |
| `AI_RATE_LIMIT_PER_MIN` | Лимит AI-запросов на пользователя в минуту (12) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email через SMTP |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | WhatsApp Business Platform (Cloud API) |

## Необходимые ключи и доступы

- **Anthropic API** — console.anthropic.com → API Keys. Оплата по токенам, отдельно от подписки Claude. Расход виден в «Настройках» (журнал `AIUsageLog`).
- **SMTP** — ящик/домен для деловой переписки с настроенными SPF/DKIM/DMARC.
- **Telegram** — бот у @BotFather. Бот может писать только тем, кто сам начал с ним диалог; входящие подтягиваются кнопкой «Синхронизировать Telegram» (`getUpdates`, сопоставление по username контакта).
- **WhatsApp** — аккаунт WhatsApp Business Platform (Meta), номер, постоянный токен и одобренный шаблон. Вне 24-часового окна отправляется только шаблон.
- **LinkedIn** — открытого API для личных сообщений нет; статус «Недоступно», текст копируется и отправка отмечается вручную.

## Архитектура

```
src/
  app/
    (app)/            страницы за авторизацией: список лидов, карточка, настройки
    api/              REST API (единый формат ошибок, zod-валидация, CSRF по Origin, rate limit)
    login/
  components/
    client/           ClientProfile, ClientHeader, ClientOverview, ClientContacts, LeadScorePanel,
                      AIAnalysisPanel, AICopilot, CommunicationHub, ProposalBuilder, ClientTasks,
                      ClientSources, ClientTimeline
    client/studio/    AIMessageStudio, AIMessageVariants, AIMessageEditor, AIPersonalizationEvidence
    ui/               дизайн-система: кнопки, бейджи, модалки, skeleton/empty/error, тосты
  lib/
    ai/               provider (вызовы Claude, ошибки, лог расходов), prompts (версии), schemas (JSON Schema),
                      context (сбор контекста клиента, защита от prompt injection), service (операции)
    channels/         адаптеры Email / Telegram / WhatsApp / LinkedIn
    export/           КП → PDF (pdfmake, Roboto с кириллицей) и DOCX (docx)
    score.ts          объяснимый Lead Score (чистая функция)
    outreach.ts       подготовка → подтверждение → отправка, идемпотентность, входящие, отписка
    compliance.ts     suppression-list, «Не связываться», правовое основание, статус контакта
    webfetch.ts       загрузка публичных страниц: SSRF-защита, robots.txt, таймауты, лимит размера
prisma/               схема, миграции, сид
tests/                unit + интеграционные тесты API на отдельной БД
```

### Модель данных

`User`, `ExecutorProfile`, `Client`, `Contact`, `LeadSource`, `FieldProvenance` (происхождение полей и конфликты), `LeadAnalysis`, `LeadScore`, `AIMessage` + `AIMessageVersion`, `MessageTemplate`, `Conversation` + `ConversationMessage`, `Interaction` (timeline), `ClientTask`, `Deal`, `Proposal` + `ProposalVersion`, `ConsentRecord`, `SuppressionEntry`, `CopilotMessage`, `AIUsageLog`, `AuditLog`.

Миграции: `prisma/migrations/…_init`, `…_message_evidence`. Изменения схемы — только через `npm run db:migrate`.

### AI

- Все вызовы — только на сервере (`src/lib/ai/provider.ts`), ключ из окружения.
- Структурированные ответы по zod-схемам (structured outputs): анализ, 3 варианта сообщения с доказательствами персонализации, переписывание фрагмента, черновик КП, ответ на входящее. Copilot — свободный текст.
- Промпты версионируются (`analysis-v1`, `message-v1`, …); версия и модель сохраняются вместе с результатом.
- Внешние данные (сайты, входящие сообщения, инструкции пользователя) оборачиваются в теги и экранируются; системный промпт требует считать их данными, а не инструкциями. Значения email/телефонов в модель не передаются.
- Включены серверные fallbacks (`server-side-fallback-2026-07-01`, `fallbacks: "default"`): при отказе модели по политике запрос повторяется на резервной модели. Отказ, таймаут, rate limit и ошибки провайдера отображаются пользователю; введённые параметры и тексты сохраняются.
- SDK делает повторы с backoff (`maxRetries: 3`); дополнительно стоит лимит запросов на пользователя.

### Отправка сообщений

1. «Подготовить к отправке» → проверки (список запрета, «Не связываться», правовое основание, статус контакта) → статус «Ожидает подтверждения». К email автоматически добавляется строка об отказе от рассылки.
2. «Подтвердить и отправить» — отдельное явное действие с чек-боксом, `confirm: true` и ключом идемпотентности. Атомарный переход в «Отправляется» защищает от двойной отправки.
3. Ошибка канала → статус «Ошибка» с причиной, текст сохраняется, повтор после устранения.
4. Ответ «отписаться» во входящих автоматически добавляет контакт в список запрета.

Массовой и автоматической рассылки нет по замыслу.

## Результаты проверок (13.11.2026)

- `npm run typecheck` — без ошибок
- `npm run lint` — без предупреждений
- `npm test` — 30/30 (unit: Lead Score, нормализация, SSRF/robots, санитизация; интеграционные: 401/404 для чужих данных, CSRF, валидация, AI без ключа, версии сообщений, блокировки по основанию и suppression, идемпотентная отправка, обработка ошибки канала, экспорт PDF/DOCX, удаление данных)
- `npm run build` — успешно
- Ручная проверка в браузере: вход, список, карточка и вкладки, desktop 1440 px (навигация 236 px + Copilot 340 px) и mobile 375 px без горизонтальной прокрутки

## Известные ограничения и дальнейшие задачи

- **AI не проверен на живом ключе**: без `ANTHROPIC_API_KEY` проверено только состояние «Не подключено». После добавления ключа прогоните анализ, генерацию и Copilot.
- Входящие для Email (IMAP) и WhatsApp (webhook) не реализованы — ответы вносятся вручную («Внести вручную»). Telegram синхронизируется по кнопке; обновления, не сопоставленные ни с одним контактом, подтверждаются и не сохраняются.
- Вложения к сообщениям не поддерживаются адаптерами (кнопка неактивна с пояснением) — используйте ссылки.
- Rate limit и офсет Telegram хранятся в памяти процесса; для нескольких инстансов нужен Redis/БД.
- Оценка визуала сайта — только по тексту и структуре страниц, без скриншотов.
- Поиск дубликатов — по нормализованному значению контакта у клиентов того же пользователя.
- Нет ролей команды и назначения задач другим пользователям (поле `assigneeId` готово). Сделки (`Deal`) есть в схеме, но без UI.
- Локализация: подписи в `src/lib/domain.ts` и компонентах на русском; для других языков их нужно вынести в словари.
- SQLite подходит для локальной работы; для продакшна — PostgreSQL и шифрование диска/БД.

# Подключение соцсетей и источников к LEADHUNTER AI

Ключи вставляются **в приложении**: войдите под `admin` → **Настройки** → блок **«Подключения»** → нужная группа → поле → **Сохранить** → **«Проверить все»**.

Секреты хранятся в базе в зашифрованном виде и применяются сразу, без перезапуска. Значения из `.env` тоже работают, но интерфейс удобнее.

Проверить отдельный источник можно и на странице **«Спрос в соцсетях → Источники»**: кнопка «Проверить подключение» у каждой площадки.

---

## Работают без ключей (ничего делать не нужно)

FL.ru, Kwork, Freelancer.com, Dribbble, Product Hunt, VC.ru, Хабр, Hacker News, свои RSS-ленты.

**Telegram** — тоже без ключа: в кампании укажите публичные каналы (`@channel`). Из вашей текущей сети `t.me` не открывается, поэтому Telegram заработает только из сети, где он доступен.

---

## 1. Threads — поиск и ответы через API

Поля: **Threads access token**, лимит ответов в сутки, пауза между ответами.

1. Откройте https://developers.facebook.com/apps → **Create app** → сценарий **«Access the Threads API»**.
2. **Use cases → Customize → Permissions**. Добавьте:
   - `threads_basic`;
   - `threads_keyword_search` (поиск);
   - `threads_content_publish` (публикация);
   - `threads_manage_replies` (ответы).
3. **App roles → Roles → Add People → Threads Tester**: добавьте свой профиль Threads.
4. В приложении Threads: **Настройки → Аккаунт → Разрешения на веб-сайте → Приглашения** → примите приглашение.
5. **Use cases → Threads API → Settings → User Token Generator** → **Generate access token** для своего профиля.
6. Токен живёт 1 час. Обменяйте его на долгоживущий (60 дней), открыв в браузере:
   ```
   https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=<App Secret>&access_token=<короткий токен>
   ```
   App Secret находится в **App settings → Basic**. Из ответа скопируйте `access_token`.
7. Вставьте токен в поле **Threads access token** → **Сохранить** → **Проверить все**.
8. **Важно.** Пока Meta не одобрила `threads_keyword_search` (раздел **App Review**), поиск возвращает только ваши собственные посты. Для одобрения нужны политика конфиденциальности (URL), видео работы приложения и описание использования.
9. Токен истекает через 60 дней. Обновить его можно запросом `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=<токен>`, после чего вставьте новый.

## 2. Instagram — поиск по хэштегам

Поля: **Instagram access token**, **Instagram user ID**.

1. Нужен **бизнес- или авторский аккаунт Instagram**, привязанный к странице Facebook.
2. В том же или новом приложении Meta добавьте продукт **Instagram Graph API** и разрешения:
   - `instagram_basic`;
   - `pages_show_list`;
   - `instagram_manage_comments` (если понадобится).
3. **Graph API Explorer** (https://developers.facebook.com/tools/explorer) → выберите приложение → **Get User Access Token** с этими разрешениями.
4. Узнайте ID аккаунта Instagram: запрос `me/accounts?fields=instagram_business_account`, поле `instagram_business_account.id`.
5. Сделайте токен долгоживущим (Access Token Debugger → **Extend**).
6. Вставьте токен и ID → **Сохранить** → **Проверить**.

Ограничение Meta: до 30 разных хэштегов в неделю. API не отдаёт автора поста.

## 3. VK — поиск по открытым записям

Поле: **VK access token**.

1. https://dev.vk.com → **Мои приложения → Создать** (тип «Standalone / Web»).
2. Получите **пользовательский** токен с доступом `wall` и `offline` (по Implicit Flow), открыв в браузере:
   ```
   https://oauth.vk.com/authorize?client_id=<ID приложения>&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=wall,offline&response_type=token&v=5.199
   ```
   Из адресной строки скопируйте `access_token=...`.
3. Вставьте токен → **Сохранить** → **Проверить**. Проверка покажет имя пользователя и то, работает ли `newsfeed.search`.

## 4. Reddit

Поля: **Reddit client ID**, **Reddit client secret**.

1. https://www.reddit.com/prefs/apps → **create another app** → тип **script**, redirect uri `http://localhost:3210`.
2. **client ID** — строка под названием приложения, **secret** — поле «secret».
3. Вставьте оба → **Сохранить** → **Проверить**.
4. Коммерческое использование API Reddit требует отдельного согласования с Reddit (Data API Terms).

## 5. X (Twitter)

Поле: **X bearer token**.

1. https://developer.x.com → **Projects & Apps** → создайте проект и приложение.
2. Поиск постов (`recent search`) доступен с **платного тарифа Basic**. На бесплатном проверка покажет ошибку 403.
3. **Keys and tokens → Bearer Token → Generate** → вставьте → **Проверить**.

## 6. Discord

Поле: **Discord bot token**.

1. https://discord.com/developers/applications → **New Application** → **Bot** → **Reset Token** → скопируйте.
2. На той же вкладке включите **Message Content Intent**.
3. **OAuth2 → URL Generator**: scope `bot`, права `Read Messages/View Channels` и `Read Message History`. Откройте ссылку и добавьте бота на серверы, где вы участник или администратор.
4. Вставьте токен → **Проверить** (покажет имя бота и число серверов).
5. В кампании укажите ID каналов: в Discord включите режим разработчика, затем ПКМ по каналу → «Копировать ID».

## 7. Поиск, карты и каталоги

Группа: **Источники «Спроса»: поиск, карты, каталоги**.

| Площадка | Где взять | Поля |
|---|---|---|
| Google Search | console.cloud.google.com → включить **Custom Search API** → ключ; programmablesearchengine.google.com → создать поисковик «по всему интернету» → ID (cx) | Google Custom Search key, CX |
| Яндекс Поиск | console.yandex.cloud → сервисный аккаунт с ролью `search-api.executor` → API-ключ; ID каталога (folder) | Yandex Search API key, folder ID |
| Google Maps | console.cloud.google.com → включить **Places API (New)** → ключ | Google Places API key |
| Яндекс Карты | developer.tech.yandex.ru → **API Поиска по организациям** → ключ | Яндекс Карты |
| 2ГИС | platform.2gis.ru → кабинет разработчика → ключ Places API | 2ГИС API key |
| Crunchbase | data.crunchbase.com → API key (нужен платный план API) | Crunchbase API key |

---

## Нельзя подключить автоматически

У этих площадок нет разрешённого способа автоматического поиска:
- LinkedIn;
- Facebook (группы);
- Upwork, Fiverr, PeoplePerHour, Freelance.ru, Хабр Фриланс;
- Behance, Pinterest;
- Clutch, Indie Hackers.

Для них в результатах кампании есть готовые ссылки поиска на площадке. Найденный пост добавляется кнопкой **«Добавить вручную»**, дальше он проходит тот же анализ и оценку.

**Bing** — API закрыт Microsoft в 2025 году.

## После подключения

1. **Спрос в соцсетях → Новая кампания** → выберите услугу, языки и подключённые источники → расписание **«Ежедневно»**.
2. **Исходящие → Подготовить ответы** (для Threads) → проверьте тексты → **Одобрить выбранные**. Ответы уйдут сами, с паузой и дневным лимитом.

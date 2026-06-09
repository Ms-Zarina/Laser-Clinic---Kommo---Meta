# Laser Clinic — Kommo → Meta Conversions API

Отдельный backend для проекта **Laser Clinic**. Принимает webhook из Kommo, читает email/телефон лида, хэширует SHA-256 и отправляет событие в **Meta Conversions API** (Pixel/Dataset Laser Clinic).

Это **тот же код**, что и у ALTOS, — разделение идёт через переменные окружения. Никаких изменений в `server.js` не требуется.

---

## 0. Event Match Quality (EMQ) — параметры user_data

Чтобы повысить качество сопоставления событий в Meta, в `user_data` передаётся максимум доступных параметров. Пустые значения **не отправляются**.

| Параметр                | Источник                                                        | Хэш SHA-256 |
|-------------------------|-----------------------------------------------------------------|:-----------:|
| `em` (email)            | Kommo contact `EMAIL` / body `email`                            | да          |
| `ph` (phone)            | Kommo contact `PHONE` / body `phone`                           | да          |
| `fn` (first name)       | Kommo `first_name`/`name` / body `first_name`\|`fn`            | да          |
| `ln` (last name)        | Kommo `last_name`/`name` / body `last_name`\|`ln`             | да          |
| `ct` (city)             | Kommo field `KOMMO_CITY_FIELD_ID` / body `city`\|`ct`         | да          |
| `country`               | Kommo field `KOMMO_COUNTRY_FIELD_ID` / body `country`         | да          |
| `external_id`           | Kommo `contact_id` (или `lead_id` в тесте)                     | да          |
| `client_ip_address`     | `x-forwarded-for` → `x-real-ip` → `req.ip`                     | **нет**     |
| `client_user_agent`     | заголовок `user-agent`                                         | **нет**     |
| `fbp`                   | Kommo `KOMMO_FBP_FIELD_ID` / body `fbp` / query `fbp`          | **нет**     |
| `fbc`                   | Kommo `KOMMO_FBC_FIELD_ID` / body `fbc` / query `fbc`          | **нет**     |

Хэширование выполняется функцией `sha256` (trim + lowercase). Технические параметры (`client_ip_address`, `client_user_agent`, `fbp`, `fbc`) Meta требует **в сыром виде**.

**Безопасные логи.** В консоль пишутся только флаги наличия (`true`/`false`) для каждого параметра — строка `META MATCH PARAMS`. Сами email, телефон, имена и токены **никогда не логируются**. Приложение работает за reverse proxy, поэтому включён `app.set("trust proxy", true)` — `req.ip` отражает реальный IP клиента.

> Логику маппинга статусов и существующие endpoints (`/webhook/kommo`, `/webhook/test-lead`, `/meta/webhook`) изменения **не затрагивают** — добавлены только дополнительные параметры в payload.

---

## 1. Маппинг статусов Kommo → события Meta

| Переменная env                | Событие Meta    |
|-------------------------------|-----------------|
| `THINKING_STATUS_ID`          | `Lead`          |
| `BOOKING_STATUS_ID`           | `QualifiedLead` |
| `SUCCESSFULLY_STATUS_ID`      | `Purchase`      |

Логика статусов **сохранена** без изменений (`server.js`, функция `getMetaEventNameByStatus`).

---

## 2. Переменные окружения (Render → Environment)

Все секреты хранятся **только в Render Environment**. `.env` в Git не коммитится (см. `.gitignore`).

| Переменная                | Значение для Laser Clinic                                       |
|---------------------------|-----------------------------------------------------------------|
| `META_PIXEL_ID`           | `715100213360705`                                               |
| `META_ACCESS_TOKEN`       | новый токен Conversions API из бизнес-кабинета Laser Clinic     |
| `KOMMO_SUBDOMAIN`         | поддомен Kommo Laser Clinic (без `.amocrm.com`)                 |
| `KOMMO_ACCESS_TOKEN`      | долгоживущий токен интеграции Kommo Laser Clinic                |
| `THINKING_STATUS_ID`      | ID статуса «Думает» в воронке Laser Clinic                      |
| `BOOKING_STATUS_ID`       | ID статуса «Запись» в воронке Laser Clinic                      |
| `SUCCESSFULLY_STATUS_ID`  | ID статуса «Успешно реализовано» в воронке Laser Clinic         |
| `META_TEST_EVENT_CODE`    | опционально: код вкладки Test Events (в проде оставить пустым)  |
| `META_VERIFY_TOKEN`       | опционально: verify token для `GET /meta/webhook`              |
| `KOMMO_FBP_FIELD_ID`      | опционально: ID custom field Kommo c `_fbp` (для EMQ)          |
| `KOMMO_FBC_FIELD_ID`      | опционально: ID custom field Kommo c `_fbc` (для EMQ)          |
| `KOMMO_CITY_FIELD_ID`     | опционально: ID custom field Kommo с городом (для EMQ)         |
| `KOMMO_COUNTRY_FIELD_ID`  | опционально: ID custom field Kommo со страной (для EMQ)        |
| `PORT`                    | порт приложения; для Docker/Nginx по умолчанию `3001`          |

> ВНИМАНИЕ: значения ALTOS использовать **нельзя**. Все переменные выше должны быть пересозданы под Laser Clinic.

При старте приложение логирует `Environment variables loaded OK`, а при отсутствии обязательной переменной — `WARNING: missing required environment variables: ...`. Эндпоинт `GET /health` возвращает `200` если всё на месте и `503` со списком `missingEnv`, если чего-то не хватает.

---

## 2a. Деплой на Hetzner через Docker

Backend упакован в Docker. На сервере нужны только **Docker** и **Docker Compose plugin** — исходный код Node ставить не требуется.

### Состав файлов

| Файл                 | Назначение                                                      |
|----------------------|-----------------------------------------------------------------|
| `Dockerfile`         | production-образ на `node:20-alpine`, запуск от пользователя `node`, встроенный `HEALTHCHECK` |
| `.dockerignore`      | исключает `node_modules`, `.env`, `.git` и т.п. из образа       |
| `docker-compose.yml` | сервис `app`, `restart: unless-stopped`, healthcheck, порт `127.0.0.1:3001:3001` |
| `.env.example`       | шаблон переменных окружения                                     |

### Шаги на сервере Hetzner

1. Установить Docker (если ещё нет):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. Склонировать репозиторий и перейти в каталог проекта:
   ```bash
   git clone https://github.com/Ms-Zarina/Laser-Clinic---Kommo---Meta.git
   cd Laser-Clinic---Kommo---Meta/laser-clinic-kommo-meta
   ```
3. Создать `.env` из шаблона и заполнить значениями Laser Clinic:
   ```bash
   cp .env.example .env
   nano .env
   ```
4. Собрать и запустить:
   ```bash
   docker compose up -d --build
   ```
5. Проверить health:
   ```bash
   curl http://127.0.0.1:3001/health
   # {"status":"ok","uptime":..., "missingEnv":[]}
   curl http://127.0.0.1:3001/
   # {"ok":true,"message":"Kommo → Meta backend is running"}
   ```
   Статус контейнера (`healthy`) виден в `docker compose ps`.

### Команды эксплуатации

```bash
docker compose up -d        # запустить (в фоне)
docker compose logs -f      # смотреть логи в реальном времени
docker compose restart      # перезапустить сервис
docker compose pull         # подтянуть обновлённый образ (если используется registry)
docker compose down         # остановить и удалить контейнеры
```

После обновления кода:
```bash
git pull
docker compose up -d --build
```

> **restart policy:** в `docker-compose.yml` задан `restart: unless-stopped` — контейнер автоматически поднимется после перезагрузки сервера или падения процесса, но не запустится, если вы остановили его вручную (`docker compose down`/`stop`).

---

## 2b. Nginx reverse proxy (порт 3001)

Контейнер слушает только `127.0.0.1:3001`, наружу его публикует Nginx (TLS, домен). Пример конфига `/etc/nginx/sites-available/laser-clinic`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Лёгкая проверка доступности апстрима
    location = /health {
        proxy_pass http://127.0.0.1:3001/health;
    }
}
```

Активировать и перезагрузить:
```bash
ln -s /etc/nginx/sites-available/laser-clinic /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

TLS-сертификат (рекомендуется):
```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

После настройки публичные webhook-URL будут вида:
- Kommo: `https://your-domain.com/webhook/kommo`
- Meta:  `https://your-domain.com/meta/webhook`

---

## 3. Деплой нового Web Service на Render — пошагово

1. Запушить эту ветку в GitHub-репозиторий `Ms-Zarina/Laser-Clinic---Kommo---Meta` и смержить в `main` (или деплоить прямо с ветки).
2. В Render: **New +** → **Web Service**.
3. **Connect repository** → выбрать `Ms-Zarina/Laser-Clinic---Kommo---Meta`.
4. Настройки:
   - **Name**: `laser-clinic-kommo-meta`
   - **Region**: тот же, что у ALTOS (например, Frankfurt)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free / Starter
5. Раздел **Environment** → **Add Environment Variable** → добавить все 7 переменных из таблицы выше.
6. Нажать **Create Web Service** и дождаться `Live`.
7. Проверить здоровье: открыть `https://<имя-сервиса>.onrender.com/` — должен вернуться JSON:
   ```json
   { "ok": true, "message": "Kommo → Meta backend is running" }
   ```

---

## 4. Подключение Meta Pixel / Dataset Laser Clinic

1. Events Manager → выбрать **Dataset `715100213360705`** (Laser Clinic).
2. **Settings** → **Conversions API** → **Generate access token**.
3. Скопировать токен → в Render положить в `META_ACCESS_TOKEN`.
4. В `server.js` менять ничего не нужно — `META_PIXEL_ID` и `META_ACCESS_TOKEN` уже подставляются в URL и тело запроса (см. функцию `sendMetaEvent`).
5. Для теста раскомментировать в `sendMetaEvent` строку `test_event_code` и положить временный `META_TEST_EVENT_CODE` из вкладки **Test Events** — события появятся там в реальном времени. После проверки закомментировать обратно.

---

## 5. Подключение webhook в Kommo

1. Kommo Laser Clinic → **Настройки** → **Интеграции** → **Создать интеграцию** (или взять существующую).
2. Получить долгоживущий токен и поддомен:
   - `KOMMO_ACCESS_TOKEN` = access token интеграции
   - `KOMMO_SUBDOMAIN` = поддомен без `.amocrm.com` (например, `laserclinic`)
3. **Настройки** → **Webhooks** → **Создать webhook**:
   - **URL**: `https://<имя-сервиса>.onrender.com/webhook/kommo`
   - **События**: «Смена этапа сделки» (status changed). Если хотите ещё и обновления — добавить «Изменение сделки».
4. Открыть нужную воронку → у каждого статуса (Думает / Запись / Успешно реализовано) посмотреть ID в URL (`…/leads/pipeline/<pipeline_id>/<status_id>`) и положить в `THINKING_STATUS_ID`, `BOOKING_STATUS_ID`, `SUCCESSFULLY_STATUS_ID`.
5. Сохранить webhook. Перевести тестового лида между статусами → проверить логи Render и Test Events в Meta.

---

## 6. Локальный запуск (опционально, для отладки)

```bash
npm install
# создать .env (он в .gitignore, не закоммитится) с теми же 7 переменными
node server.js
```

Тестовый эндпоинт без Kommo:

```bash
curl -X POST http://localhost:3000/webhook/test-lead \
  -H "Content-Type: application/json" \
  -d '{"lead_id":"1","status_id":"<THINKING_STATUS_ID>","email":"test@example.com","phone":"420000000000"}'
```

---

## 7. Чего **не** делаем

- Не коммитим `.env`, токены, ID пикселя в код.
- Не используем env vars ALTOS — у Laser Clinic свой Pixel, токен, поддомен и ID статусов.
- Не переписываем `server.js` — конфиг полностью вынесен в окружение.

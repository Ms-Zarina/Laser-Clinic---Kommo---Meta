# Laser Clinic — Kommo → Meta Conversions API

Отдельный backend для проекта **Laser Clinic**. Принимает webhook из Kommo, читает email/телефон лида, хэширует SHA-256 и отправляет событие в **Meta Conversions API** (Pixel/Dataset Laser Clinic).

Это **тот же код**, что и у ALTOS, — разделение идёт через переменные окружения. Никаких изменений в `server.js` не требуется.

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
| `PORT`                    | можно не задавать, Render проставит сам                         |

> ВНИМАНИЕ: значения ALTOS использовать **нельзя**. Все 7 переменных выше должны быть пересозданы под Laser Clinic.

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

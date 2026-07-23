# Airspace Monitor — Backend

Сервер мониторинга воздушного пространства России: БПЛА-угрозы, закрытые аэропорты, статус рейсов в реальном времени.

## Что делает сервер

- Каждые 30 секунд опрашивает OpenSky Network → все самолёты над РФ
- Парсит Telegram-каналы (@radarrussiia и др.) через RSSHub → угрозы БПЛА/ракет
- Запрашивает NOTAMы для 20 аэропортов России → статус закрытий
- Отдаёт данные через WebSocket и REST API фронтенду

## Запуск локально (5 минут)

```bash
# 1. Клонируйте и установите зависимости
git clone <repo>
cd airspace-monitor
npm install

# 2. Скопируйте .env
cp .env.example .env
# Без API-ключей тоже работает (анонимный режим OpenSky)

# 3. Запустите
npm run dev
```

Сервер запустится на http://localhost:3001

## API endpoints

| Endpoint | Описание |
|---|---|
| `GET /health` | Статус сервера и время последнего обновления |
| `GET /api/flights` | Все самолёты над РФ прямо сейчас |
| `GET /api/airports` | Статус 20 аэропортов (open/restricted/closed) |
| `GET /api/alerts` | Активные угрозы (БПЛА, ракеты, закрытия) |
| `GET /api/status` | Сводка: закрытые аэропорты + активные угрозы |
| `WebSocket /` | Push-обновления каждые 30 сек |

## WebSocket — пример подключения (фронтенд)

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

socket.on('update', (data) => {
  console.log('Самолётов:', data.flights.length);
  console.log('Закрытые аэропорты:', data.airports.filter(a => a.status === 'closed'));
  console.log('Угрозы:', data.alerts.filter(a => a.severity === 'high'));
});
```

## Деплой на Fly.io (бесплатно)

```bash
# 1. Установите flyctl
curl -L https://fly.io/install.sh | sh

# 2. Войдите в аккаунт (бесплатная регистрация)
fly auth signup

# 3. Создайте приложение
fly launch --name airspace-monitor-backend

# 4. Задайте переменные окружения (опционально)
fly secrets set RAPIDAPI_KEY=ваш_ключ

# 5. Задеплойте
fly deploy
```

Fly.io бесплатный тир: 3 машины по 256MB RAM, 160GB трафика/мес — для этого проекта хватит.

## Получение API-ключей

### OpenSky Network (необязательно)
- Зарегистрироваться: https://opensky-network.org/
- Создать OAuth2 Client в настройках
- Без регистрации работает анонимно (~400 запросов/день)

### SkyLink NOTAM API (необязательно, 1000 req/мес бесплатно)
- Зарегистрироваться: https://rapidapi.com/
- Найти "SkyLink API" → Subscribe → Free tier
- Скопировать `x-rapidapi-key`

### RSSHub (без регистрации)
- Публичный инстанс rsshub.app используется по умолчанию
- Для production лучше развернуть свой: https://github.com/DIYgod/RSSHub

## Структура проекта

```
src/
  server.js     — главный сервер (Express + Socket.io)
  opensky.js    — клиент OpenSky Network API
  notams.js     — парсер NOTAM-данных
  telegram.js   — парсер Telegram-каналов через RSSHub
  threats.js    — движок классификации угроз
```

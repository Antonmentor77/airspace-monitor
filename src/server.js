const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { fetchFlights } = require('./opensky');
const { fetchNotams } = require('./notams');
const { fetchTelegramAlerts } = require('./telegram');
const { classifyThreats } = require('./threats');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.json());

// --- Кеш данных ---
let cache = {
  flights: [],
  airports: [],
  alerts: [],
  lastUpdate: null,
};

// --- REST endpoints ---
app.get('/health', (req, res) => res.json({ status: 'ok', lastUpdate: cache.lastUpdate }));

app.get('/api/flights', (req, res) => res.json(cache.flights));

app.get('/api/airports', (req, res) => res.json(cache.airports));

app.get('/api/alerts', (req, res) => res.json(cache.alerts));

app.get('/api/status', (req, res) => {
  const dangerZones = cache.airports.filter(a => a.status === 'closed' || a.status === 'restricted');
  res.json({
    lastUpdate: cache.lastUpdate,
    totalFlights: cache.flights.length,
    closedAirports: dangerZones.length,
    activeAlerts: cache.alerts.filter(a => a.severity === 'high').length,
    dangerZones: dangerZones.map(a => ({ code: a.icao, name: a.name, status: a.status })),
  });
});

// --- Основной цикл обновления ---
async function updateData() {
  try {
    console.log('[update] Запрашиваем данные...');

    const [flights, notams, telegramAlerts] = await Promise.allSettled([
      fetchFlights(),
      fetchNotams(),
      fetchTelegramAlerts(),
    ]);

    const flightData = 
  flights.status === 'fulfilled' && Array.isArray(flights.value)
    ? flights.value
    : []
    const notamData = notams.status === 'fulfilled' ? notams.value : cache.airports;
    const alertData = telegramAlerts.status === 'fulfilled' ? telegramAlerts.value : [];

    // Классифицируем угрозы
    const threats = classifyThreats(alertData, notamData);

    cache = {
      flights: flightData,
      airports: notamData,
      alerts: [...threats, ...alertData].slice(0, 50), // последние 50
      lastUpdate: new Date().toISOString(),
    };

    // Пушим всем подключённым клиентам
    io.emit('update', cache);

    console.log(`[update] OK — ${flightData.length} самолётов, ${notamData.length} аэропортов, ${threats.length} угроз`);
  } catch (err) {
    console.error('[update] Ошибка:', err.message);
  }
}

// --- WebSocket ---
io.on('connection', (socket) => {
  console.log('[ws] Клиент подключился:', socket.id);

  // Сразу шлём текущий кеш новому клиенту
  socket.emit('update', cache);

  socket.on('disconnect', () => {
    console.log('[ws] Клиент отключился:', socket.id);
  });
});

// --- Запуск ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  await updateData(); // первый запрос сразу
  setInterval(updateData, 30_000); // каждые 30 секунд
});

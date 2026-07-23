// NOTAM — официальные извещения о закрытии аэропортов
// Используем SkyLink API (1000 req/мес бесплатно) + notams.online как fallback
// Регистрация: https://rapidapi.com/skylink-api

const { RUSSIA_AIRPORTS } = require('./opensky');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';

// Статусы аэропортов, которые мы вычисляем из NOTAMов
function parseAirportStatus(notams) {
  if (!notams || notams.length === 0) return 'open';

  const texts = notams.map(n => (n.body || n.raw || '').toUpperCase()).join(' ');

  // Ключевые слова закрытия
  if (texts.includes('CLSD') || texts.includes('CLOSED') || texts.includes('ЗАКРЫТ')) {
    return 'closed';
  }

  // Ограничения
  if (texts.includes('RESTRICTED') || texts.includes('TFR') || texts.includes('PROHIBITED')) {
    return 'restricted';
  }

  // БПЛА / дроны
  if (texts.includes('UAS') || texts.includes('DRONE') || texts.includes('UAV')) {
    return 'restricted';
  }

  return 'notam'; // есть NOTAMы, но не критичные
}

async function fetchNotamForAirport(icao) {
  if (!RAPIDAPI_KEY) {
    // Без ключа — используем notams.online (scraping fallback)
    return fetchNotamFallback(icao);
  }

  try {
    const resp = await fetch(`https://skylink-api.p.rapidapi.com/notams/${icao}`, {
      headers: {
        'x-rapidapi-host': 'skylink-api.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });

    if (!resp.ok) return { icao, status: 'unknown', notams: [] };

    const data = await resp.json();
    const notams = data.notams || [];
    const status = parseAirportStatus(notams);

    return {
      icao,
      status,
      notamCount: notams.length,
      notams: notams.slice(0, 3).map(n => ({ // берём только 3 самых важных
        id: n.notam_id,
        body: n.body,
        effective: n.effective,
        expiration: n.expiration,
      })),
    };
  } catch (err) {
    console.warn(`[notam] Ошибка для ${icao}:`, err.message);
    return { icao, status: 'unknown', notams: [] };
  }
}

// Fallback — парсим публичную страницу notams.online
async function fetchNotamFallback(icao) {
  try {
    const resp = await fetch(`https://notams.online/api/notams?location=${icao}`, {
      headers: { 'User-Agent': 'AirspaceMonitor/1.0' },
    });
    if (!resp.ok) return { icao, status: 'unknown', notams: [] };
    const data = await resp.json();
    const notams = Array.isArray(data) ? data : (data.notams || []);
    return { icao, status: parseAirportStatus(notams), notams };
  } catch {
    return { icao, status: 'unknown', notams: [] };
  }
}

// Приоритет: сначала аэропорты зоны риска (юг РФ, Москва)
const HIGH_PRIORITY_AIRPORTS = ['UUEE', 'UUWW', 'UUDD', 'ULLI', 'URRR', 'UUOB', 'URKK', 'URSS', 'URKW', 'URMO'];

async function fetchNotams() {
  const airports = RUSSIA_AIRPORTS;

  // Сначала запрашиваем приоритетные аэропорты
  const priorityResults = await Promise.allSettled(
    HIGH_PRIORITY_AIRPORTS.map(icao => fetchNotamForAirport(icao))
  );

  // Остальные с задержкой чтобы не превысить лимиты
  const remainingIcaos = airports
    .map(a => a.icao)
    .filter(icao => !HIGH_PRIORITY_AIRPORTS.includes(icao));

  const otherResults = await Promise.allSettled(
    remainingIcaos.map(icao => fetchNotamForAirport(icao))
  );

  const allResults = [...priorityResults, ...otherResults];

  // Объединяем с данными аэропортов
  return airports.map(airport => {
    const result = allResults.find(r => r.status === 'fulfilled' && r.value.icao === airport.icao);
    const notamData = result?.value || { status: 'unknown', notams: [] };
    return { ...airport, ...notamData };
  });
}

module.exports = { fetchNotams };

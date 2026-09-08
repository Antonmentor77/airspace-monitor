// OpenSky Network API — бесплатные ADS-B данные
// Документация: https://openskynetwork.github.io/opensky-api/
// Bounding box охватывает территорию России

const RUSSIA_BBOX = {
  lamin: 41.2,   // юг
  lamax: 81.9,   // север
  lomin: 19.6,   // запад
  lomax: 190.0,  // восток (через антимеридиан)
};

// Поля state vector от OpenSky (по индексу массива)
const FIELDS = [
  'icao24', 'callsign', 'origin_country', 'time_position',
  'last_contact', 'longitude', 'latitude', 'baro_altitude',
  'on_ground', 'velocity', 'true_track', 'vertical_rate',
  'sensors', 'geo_altitude', 'squawk', 'spi', 'position_source'
];

let accessToken = null;
let tokenExpiry = 0;

async function getToken() {
  // Если нет credentials — работаем без авторизации (анонимно, лимит ~400 req/день)
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null; // анонимный режим
  }

  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const resp = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!resp.ok) throw new Error(`OpenSky auth error: ${resp.status}`);
  const data = await resp.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // с запасом 60 сек
  return accessToken;
}

// ─── ADSB.LOL — основной источник (без ключей, лучше покрытие, включая часть военных) ───
// Точечные запросы (макс. радиус 250 морских миль на точку), покрывающие территорию России.
const ADSBLOL_TILES = [
  { name: 'Москва',        lat: 55.75, lon: 37.62 },
  { name: 'СПб',           lat: 59.94, lon: 30.31 },
  { name: 'Калининград',   lat: 54.71, lon: 20.51 },
  { name: 'Ростов/Юг',     lat: 47.23, lon: 39.72 },
  { name: 'Краснодар/Крым',lat: 45.30, lon: 38.50 },
  { name: 'Волгоград',     lat: 48.71, lon: 44.50 },
  { name: 'Казань',        lat: 55.79, lon: 49.12 },
  { name: 'Екатеринбург',  lat: 56.84, lon: 60.61 },
  { name: 'Новосибирск',   lat: 55.03, lon: 82.92 },
  { name: 'Красноярск',    lat: 56.02, lon: 92.87 },
  { name: 'Иркутск',       lat: 52.29, lon: 104.30 },
  { name: 'Хабаровск',     lat: 48.48, lon: 135.08 },
  { name: 'Владивосток',   lat: 43.12, lon: 131.90 },
];
const ADSBLOL_RADIUS_NM = 250;

async function fetchAdsbLolTile(tile) {
  try {
    const resp = await fetch(
      `https://api.adsb.lol/v2/point/${tile.lat}/${tile.lon}/${ADSBLOL_RADIUS_NM}`,
      { headers: { 'User-Agent': 'AirspaceMonitorRU/1.0' } }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.ac || [];
  } catch (e) {
    console.warn(`[adsb.lol] Ошибка тайла ${tile.name}:`, e.message);
    return [];
  }
}

async function fetchMilitarySet() {
  // Глобальный список военных бортов adsb.lol — используем как метку isMilitary
  try {
    const resp = await fetch('https://api.adsb.lol/v2/mil', {
      headers: { 'User-Agent': 'AirspaceMonitorRU/1.0' }
    });
    if (!resp.ok) return new Set();
    const data = await resp.json();
    return new Set((data.ac || []).map(p => p.hex));
  } catch (e) {
    return new Set();
  }
}

async function fetchFlightsFromAdsbLol() {
  const [tiles, milSet] = await Promise.all([
    Promise.all(ADSBLOL_TILES.map(fetchAdsbLolTile)),
    fetchMilitarySet(),
  ]);

  const seen = new Map();
  tiles.flat().forEach(p => {
    if (!p.hex || typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
    if (seen.has(p.hex)) return; // убираем дубликаты между тайлами
    seen.set(p.hex, {
      id: p.hex,
      callsign: (p.flight || '').trim(),
      country: p.r || '',
      lat: p.lat,
      lng: p.lon,
      altitude: typeof p.alt_baro === 'number' ? Math.round(p.alt_baro * 0.3048) : 0, // футы → метры
      speed: p.gs ? Math.round(p.gs * 1.852) : 0, // узлы → км/ч
      heading: Math.round(p.track || 0),
      squawk: p.squawk,
      emergency: ['7700', '7600', '7500'].includes(p.squawk),
      isMilitary: milSet.has(p.hex) || p.dbFlags === 1,
      lastSeen: p.seen_pos ?? p.seen ?? null,
    });
  });

  return Array.from(seen.values());
}

// ─── OpenSky — резервный источник, если adsb.lol недоступен ───
async function fetchFlightsFromOpenSky() {
  const token = await getToken();
  const { lamin, lamax, lomin, lomax } = RUSSIA_BBOX;

  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;

  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url, { headers });

  if (resp.status === 429) {
    console.warn('[opensky] Превышен лимит запросов');
    return [];
  }
  if (!resp.ok) throw new Error(`OpenSky error: ${resp.status}`);

  const data = await resp.json();
  if (!data.states) return [];

  return data.states
    .map(state => {
      const obj = {};
      FIELDS.forEach((field, i) => { obj[field] = state[i]; });
      return obj;
    })
    .filter(f => !f.on_ground && f.latitude && f.longitude)
    .map(f => ({
      id: f.icao24,
      callsign: (f.callsign || '').trim(),
      country: f.origin_country,
      lat: f.latitude,
      lng: f.longitude,
      altitude: Math.round(f.baro_altitude || 0),
      speed: Math.round((f.velocity || 0) * 3.6),
      heading: Math.round(f.true_track || 0),
      squawk: f.squawk,
      emergency: ['7700', '7600', '7500'].includes(f.squawk),
      isMilitary: false,
      lastSeen: f.last_contact,
    }));
}

async function fetchFlights() {
  try {
    const flights = await fetchFlightsFromAdsbLol();
    if (flights.length > 0) return flights;
    console.warn('[adsb.lol] Пусто, пробуем OpenSky как резерв');
  } catch (e) {
    console.warn('[adsb.lol] Ошибка, пробуем OpenSky как резерв:', e.message);
  }

  try {
    return await fetchFlightsFromOpenSky();
  } catch (e) {
    console.error('[opensky] Тоже недоступен:', e.message);
    return [];
  }
}

// Список аэропортов РФ с ICAO кодами
const RUSSIA_AIRPORTS = [
  { icao: 'UUEE', iata: 'SVO', name: 'Шереметьево', city: 'Москва', lat: 55.97, lng: 37.41 },
  { icao: 'UUWW', iata: 'VKO', name: 'Внуково', city: 'Москва', lat: 55.59, lng: 37.26 },
  { icao: 'UUDD', iata: 'DME', name: 'Домодедово', city: 'Москва', lat: 55.41, lng: 37.90 },
  { icao: 'ULLI', iata: 'LED', name: 'Пулково', city: 'Санкт-Петербург', lat: 59.80, lng: 30.26 },
  { icao: 'USSS', iata: 'SVX', name: 'Кольцово', city: 'Екатеринбург', lat: 56.74, lng: 60.80 },
  { icao: 'UNNT', iata: 'OVB', name: 'Толмачёво', city: 'Новосибирск', lat: 54.97, lng: 82.65 },
  { icao: 'URRR', iata: 'ROV', name: 'Платов', city: 'Ростов-на-Дону', lat: 47.49, lng: 39.92 },
  { icao: 'URSS', iata: 'AER', name: 'Сочи', city: 'Сочи', lat: 43.45, lng: 39.94 },
  { icao: 'URKK', iata: 'KRR', name: 'Пашковский', city: 'Краснодар', lat: 45.03, lng: 39.17 },
  { icao: 'UUOB', iata: 'BEG', name: 'Белгород', city: 'Белгород', lat: 50.64, lng: 36.59 },
  { icao: 'URKW', iata: 'AAQ', name: 'Витязево', city: 'Анапа', lat: 45.00, lng: 37.35 },
  { icao: 'UWGG', iata: 'GOJ', name: 'Стригино', city: 'Нижний Новгород', lat: 56.23, lng: 43.78 },
  { icao: 'UWKD', iata: 'KZN', name: 'Казань', city: 'Казань', lat: 55.61, lng: 49.28 },
  { icao: 'USRR', iata: 'TJM', name: 'Рощино', city: 'Тюмень', lat: 57.19, lng: 68.43 },
  { icao: 'UHHH', iata: 'KHV', name: 'Новый', city: 'Хабаровск', lat: 48.53, lng: 135.19 },
  { icao: 'UHWW', iata: 'VVO', name: 'Кневичи', city: 'Владивосток', lat: 43.40, lng: 132.15 },
  { icao: 'UEEE', iata: 'YKS', name: 'Якутск', city: 'Якутск', lat: 62.09, lng: 129.77 },
  { icao: 'UNKL', iata: 'KJA', name: 'Емельяново', city: 'Красноярск', lat: 56.17, lng: 92.49 },
  { icao: 'UIAA', iata: 'IKT', name: 'Иркутск', city: 'Иркутск', lat: 52.27, lng: 104.39 },
  { icao: 'URMO', iata: 'MRV', name: 'Минводы', city: 'Минеральные Воды', lat: 44.22, lng: 43.08 },
  { icao: 'URWW', iata: 'VOG', name: 'Гумрак', city: 'Волгоград', lat: 48.78, lng: 44.35 },
];

module.exports = { fetchFlights, RUSSIA_AIRPORTS };

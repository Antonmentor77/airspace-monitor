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

async function fetchFlights() {
  const token = await getToken();
  const { lamin, lamax, lomin, lomax } = RUSSIA_BBOX;

  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;

  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url, { headers });

  if (resp.status === 429) {
    console.warn('[opensky] Превышен лимит запросов, используем кеш');
    return null; // вернём null, сервер использует кеш
  }

  if (!resp.ok) throw new Error(`OpenSky error: ${resp.status}`);

  const data = await resp.json();

  if (!data.states) return [];

  // Преобразуем массивы в объекты
  return data.states
    .map(state => {
      const obj = {};
      FIELDS.forEach((field, i) => { obj[field] = state[i]; });
      return obj;
    })
    .filter(f => !f.on_ground && f.latitude && f.longitude) // только летящие
    .map(f => ({
      id: f.icao24,
      callsign: (f.callsign || '').trim(),
      country: f.origin_country,
      lat: f.latitude,
      lng: f.longitude,
      altitude: Math.round(f.baro_altitude || 0),
      speed: Math.round((f.velocity || 0) * 3.6), // м/с → км/ч
      heading: Math.round(f.true_track || 0),
      squawk: f.squawk,
      // Сквок 7700 = аварийная ситуация, 7600 = потеря связи, 7500 = захват
      emergency: ['7700', '7600', '7500'].includes(f.squawk),
      lastSeen: f.last_contact,
    }));
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
];

module.exports = { fetchFlights, RUSSIA_AIRPORTS };

// Движок классификации угроз
// Объединяет данные от Telegram + NOTAM и создаёт единую картину угроз

const { RUSSIA_AIRPORTS } = require('./opensky');

// Соответствие регионов → аэропорты
const REGION_AIRPORTS = {
  'Москва': ['UUEE', 'UUWW', 'UUDD'],
  'Московская': ['UUEE', 'UUWW', 'UUDD'],
  'Санкт-Петербург': ['ULLI'],
  'Белгород': ['UUOB'],
  'Ростов': ['URRR'],
  'Краснодар': ['URKK'],
  'Анапа': ['URKW'],
  'Сочи': ['URSS'],
  'Ставрополь': ['URMO'],
  'Саратов': ['UWSW'],
  'Воронеж': ['UUOO'],
};

function getAirportsForRegion(region) {
  return REGION_AIRPORTS[region] || [];
}

// Создаём угрозы из Telegram-сообщений
function classifyThreats(telegramAlerts, airportData) {
  const threats = [];

  for (const alert of telegramAlerts) {
    if (alert.severity === 'low' || alert.type === 'all_clear') continue;

    const affectedAirports = alert.regions
      .flatMap(r => getAirportsForRegion(r))
      .filter((v, i, arr) => arr.indexOf(v) === i); // unique

    threats.push({
      id: `threat_${alert.id}`,
      type: alert.type,
      severity: alert.severity,
      description: alert.text.slice(0, 200),
      source: alert.source,
      regions: alert.regions,
      affectedAirports,
      date: alert.date,
      link: alert.link,
    });

    // Обновляем статус затронутых аэропортов
    if (alert.type === 'airport_closed' || alert.severity === 'high') {
      affectedAirports.forEach(icao => {
        const airport = airportData.find(a => a.icao === icao);
        if (airport && airport.status !== 'closed') {
          airport.status = 'restricted';
          airport.threatSource = alert.source;
          airport.threatDate = alert.date;
        }
      });
    }
  }

  // Добавляем угрозы из NOTAM-данных
  for (const airport of airportData) {
    if (airport.status === 'closed') {
      threats.push({
        id: `notam_${airport.icao}`,
        type: 'airport_closed',
        severity: 'high',
        description: `Аэропорт ${airport.name} (${airport.iata}) закрыт по NOTAM`,
        source: 'NOTAM',
        regions: [airport.city],
        affectedAirports: [airport.icao],
        date: new Date().toISOString(),
      });
    } else if (airport.status === 'restricted') {
      threats.push({
        id: `notam_${airport.icao}`,
        type: 'warning',
        severity: 'medium',
        description: `Ограничения в аэропорту ${airport.name} (${airport.iata})`,
        source: 'NOTAM',
        regions: [airport.city],
        affectedAirports: [airport.icao],
        date: new Date().toISOString(),
      });
    }
  }

  return threats;
}

// Вычисляем "уровень риска" для города/региона (для UI)
function getRiskLevel(region, threats) {
  const relatedThreats = threats.filter(t => t.regions.includes(region));
  if (relatedThreats.some(t => t.severity === 'high')) return 'high';
  if (relatedThreats.some(t => t.severity === 'medium')) return 'medium';
  if (relatedThreats.length > 0) return 'low';
  return 'none';
}

module.exports = { classifyThreats, getRiskLevel };

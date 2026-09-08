// Парсер Telegram-каналов через RSSHub и публичные ленты
// RSSHub превращает любой публичный Telegram-канал в RSS бесплатно
// Документация: https://docs.rsshub.app/routes/social-media#telegram

const CHANNELS = [
  {
    name: 'Радар по всей России',
    handle: 'radarrussiia',
    type: 'threat',
  },
  {
    name: 'Радар ПЛЮС БПЛА',
    handle: 'radar_plus_bpla',
    type: 'threat',
  },
  {
    name: 'Осторожно Москва',
    handle: 'ostorozhno_moskva',
    type: 'airport',
  },
  {
    name: 'Говорит Росавиация',
    handle: 'govorfm',
    type: 'official',
  },
  {
    name: 'МЧС России',
    handle: 'mchs_official',
    type: 'official',
  },
  {
    name: 'Mash',
    handle: 'breakingmash',
    type: 'news',
  },
];

// Публичный инстанс RSSHub (или self-hosted: process.env.RSSHUB_URL)
const RSSHUB_BASE = process.env.RSSHUB_URL || 'https://rsshub.app';

// Ключевые слова для классификации угроз
const THREAT_KEYWORDS = {
  drone: ['бпла', 'беспилотник', 'дрон', 'uav', 'uas'],
  missile: ['ракет', 'missile', 'крылатая'],
  airport_closed: ['закрыт', 'закрыт аэропорт', 'closed', 'clsd', 'ограничен', 'приостановл'],
  all_clear: ['отбой', 'снят', 'открыт', 'all clear'],
  warning: ['угроза', 'опасность', 'тревога', 'предупреждение'],
};

function classifyText(text) {
  const lower = text.toLowerCase();

  if (THREAT_KEYWORDS.all_clear.some(kw => lower.includes(kw))) return 'all_clear';
  if (THREAT_KEYWORDS.airport_closed.some(kw => lower.includes(kw))) return 'airport_closed';
  if (THREAT_KEYWORDS.missile.some(kw => lower.includes(kw))) return 'missile';
  if (THREAT_KEYWORDS.drone.some(kw => lower.includes(kw))) return 'drone';
  if (THREAT_KEYWORDS.warning.some(kw => lower.includes(kw))) return 'warning';
  return 'info';
}

function extractRegions(text) {
  const regions = [
    'Москва', 'Московская', 'Санкт-Петербург', 'Белгород', 'Курск',
    'Воронеж', 'Брянск', 'Ростов', 'Краснодар', 'Саратов', 'Тула',
    'Калуга', 'Орёл', 'Липецк', 'Тамбов', 'Рязань', 'Владимир',
    'Крым', 'Севастополь', 'Анапа', 'Сочи', 'Ставрополь',
  ];
  return regions.filter(r => text.includes(r));
}

function severityFromType(type) {
  const map = {
    missile: 'high',
    airport_closed: 'high',
    drone: 'medium',
    warning: 'medium',
    all_clear: 'low',
    info: 'low',
  };
  return map[type] || 'low';
}

async function parseRSSFeed(url) {
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) throw new Error(`RSS fetch failed: ${resp.status}`);
  const xml = await resp.text();

  // Простой XML парсер для RSS items
  const items = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const match of itemMatches) {
    const item = match[1];

    const titleMatch = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                       item.match(/<title>([\s\S]*?)<\/title>/);
    const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                      item.match(/<description>([\s\S]*?)<\/description>/);
    const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);

    const text = (titleMatch?.[1] || '') + ' ' + (descMatch?.[1] || '');
    const cleanText = text.replace(/<[^>]+>/g, '').trim();

    if (cleanText.length > 10) {
      items.push({
        text: cleanText,
        date: dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString(),
        link: linkMatch?.[1] || '',
      });
    }
  }

  return items.slice(0, 10); // последние 10 сообщений
}

async function fetchTelegramAlerts() {
  const alerts = [];
  const now = Date.now();
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  for (const channel of CHANNELS) {
    try {
      const rssUrl = `${RSSHUB_BASE}/telegram/channel/${channel.handle}`;
      const items = await parseRSSFeed(rssUrl);

      for (const item of items) {
        const type = classifyText(item.text);
        const regions = extractRegions(item.text);
        const itemDate = new Date(item.date).getTime();

        // Только свежие (< 6 часов)
        if (now - itemDate > SIX_HOURS) continue;

        alerts.push({
          id: `tg_${channel.handle}_${itemDate}`,
          source: channel.name,
          channel: `@${channel.handle}`,
          text: item.text.slice(0, 300), // обрезаем длинные тексты
          type,
          severity: severityFromType(type),
          regions,
          date: item.date,
          link: item.link,
        });
      }
    } catch (err) {
      console.warn(`[telegram] Ошибка канала @${channel.handle}:`, err.message);
    }
  }

  // Сортируем по дате, самые свежие первыми
  return alerts.sort((a, b) => new Date(b.date) - new Date(a.date));
}

module.exports = { fetchTelegramAlerts };

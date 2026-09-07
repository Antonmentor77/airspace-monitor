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
];

// Публичный инстанс RSSHub (или self-hosted: process.env.RSSHUB_URL)
const TELEGRAM_FEED_BASE =
  process.env.TELEGRAM_FEED_URL || 'https://tg-rss.contractsguard.com/feed';

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

async function parseTelegramFeed(channelHandle) {
  const url = `${TELEGRAM_FEED_BASE}/${channelHandle}`;

  const resp = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AirspaceMonitor/1.0',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`Telegram feed failed: ${resp.status}`);
  }

  const data = await resp.json();

  const items = Array.isArray(data)
    ? data
    : Array.isArray(data.items)
      ? data.items
      : [];

  return items.slice(0, 20).map(item => {
    const rawText =
      item.content ||
      item.description ||
      item.title ||
      '';

    const cleanText = rawText
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#39;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/\n\s*\n+/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .trim();

    return {
      text: cleanText,
      date: item.created || item.pubDate || item.date || new Date().toISOString(),
      link: item.link || item.id || '',
    };
  });
}

          async function fetchTelegramAlerts() {
  const alerts = [];
  const now = Date.now();
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  for (const channel of CHANNELS) {
    try {
      const items = await parseTelegramFeed(channel.handle);

      for (const item of items) {
        const type = classifyText(item.text);
        const regions = extractRegions(item.text);
        const itemDate = new Date(item.date).getTime();

        // Только свежие сообщения — последние 6 часов
        if (now - itemDate > SIX_HOURS) continue;

        alerts.push({
          id: `tg_${channel.handle}_${itemDate}`,
          source: channel.name,
          channel: `@${channel.handle}`,
          text: item.text.slice(0, 300),
          type,
          severity: severityFromType(type),
          regions,
          date: item.date,
          link: item.link,
        });
      }
    } catch (err) {
      console.warn(
        `[telegram] Ошибка канала @${channel.handle}:`,
        err.message
      );
    }
  }

  // Самые свежие сообщения первыми
  return alerts.sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
}


module.exports = { fetchTelegramAlerts };

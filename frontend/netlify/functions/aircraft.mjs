const cache = new Map();
const CACHE_MS = 20_000;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default async (req) => {
  const url = new URL(req.url);
  const lat = toNumber(url.searchParams.get("lat"), 55.75);
  const lon = toNumber(url.searchParams.get("lon"), 37.62);
  const radius = Math.min(
    Math.max(toNumber(url.searchParams.get("radius"), 100), 10),
    250
  );

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json(
      { error: "Некорректные координаты" },
      { status: 400 }
    );
  }

  const cacheKey = `${lat.toFixed(2)}:${lon.toFixed(2)}:${radius}`;
  const saved = cache.get(cacheKey);

  if (saved && Date.now() - saved.createdAt < CACHE_MS) {
    return Response.json(saved.data, {
      headers: { "Cache-Control": "public, max-age=15" }
    });
  }

  try {
    const response = await fetch(
      `https://api.adsb.lol/v2/point/${lat}/${lon}/${radius}`,
      { headers: { "User-Agent": "AirspaceMonitorRU/1.0" } }
    );

    if (!response.ok) {
      throw new Error(`Источник недоступен: ${response.status}`);
    }

    const source = await response.json();

    const aircraft = (source.ac || [])
      .filter((plane) => Number.isFinite(plane.lat) && Number.isFinite(plane.lon))
      .map((plane) => ({
        id: plane.hex,
        flight: (plane.flight || "").trim() || "Без позывного",
        lat: plane.lat,
        lon: plane.lon,
        heading: plane.track ?? 0,
        altitudeFt: typeof plane.alt_baro === "number" ? plane.alt_baro : null,
        speedKt: plane.gs ?? null,
        type: plane.t ?? null,
        registration: plane.r ?? null,
        seenSeconds: plane.seen_pos ?? plane.seen ?? null
      }));

    const data = {
      updatedAt: new Date().toISOString(),
      count: aircraft.length,
      aircraft
    };

    cache.set(cacheKey, { createdAt: Date.now(), data });

    return Response.json(data, {
      headers: { "Cache-Control": "public, max-age=15" }
    });
  } catch {
    return Response.json(
      { error: "Не удалось получить данные о бортах" },
      { status: 502 }
    );
  }
};
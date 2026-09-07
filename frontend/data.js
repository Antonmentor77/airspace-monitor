// URL твоего backend на Render
const API_BASE = "https://airspace-monitor.onrender.com";

// Интервал автообновления (30 секунд)
const REFRESH_INTERVAL = 30000;

// Начальный центр карты (Россия)
const MAP_CENTER = [61.5, 95.0];
const MAP_ZOOM = 4;

// Цвета статусов
const STATUS_COLORS = {
    open: "#22c55e",
    restricted: "#f59e0b",
    closed: "#ef4444",
    unknown: "#6b7280"
};
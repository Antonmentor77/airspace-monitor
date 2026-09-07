let map;
let markers = [];
let aircraftLayer;
let aircraftRefreshTimer;
let aircraftMoveTimer;

function initMap() {
    map = L.map("map").setView([61.5, 95], 4);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(map);

    aircraftLayer = L.layerGroup().addTo(map);

    map.on("moveend", () => {
        clearTimeout(aircraftMoveTimer);
        aircraftMoveTimer = setTimeout(loadAircraft, 800);
    });

    loadAircraft();

    aircraftRefreshTimer = setInterval(() => {
        if (!document.hidden) loadAircraft();
    }, 30_000);
}

function aircraftIcon(heading = 0) {
    return L.divIcon({
        className: "aircraft-icon",
        html: `<div style="
            color: #60a5fa;
            font-size: 22px;
            line-height: 22px;
            transform: rotate(${heading}deg);
            text-shadow: 0 0 7px #000;
        ">✈</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[character]));
}

async function loadAircraft() {
    if (!map || !aircraftLayer) return;

    const center = map.getCenter();
    const radius = 120;

    try {
        const response = await fetch(
            `/.netlify/functions/aircraft?lat=${center.lat}&lon=${center.lng}&radius=${radius}`
        );

        if (!response.ok) throw new Error("Ошибка загрузки самолётов");

        const data = await response.json();

        aircraftLayer.clearLayers();

        data.aircraft.forEach((plane) => {
            const altitude = plane.altitudeFt
                ? `${Math.round(plane.altitudeFt).toLocaleString("ru-RU")} ft`
                : "нет данных";

            const speed = plane.speedKt
                ? `${Math.round(plane.speedKt)} узл.`
                : "нет данных";

            L.marker([plane.lat, plane.lon], {
                icon: aircraftIcon(plane.heading)
            })
                .bindPopup(`
                    <b>${escapeHtml(plane.flight)}</b><br>
                    Высота: ${altitude}<br>
                    Скорость: ${speed}<br>
                    Тип: ${escapeHtml(plane.type || "нет данных")}<br>
                    Регистрация: ${escapeHtml(plane.registration || "нет данных")}<br>
                    Сигнал: ${plane.seenSeconds ?? "?"} сек. назад
                `)
                .addTo(aircraftLayer);
        });

        console.log(`Самолётов в зоне: ${data.count}`);
    } catch (error) {
        console.warn("Самолёты временно недоступны", error);
    }
}

function showAirports(airports) {
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];

    airports.forEach(airport => {
        const marker = L.circleMarker(
            [airport.lat, airport.lon],
            {
                radius: 6,
                color: "#00ff99",
                fillColor: "#00ff99",
                fillOpacity: 0.9
            }
        ).addTo(map);

        marker.bindPopup(`
            <b>${airport.name}</b><br>
            ${airport.city}<br>
            ICAO: ${airport.icao}<br>
            IATA: ${airport.iata}
        `);

        markers.push(marker);
    });
}
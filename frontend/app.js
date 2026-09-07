import { initMap, showAirports } from "./map.js";
import { loadAirports } from "./airports.js";
// === ИНИЦИАЛИЗАЦИЯ КАРТЫ ===

const map = L.map('map', {
    zoomControl: true,
    attributionControl: false
}).setView(MAP_CENTER, MAP_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 10
}).addTo(map);


// === СЛОИ ===

const airportLayer = L.layerGroup().addTo(map);
const flightLayer = L.layerGroup().addTo(map);
const threatLayer = L.layerGroup().addTo(map);


// === ЭЛЕМЕНТЫ ИНТЕРФЕЙСА ===

const backendStatus = document.getElementById('backendStatus');
const lastUpdate = document.getElementById('lastUpdate');
const sidebarContent = document.getElementById('sidebarContent');


// === ПРОВЕРКА СЕРВЕРА ===

async function checkBackend() {

    try {

        const res = await fetch(`${API_BASE}/health`);

        if (!res.ok) throw new Error('health failed');

        backendStatus.innerHTML = '🟢 Backend Online';
        backendStatus.style.color = '#22c55e';

        return true;

    } catch (e) {

        backendStatus.innerHTML = '🔴 Backend Offline';
        backendStatus.style.color = '#ef4444';

        sidebarContent.innerHTML = `
            <div class="card">
                <h3>Сервер недоступен</h3>
                <p style="color:#9ca3af;margin-top:8px">
                    Render может спать 20–40 секунд.
                </p>
            </div>
        `;

        return false;
    }
}


// === АЭРОПОРТЫ ===

function addAirportMarker(airport, status = 'unknown') {

    const color = STATUS_COLORS[status] || STATUS_COLORS.unknown;

    const marker = L.circleMarker([airport.lat, airport.lon], {
        radius: 7,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.8
    });

    marker.bindPopup(`
        <b>${airport.name}</b><br>
        ${airport.city}<br>
        ICAO: ${airport.icao}<br>
        IATA: ${airport.iata}<br>
        Статус: <b>${status.toUpperCase()}</b>
    `);

    airportLayer.addLayer(marker);
}


// === ЗАГРУЗКА АЭРОПОРТОВ ===

async function loadAirports() {

    try {

        const res = await fetch('airports.json');
        const airports = await res.json();

        airportLayer.clearLayers();

        airports.forEach(a => addAirportMarker(a));

        renderAirportList(airports);

    } catch (e) {

        console.error('airports load error', e);
    }
}


// === СПИСОК АЭРОПОРТОВ ===

function renderAirportList(airports) {

    sidebarContent.innerHTML = airports.map(a => `
        <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                    <div style="font-weight:600">${a.name}</div>
                    <div style="color:#9ca3af;font-size:13px">
                        ${a.city} · ${a.iata}
                    </div>
                </div>
                <span class="badge open">OPEN</span>
            </div>
        </div>
    `).join('');
}


// === ПОИСК ===

document.getElementById('airportSearch').addEventListener('input', async (e) => {

    const q = e.target.value.toLowerCase();

    const res = await fetch('airports.json');
    const airports = await res.json();

    const filtered = airports.filter(a =>

        a.name.toLowerCase().includes(q) ||
        a.city.toLowerCase().includes(q) ||
        a.icao.toLowerCase().includes(q) ||
        a.iata.toLowerCase().includes(q)

    );

    renderAirportList(filtered);
});


// === ВКЛАДКИ ===

document.querySelectorAll('.tab').forEach(btn => {

    btn.addEventListener('click', () => {

        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));

        btn.classList.add('active');

        const tab = btn.dataset.tab;

        if (tab === 'airports') loadAirports();

        if (tab === 'flights') {
            sidebarContent.innerHTML = `
                <div class="card">
                    <h3>Самолёты</h3>
                    <p style="color:#9ca3af;margin-top:8px">
                        Подключим на следующем шаге.
                    </p>
                </div>
            `;
        }

        if (tab === 'attacks') {
            sidebarContent.innerHTML = `
                <div class="card">
                    <h3>Атаки</h3>
                    <p style="color:#9ca3af;margin-top:8px">
                        История угроз будет подключена.
                    </p>
                </div>
            `;
        }

        if (tab === 'danger') {
            sidebarContent.innerHTML = `
                <div class="card">
                    <h3>⚠ Не рекомендуется лететь</h3>
                    <ul style="margin-top:10px;padding-left:18px;line-height:1.8">
                        <li>Ростов</li>
                        <li>Белгород</li>
                        <li>Курск</li>
                    </ul>
                </div>
            `;
        }
    });
});


// === ВРЕМЯ ОБНОВЛЕНИЯ ===

function updateTimestamp() {

    lastUpdate.textContent =
        new Date().toLocaleTimeString('ru-RU');
}


// === ЗАПУСК ===

async function init() {initMap();

    updateTimestamp();

    const ok = await checkBackend();

    if (ok) {
        const airports = await loadAirports();
showAirports(airports);
    }

    setInterval(updateTimestamp, 1000);
}

init();
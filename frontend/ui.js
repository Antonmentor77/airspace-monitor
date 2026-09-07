export async function loadAirports() {
    const response = await fetch("airports.json");
    return await response.json();
}
const fs = require('fs');

const markets = JSON.parse(fs.readFileSync('src/data/markets.json'));
const cityCoords = JSON.parse(fs.readFileSync('src/data/city_coordinates.json'));

const marketCoords = {};
const cityCount = {};

// Distribute markets within the same city
for (const [marketName, info] of Object.entries(markets)) {
    const city = info.city;
    if (!cityCoords[city]) {
        console.warn('Unknown city', city);
        continue;
    }
    const [lng, lat] = cityCoords[city];
    cityCount[city] = (cityCount[city] || 0) + 1;
    
    // Add jitter if there are multiple markets in the same city
    const offsetLng = (cityCount[city] - 1) * 0.05;
    const offsetLat = (cityCount[city] - 1) * 0.05;
    
    marketCoords[marketName] = {
        province: info.province,
        city: city,
        coordinates: [lng + offsetLng, lat - offsetLat]
    };
}

fs.writeFileSync('src/data/market_coordinates.json', JSON.stringify(marketCoords, null, 2));

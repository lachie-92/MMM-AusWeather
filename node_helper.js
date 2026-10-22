const NodeHelper = require("node_helper");
const https = require("https");

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";

// Points searched (km from home, compass bearings) when no beach is configured
const SEARCH_DISTANCES_KM = [0, 10, 20, 30, 45, 60, 80, 100];
const SEARCH_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

module.exports = NodeHelper.create({
    start: function() {
        console.log("Starting node helper for: " + this.name);
        this.seaPoints = {}; // nearest sea point per home location, found once
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "AUSWEATHER_FETCH") {
            this.fetchAll(payload);
        }
    },

    fetchAll: async function(payload) {
        const { identifier, config } = payload;

        const [weather, sea] = await Promise.allSettled([
            this.fetchWeather(config),
            config.showSea ? this.fetchSea(config) : Promise.resolve(null)
        ]);

        if (weather.status === "rejected") {
            console.error("MMM-AusWeather: error fetching weather:", weather.reason.message);
        }
        if (sea.status === "rejected") {
            console.error("MMM-AusWeather: error fetching sea data:", sea.reason.message);
        }

        this.sendSocketNotification("AUSWEATHER_DATA", {
            identifier: identifier,
            weather: weather.status === "fulfilled" ? weather.value : null,
            weatherError: weather.status === "rejected" ? weather.reason.message : null,
            sea: sea.status === "fulfilled" ? sea.value : null,
            seaError: sea.status === "rejected" ? sea.reason.message : null
        });
    },

    fetchWeather: function(config) {
        return this.fetchJson(FORECAST_URL, {
            latitude: config.latitude,
            longitude: config.longitude,
            current: "temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m",
            hourly: "precipitation_probability,precipitation",
            daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max",
            timezone: "auto",
            timeformat: "unixtime",
            forecast_days: Math.max(config.forecastDays, 1),
            forecast_hours: config.rainHours
        });
    },

    fetchSea: async function(config) {
        let point;
        if (config.beach && config.beach.latitude != null && config.beach.longitude != null) {
            point = { latitude: config.beach.latitude, longitude: config.beach.longitude };
        } else {
            point = await this.findSeaPoint(config.latitude, config.longitude);
        }

        const data = await this.fetchJson(MARINE_URL, {
            latitude: point.latitude,
            longitude: point.longitude,
            current: "sea_surface_temperature,wave_height",
            timezone: "auto",
            timeformat: "unixtime",
            cell_selection: "sea"
        });

        if (data.current.sea_surface_temperature == null) {
            throw new Error("No sea data at the beach location. Try coordinates slightly offshore.");
        }

        return {
            temperature: data.current.sea_surface_temperature,
            waveHeight: data.current.wave_height
        };
    },

    // Searches rings around home in one request and keeps the closest open-ocean point.
    // Harbours and rivers can have sea temperature but no wave data, so requiring
    // both skips them.
    findSeaPoint: async function(latitude, longitude) {
        const key = latitude + "," + longitude;
        if (this.seaPoints[key]) {
            return this.seaPoints[key];
        }

        const candidates = [];
        SEARCH_DISTANCES_KM.forEach(distance => {
            const bearings = distance === 0 ? [0] : SEARCH_BEARINGS;
            bearings.forEach(bearing => {
                candidates.push(offsetPoint(latitude, longitude, distance, bearing));
            });
        });

        const results = await this.fetchJson(MARINE_URL, {
            latitude: candidates.map(point => point.latitude.toFixed(4)).join(","),
            longitude: candidates.map(point => point.longitude.toFixed(4)).join(","),
            current: "sea_surface_temperature,wave_height",
            cell_selection: "sea"
        });

        let nearest = null;
        let nearestDistance = Infinity;
        [].concat(results).forEach(result => {
            if (result.current.sea_surface_temperature == null || result.current.wave_height == null) {
                return;
            }
            const distance = distanceKm(latitude, longitude, result.latitude, result.longitude);
            if (distance < nearestDistance) {
                nearest = { latitude: result.latitude, longitude: result.longitude };
                nearestDistance = distance;
            }
        });

        if (!nearest) {
            throw new Error("No sea found within 100 km. Set beach coordinates in the config.");
        }

        console.log(`MMM-AusWeather: using sea point ${nearest.latitude}, ${nearest.longitude} (${Math.round(nearestDistance)} km away)`);
        this.seaPoints[key] = nearest;
        return nearest;
    },

    // Uses https rather than fetch so the IPv4 fallback can wait longer than Node's
    // 250 ms default. Open-Meteo's servers are in Europe and connecting from Australia
    // takes longer than that, so fetch fails on networks without working IPv6.
    fetchJson: function(baseUrl, params) {
        const url = baseUrl + "?" + new URLSearchParams(params).toString();

        return new Promise((resolve, reject) => {
            const request = https.get(url, { autoSelectFamilyAttemptTimeout: 2000, timeout: 15000 }, response => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", chunk => {
                    body += chunk;
                });
                response.on("end", () => {
                    let data = null;
                    try {
                        data = JSON.parse(body);
                    } catch (error) {
                        // Reported below
                    }

                    if (response.statusCode !== 200) {
                        const reason = data && data.reason ? data.reason : response.statusMessage;
                        reject(new Error(`Open-Meteo error ${response.statusCode}: ${reason}`));
                    } else if (!data) {
                        reject(new Error("Open-Meteo returned invalid JSON"));
                    } else {
                        resolve(data);
                    }
                });
            });

            request.on("timeout", () => request.destroy(new Error("Open-Meteo request timed out")));
            request.on("error", reject);
        });
    }
});

function offsetPoint(latitude, longitude, distance, bearing) {
    const radians = bearing * Math.PI / 180;
    const kmPerDegree = 111.32;
    return {
        latitude: latitude + (distance * Math.cos(radians)) / kmPerDegree,
        longitude: longitude + (distance * Math.sin(radians)) / (kmPerDegree * Math.cos(latitude * Math.PI / 180))
    };
}

function distanceKm(lat1, lon1, lat2, lon2) {
    const toRadians = degrees => degrees * Math.PI / 180;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

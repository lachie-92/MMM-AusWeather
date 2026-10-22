// MMM-AusWeather.js
Module.register("MMM-AusWeather", {
    defaults: {
        latitude: null,
        longitude: null,
        beach: null, // e.g. { name: "Bondi", latitude: -33.893, longitude: 151.281 }
        updateInterval: 15 * 60 * 1000, // 15 minutes
        animationSpeed: 1000,
        forecastDays: 5,
        rainHours: 12,
        rainThreshold: 50, // chance of rain (%) at which rain counts as likely
        showFeelsLike: true,
        showWind: true,
        showUV: true,
        showSea: true,
        showWaves: true,
        showRainChart: true,
        showForecast: true,
        timeFormat: config.timeFormat
    },

    // WMO weather codes used by Open-Meteo: [day text, day icon, night icon, night text]
    weatherCodes: {
        0: ["Sunny", "wi-day-sunny", "wi-night-clear", "Clear"],
        1: ["Mostly sunny", "wi-day-sunny-overcast", "wi-night-alt-partly-cloudy", "Mostly clear"],
        2: ["Partly cloudy", "wi-day-cloudy", "wi-night-alt-cloudy"],
        3: ["Cloudy", "wi-cloudy", "wi-cloudy"],
        45: ["Fog", "wi-fog", "wi-fog"],
        48: ["Fog", "wi-fog", "wi-fog"],
        51: ["Light drizzle", "wi-sprinkle", "wi-sprinkle"],
        53: ["Drizzle", "wi-sprinkle", "wi-sprinkle"],
        55: ["Heavy drizzle", "wi-sprinkle", "wi-sprinkle"],
        56: ["Freezing drizzle", "wi-rain-mix", "wi-rain-mix"],
        57: ["Freezing drizzle", "wi-rain-mix", "wi-rain-mix"],
        61: ["Light rain", "wi-rain", "wi-rain"],
        63: ["Rain", "wi-rain", "wi-rain"],
        65: ["Heavy rain", "wi-rain", "wi-rain"],
        66: ["Freezing rain", "wi-rain-mix", "wi-rain-mix"],
        67: ["Freezing rain", "wi-rain-mix", "wi-rain-mix"],
        71: ["Light snow", "wi-snow", "wi-snow"],
        73: ["Snow", "wi-snow", "wi-snow"],
        75: ["Heavy snow", "wi-snow", "wi-snow"],
        77: ["Snow", "wi-snow", "wi-snow"],
        80: ["Light showers", "wi-day-showers", "wi-night-alt-showers"],
        81: ["Showers", "wi-day-showers", "wi-night-alt-showers"],
        82: ["Heavy showers", "wi-day-showers", "wi-night-alt-showers"],
        85: ["Snow showers", "wi-snow", "wi-snow"],
        86: ["Heavy snow showers", "wi-snow", "wi-snow"],
        95: ["Thunderstorm", "wi-thunderstorm", "wi-thunderstorm"],
        96: ["Storm with hail", "wi-hail", "wi-hail"],
        99: ["Storm with heavy hail", "wi-hail", "wi-hail"]
    },

    start: function() {
        Log.info("Starting module: " + this.name);
        this.weather = null;
        this.sea = null;
        this.weatherError = null;
        this.seaError = null;

        if (this.config.latitude == null || this.config.longitude == null) {
            this.weatherError = "Set latitude and longitude in the module config";
            return;
        }

        var self = this;
        this.fetchData();
        setInterval(function() {
            self.fetchData();
        }, this.config.updateInterval);
    },

    getStyles: function() {
        return ["font-awesome.css", "weather-icons.css", "MMM-AusWeather.css"];
    },

    fetchData: function() {
        this.sendSocketNotification("AUSWEATHER_FETCH", {
            identifier: this.identifier,
            config: {
                latitude: this.config.latitude,
                longitude: this.config.longitude,
                beach: this.config.beach,
                forecastDays: this.config.forecastDays,
                rainHours: this.config.rainHours,
                showSea: this.config.showSea
            }
        });
    },

    socketNotificationReceived: function(notification, payload) {
        // Each instance only handles its own data
        if (notification !== "AUSWEATHER_DATA" || payload.identifier !== this.identifier) {
            return;
        }

        // On failure keep showing the last good data
        if (payload.weather) {
            this.weather = payload.weather;
        }
        this.weatherError = payload.weatherError;

        if (payload.sea) {
            this.sea = payload.sea;
        }
        this.seaError = payload.seaError;

        this.updateDom(this.config.animationSpeed);
    },

    getDom: function() {
        var wrapper = this.createElement("div", "ausweather");

        if (!this.weather) {
            var message = this.weatherError || "Loading weather...";
            wrapper.appendChild(this.createElement("div", "status dimmed light small", message));
            return wrapper;
        }

        wrapper.appendChild(this.createCurrent());
        wrapper.appendChild(this.createToday());

        if (this.config.showSea) {
            wrapper.appendChild(this.createSea());
        }
        if (this.config.showRainChart && this.weather.hourly) {
            wrapper.appendChild(this.createRainChart());
        }
        if (this.config.showForecast && this.config.forecastDays > 0) {
            wrapper.appendChild(this.createForecast());
        }
        if (this.weatherError) {
            wrapper.appendChild(this.createElement("div", "status dimmed xsmall", "Update failed: " + this.weatherError));
        }

        return wrapper;
    },

    createCurrent: function() {
        var current = this.weather.current;
        var info = this.weatherInfo(current.weather_code, current.is_day);
        var container = this.createElement("div", "current");

        container.appendChild(this.createIcon("wi " + info.icon + " current-icon bright"));

        var main = this.createElement("div", "current-main");
        main.appendChild(this.createElement("div", "current-temp large light bright", Math.round(current.temperature_2m) + "°"));
        main.appendChild(this.createElement("div", "current-text normal medium", info.text));
        container.appendChild(main);

        var details = this.createElement("div", "current-details small");
        if (this.config.showFeelsLike) {
            details.appendChild(this.createElement("div", "dimmed", "Feels " + Math.round(current.apparent_temperature) + "°"));
        }
        if (this.config.showWind) {
            var wind = this.createElement("div", "dimmed");
            wind.appendChild(this.createIcon("wi wi-strong-wind"));
            wind.appendChild(document.createTextNode(" " + Math.round(current.wind_speed_10m) + " km/h " + this.windDirection(current.wind_direction_10m)));
            details.appendChild(wind);
        }
        container.appendChild(details);

        return container;
    },

    createToday: function() {
        var daily = this.weather.daily;
        var row = this.createElement("div", "row small");

        row.appendChild(this.createItem("wi wi-sunrise", this.formatTime(daily.sunrise[0])));
        row.appendChild(this.createItem("wi wi-sunset", this.formatTime(daily.sunset[0])));

        // Today's rain is already the first row of the forecast
        if (!this.config.showForecast) {
            row.appendChild(this.createItem("wi wi-umbrella", this.formatRain(daily.precipitation_probability_max[0], daily.precipitation_sum[0])));
        }

        if (this.config.showUV && daily.uv_index_max[0] != null) {
            var uv = Math.round(daily.uv_index_max[0]);
            var category = this.uvCategory(uv);
            var uvItem = this.createItem("fas fa-sun", "UV " + uv + " " + category.label);
            uvItem.classList.add("uv-" + category.key);
            row.appendChild(uvItem);
        }

        return row;
    },

    createSea: function() {
        var row = this.createElement("div", "row sea small");

        if (!this.sea) {
            var message = this.seaError ? "Sea temperature unavailable" : "Loading sea temperature...";
            row.appendChild(this.createItem("fas fa-person-swimming", message));
            row.classList.add("dimmed");
            return row;
        }

        var name = this.config.beach && this.config.beach.name ? this.config.beach.name : "Sea";
        row.appendChild(this.createItem("fas fa-person-swimming", name + " " + this.sea.temperature.toFixed(1) + "°"));

        if (this.config.showWaves && this.sea.waveHeight != null) {
            row.appendChild(this.createItem("fas fa-water", "Waves " + this.sea.waveHeight.toFixed(1) + " m"));
        }

        return row;
    },

    createRainChart: function() {
        var hourly = this.weather.hourly;
        var container = this.createElement("div", "rain");
        container.appendChild(this.createElement("div", "rain-summary small", this.rainSummary()));

        var bars = this.createElement("div", "rain-bars");
        var labels = this.createElement("div", "rain-labels xsmall dimmed");

        hourly.time.forEach((time, index) => {
            var probability = hourly.precipitation_probability[index] || 0;
            var column = this.createElement("div", "rain-column");
            var bar = this.createElement("div", "rain-bar");
            bar.style.height = Math.max(probability, 2) + "%";
            if (probability >= this.config.rainThreshold) {
                bar.classList.add("likely");
            }
            column.appendChild(bar);
            bars.appendChild(column);

            var labelText = "";
            if (index === 0) {
                labelText = "Now";
            } else if (index % 3 === 0) {
                labelText = this.formatHour(time);
            }
            labels.appendChild(this.createElement("div", "rain-label", labelText));
        });

        container.appendChild(bars);
        container.appendChild(labels);
        return container;
    },

    createForecast: function() {
        var daily = this.weather.daily;
        var table = this.createElement("table", "forecast small");
        var days = Math.min(this.config.forecastDays, daily.time.length);

        for (var i = 0; i < days; i++) {
            var info = this.weatherInfo(daily.weather_code[i], 1);
            var row = this.createElement("tr");

            row.appendChild(this.createElement("td", "day", this.formatDay(daily.time[i], i)));

            var iconCell = this.createElement("td", "icon");
            iconCell.appendChild(this.createIcon("wi " + info.icon));
            row.appendChild(iconCell);

            row.appendChild(this.createElement("td", "max-temp bright", Math.round(daily.temperature_2m_max[i]) + "°"));
            row.appendChild(this.createElement("td", "min-temp dimmed", Math.round(daily.temperature_2m_min[i]) + "°"));
            row.appendChild(this.createElement("td", "rain-chance", this.formatRain(daily.precipitation_probability_max[i], daily.precipitation_sum[i])));

            table.appendChild(row);
        }

        return table;
    },

    rainSummary: function() {
        var hourly = this.weather.hourly;
        var hours = hourly.time.length;

        for (var i = 0; i < hours; i++) {
            if ((hourly.precipitation_probability[i] || 0) >= this.config.rainThreshold) {
                if (i === 0) {
                    return "Rain likely now";
                }
                return "Rain likely from " + this.formatHour(hourly.time[i]);
            }
        }

        return "Rain unlikely in the next " + hours + " hours";
    },

    weatherInfo: function(code, isDay) {
        var entry = this.weatherCodes[code] || ["Unknown", "wi-na", "wi-na"];
        return {
            text: !isDay && entry[3] ? entry[3] : entry[0],
            icon: isDay ? entry[1] : entry[2]
        };
    },

    // Australian UV index categories
    uvCategory: function(uv) {
        if (uv >= 11) {
            return { key: "extreme", label: "Extreme" };
        }
        if (uv >= 8) {
            return { key: "very-high", label: "Very high" };
        }
        if (uv >= 6) {
            return { key: "high", label: "High" };
        }
        if (uv >= 3) {
            return { key: "moderate", label: "Moderate" };
        }
        return { key: "low", label: "Low" };
    },

    windDirection: function(degrees) {
        var directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
        return directions[Math.round(degrees / 22.5) % 16];
    },

    formatRain: function(probability, amount) {
        var text = (probability || 0) + "%";
        if (amount >= 0.1) {
            text += " · " + amount.toFixed(1) + " mm";
        }
        return text;
    },

    // Times use the forecast location's time zone, not the mirror's
    formatTime: function(unixTime) {
        return new Date(unixTime * 1000).toLocaleTimeString("en-AU", {
            hour: "numeric",
            minute: "2-digit",
            hour12: this.config.timeFormat !== 24,
            timeZone: this.weather.timezone
        });
    },

    formatHour: function(unixTime) {
        return new Date(unixTime * 1000).toLocaleTimeString("en-AU", {
            hour: "numeric",
            hour12: this.config.timeFormat !== 24,
            timeZone: this.weather.timezone
        });
    },

    formatDay: function(unixTime, index) {
        if (index === 0) {
            return "Today";
        }
        return new Date(unixTime * 1000).toLocaleDateString("en-AU", {
            weekday: "short",
            timeZone: this.weather.timezone
        });
    },

    createItem: function(iconClass, text) {
        var item = this.createElement("span", "item");
        item.appendChild(this.createIcon(iconClass));
        item.appendChild(document.createTextNode(" " + text));
        return item;
    },

    createIcon: function(className) {
        return this.createElement("i", className);
    },

    createElement: function(tag, className, text) {
        var element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text != null) {
            element.textContent = text;
        }
        return element;
    }
});

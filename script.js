
/* ==========================================
   AETHER - PREMIUM WEATHER APPLICATION

   Weather API: Open-Meteo
   Geocoding: Open-Meteo
   Map: Leaflet + OpenStreetMap
   Radar: RainViewer
========================================== */

const API_URL = "https://api.open-meteo.com/v1/forecast";
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

// Application State
let currentUnit = "C";
let currentWeatherData = null;
let currentLocation = null;
let suggestionTimer = null;
let searchRequestNumber = 0;
let mapRequestNumber = 0;

// Map State
let aetherMap = null;
let aetherMarker = null;
let aetherRadarLayer = null;

// Notification State
let aetherNotificationsEnabled = false;
let aetherLastNotification = "";

/* ==========================================
   WEATHER CONDITIONS
========================================== */

const weatherCodes = {
    0: { description: "Clear Sky", icon: "fa-sun", color: "#fbbf24" },
    1: { description: "Mainly Clear", icon: "fa-cloud-sun", color: "#fbbf24" },
    2: { description: "Partly Cloudy", icon: "fa-cloud-sun", color: "#fbbf24" },
    3: { description: "Overcast", icon: "fa-cloud", color: "#94a3b8" },
    45: { description: "Foggy", icon: "fa-smog", color: "#94a3b8" },
    48: { description: "Rime Fog", icon: "fa-smog", color: "#94a3b8" },
    51: { description: "Light Drizzle", icon: "fa-cloud-rain", color: "#60a5fa" },
    53: { description: "Moderate Drizzle", icon: "fa-cloud-rain", color: "#60a5fa" },
    55: { description: "Heavy Drizzle", icon: "fa-cloud-showers-heavy", color: "#60a5fa" },
    61: { description: "Light Rain", icon: "fa-cloud-rain", color: "#60a5fa" },
    63: { description: "Moderate Rain", icon: "fa-cloud-rain", color: "#60a5fa" },
    65: { description: "Heavy Rain", icon: "fa-cloud-showers-heavy", color: "#60a5fa" },
    71: { description: "Light Snow", icon: "fa-snowflake", color: "#bae6fd" },
    73: { description: "Moderate Snow", icon: "fa-snowflake", color: "#bae6fd" },
    75: { description: "Heavy Snow", icon: "fa-snowflake", color: "#bae6fd" },
    80: { description: "Rain Showers", icon: "fa-cloud-showers-heavy", color: "#60a5fa" },
    81: { description: "Moderate Showers", icon: "fa-cloud-showers-heavy", color: "#60a5fa" },
    82: { description: "Heavy Showers", icon: "fa-cloud-showers-heavy", color: "#60a5fa" },
    85: { description: "Snow Showers", icon: "fa-snowflake", color: "#bae6fd" },
    86: { description: "Heavy Snow Showers", icon: "fa-snowflake", color: "#bae6fd" },
    95: { description: "Thunderstorm", icon: "fa-cloud-bolt", color: "#c084fc" },
    96: { description: "Thunderstorm with Hail", icon: "fa-cloud-bolt", color: "#c084fc" },
    99: { description: "Heavy Thunderstorm", icon: "fa-cloud-bolt", color: "#c084fc" }
};

/* ==========================================
   COMMON HELPERS
========================================== */

function getWeatherInfo(code) {
    return weatherCodes[code] || {
        description: "Unknown Weather",
        icon: "fa-cloud",
        color: "#94a3b8"
    };
}

function formatTemperature(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "--";
    }

    const temperature = currentUnit === "F"
        ? Number(value) * 9 / 5 + 32
        : Number(value);

    return `${Math.round(temperature)}°`;
}

function formatDate(dateString) {
    if (!dateString) return "--";

    const parts = dateString.split("T")[0].split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);

    return date.toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long"
    });
}

function formatTime(timeString) {
    if (!timeString) return "--";

    const date = new Date(timeString);

    return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function setHTML(id, value) {
    const element = document.getElementById(id);
    if (element) element.innerHTML = value;
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

/* ==========================================
   LOADING AND ERROR MESSAGES
========================================== */

function showLoading() {
    const main = document.querySelector("main");
    if (!main) return;

    let loader = document.getElementById("weatherLoader");

    if (!loader) {
        loader = document.createElement("div");
        loader.id = "weatherLoader";
        loader.className = "loading";

        loader.innerHTML = `
            <i class="fas fa-spinner fa-spin"></i>
            <span>Fetching weather information...</span>
        `;

        main.prepend(loader);
    }
}

function hideLoading() {
    document.getElementById("weatherLoader")?.remove();
}

function showError(message) {
    let errorBox = document.getElementById("weatherError");

    if (!errorBox) {
        errorBox = document.createElement("div");
        errorBox.id = "weatherError";
        errorBox.className = "error-message";
        document.querySelector("main")?.prepend(errorBox);
    }

    if (errorBox) errorBox.textContent = message;
}

function removeError() {
    document.getElementById("weatherError")?.remove();
}

/* ==========================================
   CITY SEARCH
========================================== */

async function searchCity(city) {
    if (!city || !city.trim()) {
        showError("Please enter a city or state name.");
        return;
    }

    const requestId = ++searchRequestNumber;

    hideSuggestions();
    removeError();
    showLoading();

    try {
        const url =
            `${GEO_URL}?name=${encodeURIComponent(city.trim())}` +
            "&count=5&language=en&format=json";

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Unable to search for this location.");
        }

        const data = await response.json();

        if (!data.results?.length) {
            throw new Error("Location not found. Try another city or state.");
        }

        if (requestId !== searchRequestNumber) return;

        const place = data.results.find(item =>
            item.name.toLowerCase() === city.trim().toLowerCase()
        ) || data.results[0];

        await fetchWeather(
            place.latitude,
            place.longitude,
            place.name,
            place.country || "",
            place.admin1 || ""
        );

        if (requestId === searchRequestNumber) {
            saveRecentSearch(place.name);
        }

    } catch (error) {
        if (requestId === searchRequestNumber) {
            showError(error.message || "Something went wrong.");
        }
    } finally {
        if (requestId === searchRequestNumber) {
            hideLoading();
        }
    }
}

/* ==========================================
   CITY AUTOCOMPLETE
========================================== */

async function getCitySuggestions(query) {
    if (query.length < 2) {
        hideSuggestions();
        return;
    }

    try {
        const url =
            `${GEO_URL}?name=${encodeURIComponent(query)}` +
            "&count=5&language=en&format=json";

        const response = await fetch(url);
        if (!response.ok) return;

        const data = await response.json();

        if (!data.results?.length) {
            hideSuggestions();
            return;
        }

        displaySuggestions(data.results);

    } catch (error) {
        console.error("Suggestion error:", error);
    }
}

function displaySuggestions(results) {
    const container = document.getElementById("suggestions");
    if (!container) return;

    container.innerHTML = "";

    results.forEach(place => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "suggestion-item";

        const icon = document.createElement("i");
        icon.className = "fas fa-location-dot";

        const label = document.createElement("span");
        label.textContent =
            `${place.name}, ${place.admin1 || place.country || ""}`;

        button.append(icon, label);

        button.addEventListener("click", async () => {
            if (searchInput) searchInput.value = place.name;

            hideSuggestions();
            removeError();
            showLoading();

            try {
                await fetchWeather(
                    place.latitude,
                    place.longitude,
                    place.name,
                    place.country || "",
                    place.admin1 || ""
                );

                saveRecentSearch(place.name);

            } catch (error) {
                showError(error.message || "Unable to load this location.");
            } finally {
                hideLoading();
            }
        });

        container.appendChild(button);
    });
}

function hideSuggestions() {
    const container = document.getElementById("suggestions");
    if (container) container.innerHTML = "";
}

/* ==========================================
   FETCH WEATHER DATA
========================================== */

async function fetchWeather(
    latitude,
    longitude,
    cityName,
    country = "",
    region = ""
) {
    const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        timezone: "auto",
        forecast_days: "7",

        current: [
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "is_day",
            "precipitation",
            "weather_code",
            "cloud_cover",
            "pressure_msl",
            "wind_speed_10m",
            "wind_direction_10m"
        ].join(","),

        hourly: [
            "temperature_2m",
            "relative_humidity_2m",
            "precipitation_probability",
            "precipitation",
            "weather_code",
            "wind_speed_10m",
            "is_day"
        ].join(","),

        daily: [
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "sunrise",
            "sunset",
            "uv_index_max",
            "precipitation_probability_max"
        ].join(",")
    });

    const response = await fetch(`${API_URL}?${params}`);

    if (!response.ok) {
        throw new Error("Unable to fetch weather data.");
    }

    const data = await response.json();

    if (!data.current || !data.daily || !data.hourly) {
        throw new Error("Weather information is incomplete.");
    }

    currentWeatherData = data;

    currentLocation = {
        latitude: Number(latitude),
        longitude: Number(longitude),
        cityName,
        country,
        region
    };

    updateWeatherUI(data, cityName, country);

    updateMapFromDashboard(
        latitude,
        longitude,
        cityName,
        country,
        data.current
    );

    checkForecastAlert(data, cityName);
}

/* ==========================================
   UPDATE WEATHER DASHBOARD
========================================== */

function updateWeatherUI(data, cityName, country) {
    updateCurrentWeather(data, cityName, country);
    updateHourlyForecast(data);
    updateDailyForecast(data);
    updateSunriseSunset(data);
    updateWeatherDetails(data);
    updateWeatherInsight(data);

    setText("weatherDate", formatDate(data.current.time));
}

/* ==========================================
   CURRENT WEATHER
========================================== */

function updateCurrentWeather(data, cityName, country) {
    const current = data.current;
    const weather = getWeatherInfo(current.weather_code);

    setText(
        "cityName",
        country ? `${cityName}, ${country}` : cityName
    );

    setText("temperature", formatTemperature(current.temperature_2m));
    setText("feelsLike", formatTemperature(current.apparent_temperature));
    setText("weatherDescription", weather.description);
    setText("humidity", `${current.relative_humidity_2m}%`);
    setText("windSpeed", `${current.wind_speed_10m} km/h`);
    setText("highTemp", formatTemperature(data.daily.temperature_2m_max[0]));
    setText("lowTemp", formatTemperature(data.daily.temperature_2m_min[0]));
    setText("cloudCover", `${current.cloud_cover}%`);

    const icon = document.getElementById("mainWeatherIcon");

    if (icon) {
        icon.className = `fas ${weather.icon}`;
        icon.style.color = weather.color;
    }

    setText("weatherDate", formatDate(current.time));
    setText("weatherUpdated", `Updated at ${formatTime(current.time)}`);
}

/* ==========================================
   HOURLY FORECAST
========================================== */

function updateHourlyForecast(data) {
    const container = document.getElementById("hourlyForecast");
    if (!container) return;

    container.innerHTML = "";

    const hourly = data.hourly;
    const currentTime = new Date(data.current.time);

    let startIndex = hourly.time.findIndex(time =>
        new Date(time) >= currentTime
    );

    if (startIndex < 0) startIndex = 0;

    for (let i = startIndex; i < startIndex + 24; i++) {
        if (i >= hourly.time.length) break;

        const weather = getWeatherInfo(hourly.weather_code[i]);
        const time = new Date(hourly.time[i]);

        const timeLabel = i === startIndex
            ? "Now"
            : time.toLocaleTimeString("en-US", {
                hour: "numeric",
                hour12: true
            });

        const item = document.createElement("div");
        item.className = `hour-item ${i === startIndex ? "active" : ""}`;

        const timeText = document.createElement("p");
        timeText.textContent = timeLabel;

        const icon = document.createElement("i");
        icon.className = `fas ${weather.icon}`;
        icon.style.color = weather.color;

        const temperature = document.createElement("strong");
        temperature.textContent = formatTemperature(hourly.temperature_2m[i]);

        const rain = document.createElement("p");
        rain.style.marginTop = "8px";
        rain.textContent = `${hourly.precipitation_probability[i] ?? 0}% rain`;

        item.append(timeText, icon, temperature, rain);
        container.appendChild(item);
    }
}

/* ==========================================
   UPCOMING 7 DAYS FORECAST
========================================== */

function updateDailyForecast(data) {
    const container = document.getElementById("dailyForecast");

    if (!container || !data.daily) return;

    container.innerHTML = "";

    const daily = data.daily;

    if (!Array.isArray(daily.time) || daily.time.length === 0) {
        container.textContent = "7-day forecast is unavailable.";
        return;
    }

    const totalDays = Math.min(7, daily.time.length);

    for (let i = 0; i < totalDays; i++) {
        const dateParts = daily.time[i].split("-").map(Number);

        const date = new Date(
            dateParts[0],
            dateParts[1] - 1,
            dateParts[2]
        );

        const dayName = i === 0
            ? "Today"
            : date.toLocaleDateString("en-US", {
                weekday: "long"
            });

        const weather = getWeatherInfo(daily.weather_code[i]);

        const card = document.createElement("div");
        card.className = "day-item";

        const day = document.createElement("div");
        day.className = "forecast-day";
        day.textContent = dayName;

        const iconContainer = document.createElement("div");
        iconContainer.className = "forecast-icon";

        const icon = document.createElement("i");
        icon.className = `fas ${weather.icon}`;
        icon.style.color = weather.color;

        iconContainer.appendChild(icon);

        const condition = document.createElement("div");
        condition.className = "forecast-condition";
        condition.textContent = weather.description;

        const temperatures = document.createElement("div");
        temperatures.className = "forecast-temperatures";

        const maxTemp = document.createElement("span");
        maxTemp.className = "max-temp";
        maxTemp.textContent =
            formatTemperature(daily.temperature_2m_max[i]);

        const minTemp = document.createElement("span");
        minTemp.className = "min-temp";
        minTemp.textContent =
            formatTemperature(daily.temperature_2m_min[i]);

        temperatures.append(maxTemp, minTemp);

        const rain = document.createElement("div");
        rain.className = "forecast-rain";

        const rainIcon = document.createElement("i");
        rainIcon.className = "fas fa-droplet";

        rain.append(
            rainIcon,
            document.createTextNode(
                ` ${daily.precipitation_probability_max?.[i] ?? 0}%`
            )
        );

        card.append(
            day,
            iconContainer,
            condition,
            temperatures,
            rain
        );

        container.appendChild(card);
    }
}

/* ==========================================
   SUNRISE AND SUNSET
========================================== */

function updateSunriseSunset(data) {
    const daily = data.daily;

    setText("sunrise", formatTime(daily.sunrise?.[0]));
    setText("sunset", formatTime(daily.sunset?.[0]));

    if (!daily.sunrise?.[0] || !daily.sunset?.[0]) return;

    const sunrise = new Date(daily.sunrise[0]);
    const sunset = new Date(daily.sunset[0]);
    const now = new Date(data.current.time);

    let progress = ((now - sunrise) / (sunset - sunrise)) * 100;
    progress = Math.max(0, Math.min(100, progress));

    const sunCircle = document.getElementById("sunProgress");

    if (sunCircle) {
        sunCircle.style.left = `${progress}%`;
    }
}

/* ==========================================
   ADDITIONAL WEATHER DETAILS
========================================== */

function updateWeatherDetails(data) {
    const current = data.current;
    const daily = data.daily;

    setText("uvIndex", daily.uv_index_max?.[0] ?? "--");
    setText("pressure", `${Math.round(current.pressure_msl)} hPa`);
    setText("precipitation", `${current.precipitation} mm`);
    setText("windDirection", `${current.wind_direction_10m}°`);
    setText("cloudCover", `${current.cloud_cover}%`);

    setText(
        "rainProbability",
        `${daily.precipitation_probability_max?.[0] ?? 0}%`
    );

    setText("humidityDetail", `${current.relative_humidity_2m}%`);
    setText("windDetail", `${current.wind_speed_10m} km/h`);
}

/* ==========================================
   WEATHER INSIGHT
========================================== */

function updateWeatherInsight(data) {
    const current = data.current;
    const weather = getWeatherInfo(current.weather_code);

    let insight = "";

    if (current.weather_code >= 95) {
        insight = "Thunderstorms are indicated. Stay indoors when possible and avoid exposed areas.";
    } else if (current.precipitation > 0) {
        insight = "Rain is currently being reported. Consider carrying an umbrella.";
    } else if (current.wind_speed_10m > 30) {
        insight = "Wind speeds are quite high. Be careful in exposed outdoor areas.";
    } else if (current.temperature_2m >= 35) {
        insight = "It is quite hot outside. Stay hydrated and avoid prolonged exposure to direct sunlight.";
    } else if (current.temperature_2m <= 10) {
        insight = "The weather is cold. Consider wearing warm clothing.";
    } else {
        insight = `Current conditions are ${weather.description.toLowerCase()}. Enjoy your day!`;
    }

    setText("weatherInsight", insight);
}

/* ==========================================
   RAIN ALERT SYSTEM
========================================== */

function checkForecastAlert(data, cityName) {
    const hourly = data.hourly;

    if (!hourly?.time?.length) return;

    const currentTime = new Date(data.current.time);

    let startIndex = hourly.time.findIndex(time =>
        new Date(time) >= currentTime
    );

    if (startIndex < 0) startIndex = 0;

    let maxRainProbability = 0;
    let totalRainfall = 0;
    let thunderstormDetected = false;
    let heavyRainDetected = false;

    for (
        let i = startIndex;
        i < startIndex + 6 && i < hourly.time.length;
        i++
    ) {
        const probability = Number(
            hourly.precipitation_probability?.[i] ?? 0
        );

        const rainfall = Number(hourly.precipitation?.[i] ?? 0);
        const weatherCode = Number(hourly.weather_code?.[i] ?? 0);

        maxRainProbability = Math.max(maxRainProbability, probability);
        totalRainfall += rainfall;

        if (weatherCode >= 95) thunderstormDetected = true;
        if (rainfall >= 15) heavyRainDetected = true;
    }

    let status = "LOW RAIN RISK";
    let message = `No significant rainfall signal is expected in the next six hours around ${cityName}.`;
    let alertClass = "green";
    let alertIcon = "fa-sun";
    let alertType = "low-risk";

    if (
        thunderstormDetected ||
        maxRainProbability >= 85 ||
        heavyRainDetected ||
        totalRainfall >= 15
    ) {
        status = "SEVERE WEATHER SIGNAL";
        message = `A severe weather signal has been detected in the forecast for ${cityName}. Thunderstorms or very heavy rainfall may occur. Check official weather advisories.`;
        alertClass = "red";
        alertIcon = "fa-cloud-bolt";
        alertType = "severe-weather";

    } else if (maxRainProbability >= 65 || totalRainfall >= 7.5) {
        status = "HIGH RAIN RISK";
        message = `Heavy rainfall may occur around ${cityName} within the next six hours. Carry rain protection.`;
        alertClass = "orange";
        alertIcon = "fa-cloud-showers-heavy";
        alertType = "high-rain";

    } else if (maxRainProbability >= 30 || totalRainfall >= 1) {
        status = "MODERATE RAIN RISK";
        message = `Rain is possible around ${cityName} in the next six hours. Consider carrying an umbrella.`;
        alertClass = "yellow";
        alertIcon = "fa-cloud-rain";
        alertType = "moderate-rain";
    }

    setText("forecastAlertStatus", status);
    setText("forecastAlertMessage", message);
    setText("alertRainProbability", `${Math.round(maxRainProbability)}%`);
    setText("alertRainAmount", `${totalRainfall.toFixed(1)} mm`);

    const iconElement = document.getElementById("forecastAlertIcon");

    if (iconElement) {
        iconElement.className = `fas ${alertIcon}`;
    }

    const alertContainer = document.querySelector(".forecast-alert");

    if (alertContainer) {
        alertContainer.classList.remove("green", "yellow", "orange", "red");
        alertContainer.classList.add(alertClass);
    }

    const statusElement = document.getElementById("forecastAlertStatus");

    if (statusElement) {
        statusElement.classList.remove("green", "yellow", "orange", "red");
        statusElement.classList.add(alertClass);
    }

    if (alertClass !== "green") {
        sendBrowserNotification(cityName, message, alertType);
    }
}

/* ==========================================
   CELSIUS / FAHRENHEIT
========================================== */

function setUnit(unit) {
    currentUnit = unit;

    document.getElementById("celsiusBtn")
        ?.classList.toggle("active", unit === "C");

    document.getElementById("fahrenheitBtn")
        ?.classList.toggle("active", unit === "F");

    if (currentWeatherData && currentLocation) {
        updateWeatherUI(
            currentWeatherData,
            currentLocation.cityName,
            currentLocation.country
        );

        updateMapMarker(
            currentLocation.latitude,
            currentLocation.longitude,
            currentLocation.cityName,
            currentWeatherData.current,
            currentLocation.country
        );
    }
}

/* ==========================================
   REVERSE GEOCODING
========================================== */

async function getLocality(latitude, longitude) {
    try {
        const url =
            `${REVERSE_URL}?latitude=${latitude}` +
            `&longitude=${longitude}&localityLanguage=en`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Reverse geocoding failed.");
        }

        const place = await response.json();

        return {
            name:
                place.locality ||
                place.city ||
                place.principalSubdivision ||
                "Your Location",

            region: place.principalSubdivision || "",
            country: place.countryName || ""
        };

    } catch (error) {
        console.error("Locality lookup error:", error);

        return {
            name: "Your Location",
            region: "",
            country: ""
        };
    }
}

/* ==========================================
   DEVICE LOCATION
========================================== */

function getCurrentLocation() {
    if (!navigator.geolocation) {
        showError("Geolocation is not supported by your browser.");
        return;
    }

    removeError();
    showLoading();

    navigator.geolocation.getCurrentPosition(
        async position => {
            try {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;

                const locality = await getLocality(latitude, longitude);

                await fetchWeather(
                    latitude,
                    longitude,
                    locality.name,
                    locality.country,
                    locality.region
                );

                saveRecentSearch(locality.name);

                const input = document.getElementById("cityInput");

                if (input) input.value = locality.name;

            } catch (error) {
                console.error("Location weather error:", error);
                showError("Unable to load weather for your location.");
            } finally {
                hideLoading();
            }
        },

        error => {
            hideLoading();

            const messages = {
                1: "Location permission denied. Allow location access in your browser.",
                2: "Your location is unavailable. Check your device location services.",
                3: "Location request timed out. Please try again."
            };

            showError(messages[error.code] || "Unable to get your location.");
        },

        {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 300000
        }
    );
}

/* ==========================================
   DARK / LIGHT MODE
========================================== */

function toggleTheme() {
    document.body.classList.toggle("light-mode");

    const isLight = document.body.classList.contains("light-mode");

    localStorage.setItem("atmosTheme", isLight ? "light" : "dark");

    const button = document.getElementById("themeBtn");

    if (button) {
        button.innerHTML = isLight
            ? '<i class="fas fa-moon"></i>'
            : '<i class="fas fa-sun"></i>';
    }
}

function loadTheme() {
    const savedTheme = localStorage.getItem("atmosTheme");

    if (savedTheme === "light") {
        document.body.classList.add("light-mode");

        const button = document.getElementById("themeBtn");

        if (button) {
            button.innerHTML = '<i class="fas fa-moon"></i>';
        }
    }
}

/* ==========================================
   RECENT SEARCHES
========================================== */

function saveRecentSearch(city) {
    try {
        let searches = JSON.parse(
            localStorage.getItem("atmosRecentSearches") || "[]"
        );

        searches = searches.filter(
            item => item.toLowerCase() !== city.toLowerCase()
        );

        searches.unshift(city);
        searches = searches.slice(0, 5);

        localStorage.setItem(
            "atmosRecentSearches",
            JSON.stringify(searches)
        );

        displayRecentSearches();

    } catch (error) {
        console.error("Unable to save recent searches:", error);
    }
}

function displayRecentSearches() {
    const container = document.getElementById("recentSearches");
    if (!container) return;

    let searches = [];

    try {
        searches = JSON.parse(
            localStorage.getItem("atmosRecentSearches") || "[]"
        );
    } catch (error) {
        searches = [];
    }

    container.innerHTML = "";

    searches.forEach(city => {
        const button = document.createElement("button");
        button.textContent = city;

        button.addEventListener("click", () => {
            const input = document.getElementById("cityInput");

            if (input) input.value = city;

            searchCity(city);
        });

        container.appendChild(button);
    });
}

/* ==========================================
   INTERACTIVE MAP
========================================== */

function initializeAetherMap() {
    const mapElement = document.getElementById("aetherWeatherMap");

    if (!mapElement) return;

    if (typeof L === "undefined") {
        console.error("Leaflet is not loaded.");
        return;
    }

    if (aetherMap) return;

    aetherMap = L.map("aetherWeatherMap").setView(
        [20.2961, 85.8245],
        6
    );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }
    ).addTo(aetherMap);

    aetherMap.on("click", async event => {
        const { lat, lng } = event.latlng;

        removeError();
        showLoading();

        try {
            const locality = await getLocality(lat, lng);

            await fetchWeather(
                lat,
                lng,
                locality.name,
                locality.country,
                locality.region
            );

            const input = document.getElementById("cityInput");

            if (input) input.value = locality.name;

            saveRecentSearch(locality.name);

        } catch (error) {
            showError("Unable to load weather for the selected map location.");
        } finally {
            hideLoading();
        }
    });

    setTimeout(() => aetherMap.invalidateSize(), 300);
}

/* ==========================================
   UPDATE MAP
========================================== */

function updateMapFromDashboard(
    latitude,
    longitude,
    cityName,
    country,
    currentWeather
) {
    if (!aetherMap) return;

    aetherMap.flyTo(
        [latitude, longitude],
        10,
        { animate: true, duration: 1 }
    );

    if (currentWeather) {
        updateMapMarker(
            latitude,
            longitude,
            cityName,
            currentWeather,
            country
        );
    }
}

/* ==========================================
   MAP MARKER
========================================== */

function updateMapMarker(
    latitude,
    longitude,
    cityName,
    current,
    country = ""
) {
    if (!aetherMap || !current) return;

    const weather = getWeatherInfo(current.weather_code);

    const placeName = country
        ? `${cityName}, ${country}`
        : cityName;

    const temperature = formatTemperature(current.temperature_2m);

    const popupContent = `
        <div class="aether-map-popup">
            <strong>${escapeHTML(placeName)}</strong>

            <div style="font-size:22px;font-weight:700;margin-top:5px">
                ${temperature}
            </div>

            <div>${escapeHTML(weather.description)}</div>

            <small>Humidity: ${current.relative_humidity_2m}%</small>
            <br>
            <small>Wind: ${current.wind_speed_10m} km/h</small>
        </div>
    `;

    if (!aetherMarker) {
        aetherMarker = L.marker([latitude, longitude]).addTo(aetherMap);
    } else {
        aetherMarker.setLatLng([latitude, longitude]);
    }

    aetherMarker.bindPopup(popupContent).openPopup();

    setText("mapPlaceName", placeName);

    setText(
        "mapPlaceDescription",
        `${Number(latitude).toFixed(3)}, ${Number(longitude).toFixed(3)}`
    );

    setText("mapTemperature", temperature);
    setText("mapCondition", weather.description);
    setText("mapHumidity", `${current.relative_humidity_2m}%`);
    setText("mapWind", `${current.wind_speed_10m} km/h`);
    setText("mapFeelsLike", formatTemperature(current.apparent_temperature));

    const icon = document.getElementById("mapWeatherIcon");

    if (icon) {
        icon.className = `fa-solid ${weather.icon}`;
    }

    setText(
        "mapUpdated",
        `Updated ${new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        })}`
    );
}

/* ==========================================
   BROWSER NOTIFICATIONS
========================================== */

async function enableNotifications() {
    if (!("Notification" in window)) {
        setText(
            "notificationStatus",
            "Your browser does not support notifications."
        );
        return;
    }

    try {
        const permission = await Notification.requestPermission();

        if (permission === "granted") {
            aetherNotificationsEnabled = true;

            setText(
                "notificationStatus",
                "Notifications enabled. Keep AETHER open for forecast updates."
            );

            const button = document.getElementById("enableNotifications");

            if (button) {
                button.textContent = "Notifications Enabled";
            }

        } else {
            setText(
                "notificationStatus",
                "Permission not granted. Enable notifications in browser settings."
            );
        }

    } catch (error) {
        console.error("Notification permission error:", error);
    }
}

function sendBrowserNotification(placeName, message, type) {
    if (
        !aetherNotificationsEnabled ||
        !("Notification" in window) ||
        Notification.permission !== "granted"
    ) {
        return;
    }

    const alertKey =
        `${placeName}-${type}-${new Date().toDateString()}`;

    if (aetherLastNotification === alertKey) return;

    aetherLastNotification = alertKey;

    const notification = new Notification(
        `AETHER Weather Heads-up: ${placeName}`,
        {
            body: message,
            tag: alertKey
        }
    );

    notification.onclick = () => {
        window.focus();
        notification.close();
    };
}

/* ==========================================
   RAINVIEWER RADAR
========================================== */

async function toggleRadar() {
    const button = document.getElementById("radarToggle");

    if (!aetherMap || !button) return;

    if (aetherRadarLayer) {
        aetherMap.removeLayer(aetherRadarLayer);
        aetherRadarLayer = null;

        button.innerHTML =
            '<i class="fa-solid fa-cloud-rain"></i> Recent Radar';

        return;
    }

    try {
        button.textContent = "Loading radar...";

        const response = await fetch(
            "https://api.rainviewer.com/public/weather-maps.json"
        );

        if (!response.ok) {
            throw new Error("Radar data is unavailable.");
        }

        const data = await response.json();
        const frames = data.radar?.past || [];

        if (!frames.length) {
            throw new Error("No recent radar frame is available.");
        }

        const latestFrame = frames[frames.length - 1];

        const tileURL =
            `${data.host}${latestFrame.path}` +
            "/256/{z}/{x}/{y}/2/1_1.png";

        aetherRadarLayer = L.tileLayer(tileURL, {
            opacity: 0.65,
            maxNativeZoom: 7,
            maxZoom: 12,
            attribution: "Radar © RainViewer"
        });

        aetherRadarLayer.addTo(aetherMap);

        button.innerHTML =
            '<i class="fa-solid fa-eye-slash"></i> Hide Radar';

    } catch (error) {
        console.error("Radar error:", error);
        alert(error.message || "Unable to load radar.");

        button.innerHTML =
            '<i class="fa-solid fa-cloud-rain"></i> Recent Radar';
    }
}

/* ==========================================
   MAP GPS BUTTON
========================================== */

function useMapLocation() {
    getCurrentLocation();
}

/* ==========================================
   EVENT LISTENERS
========================================== */

function initializeEventListeners() {
    const searchInput = document.getElementById("cityInput");
    const searchButton = document.getElementById("searchBtn");

    searchButton?.addEventListener("click", () => {
        searchCity(searchInput?.value || "");
    });

    searchInput?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchCity(searchInput.value);
        }

        if (event.key === "Escape") {
            hideSuggestions();
        }
    });

    searchInput?.addEventListener("input", () => {
        clearTimeout(suggestionTimer);

        suggestionTimer = setTimeout(() => {
            getCitySuggestions(searchInput.value.trim());
        }, 350);
    });

    document.addEventListener("click", event => {
        const suggestions = document.getElementById("suggestions");

        if (
            suggestions &&
            searchInput &&
            !suggestions.contains(event.target) &&
            event.target !== searchInput
        ) {
            hideSuggestions();
        }
    });

    document
        .getElementById("locationBtn")
        ?.addEventListener("click", getCurrentLocation);

    document
        .getElementById("mapMyLocation")
        ?.addEventListener("click", useMapLocation);

    document
        .getElementById("themeBtn")
        ?.addEventListener("click", toggleTheme);

    document
        .getElementById("celsiusBtn")
        ?.addEventListener("click", () => setUnit("C"));

    document
        .getElementById("fahrenheitBtn")
        ?.addEventListener("click", () => setUnit("F"));

    document
        .getElementById("radarToggle")
        ?.addEventListener("click", toggleRadar);

    document
        .getElementById("enableNotifications")
        ?.addEventListener("click", enableNotifications);
}

/* ==========================================
   INITIALIZE AETHER
========================================== */

async function initializeAtmos() {
    loadTheme();
    displayRecentSearches();
    initializeEventListeners();
    initializeAetherMap();

    try {
        await fetchWeather(
            20.2961,
            85.8245,
            "Bhubaneswar",
            "India",
            "Odisha"
        );

    } catch (error) {
        console.error("Initial weather error:", error);

        showError(
            "Unable to load weather. Please check your internet connection."
        );
    }
}

document.addEventListener("DOMContentLoaded", initializeAtmos);

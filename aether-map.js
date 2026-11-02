
/* ==========================================
   AETHER — INTERACTIVE WEATHER MAP
   Map + Live Weather + Radar + Notifications
========================================== */

(() => {
    "use strict";

    // ==========================================
    // API ENDPOINTS
    // ==========================================

    const WEATHER_API =
        "https://api.open-meteo.com/v1/forecast";

    const REVERSE_API =
        "https://api.bigdatacloud.net/data/reverse-geocode-client";

    const RADAR_API =
        "https://api.rainviewer.com/public/weather-maps.json";

    const $ = id => document.getElementById(id);

    // ==========================================
    // MAP VARIABLES
    // ==========================================

    let map = null;
    let marker = null;
    let radarLayer = null;

    let notificationsEnabled = false;
    let lastNotification = "";

    let requestNumber = 0;
    let currentLocation = null;

    // ==========================================
    // WEATHER CONDITIONS
    // ==========================================

    const weatherCodes = {
        0: ["Clear sky", "fa-sun"],
        1: ["Mainly clear", "fa-sun"],
        2: ["Partly cloudy", "fa-cloud-sun"],
        3: ["Overcast", "fa-cloud"],
        45: ["Fog", "fa-smog"],
        48: ["Rime fog", "fa-smog"],
        51: ["Light drizzle", "fa-cloud-rain"],
        53: ["Drizzle", "fa-cloud-rain"],
        55: ["Heavy drizzle", "fa-cloud-showers-heavy"],
        56: ["Freezing drizzle", "fa-cloud-rain"],
        57: ["Heavy freezing drizzle", "fa-cloud-rain"],
        61: ["Light rain", "fa-cloud-rain"],
        63: ["Moderate rain", "fa-cloud-rain"],
        65: ["Heavy rain", "fa-cloud-showers-heavy"],
        66: ["Freezing rain", "fa-cloud-rain"],
        67: ["Heavy freezing rain", "fa-cloud-rain"],
        71: ["Light snow", "fa-snowflake"],
        73: ["Snow", "fa-snowflake"],
        75: ["Heavy snow", "fa-snowflake"],
        77: ["Snow grains", "fa-snowflake"],
        80: ["Rain showers", "fa-cloud-rain"],
        81: ["Moderate showers", "fa-cloud-showers-heavy"],
        82: ["Heavy showers", "fa-cloud-showers-heavy"],
        85: ["Snow showers", "fa-snowflake"],
        86: ["Heavy snow showers", "fa-snowflake"],
        95: ["Thunderstorm", "fa-cloud-bolt"],
        96: ["Thunderstorm with hail", "fa-cloud-bolt"],
        99: ["Severe thunderstorm", "fa-cloud-bolt"]
    };

    function getWeather(code) {
        return weatherCodes[code] ||
            ["Variable conditions", "fa-cloud"];
    }

    // ==========================================
    // HTML HELPERS
    // ==========================================

    function updateText(id, value) {
        const element = $(id);

        if (element) {
            element.textContent = value;
        }
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    function setButtonLoading(button, loading, normalHTML) {
        if (!button) return;

        button.disabled = loading;
        button.innerHTML = loading
            ? "Loading..."
            : normalHTML;
    }

    // ==========================================
    // REVERSE GEOCODING
    // ==========================================

    async function getPlaceName(lat, lon) {
        try {
            const params = new URLSearchParams({
                latitude: lat,
                longitude: lon,
                localityLanguage: "en"
            });

            const response = await fetch(
                `${REVERSE_API}?${params}`
            );

            if (!response.ok) {
                throw new Error("Location unavailable");
            }

            const data = await response.json();

            const locality =
                data.locality ||
                data.city ||
                data.localityInfo?.administrative?.[0]?.name ||
                data.principalSubdivision ||
                data.countryName;

            return locality || "Selected location";

        } catch (error) {
            console.warn("Reverse geocoding:", error);
            return "Selected location";
        }
    }

    // ==========================================
    // LOAD WEATHER
    // ==========================================

    async function loadWeather(lat, lon, knownName = "") {

        if (!Number.isFinite(Number(lat)) ||
            !Number.isFinite(Number(lon))) {
            return;
        }

        const latitude = Number(lat);
        const longitude = Number(lon);

        const currentRequest = ++requestNumber;

        updateText("forecastAlertMessage", "Fetching weather information...");
        updateText("forecastAlertStatus", "Loading forecast...");

        const params = new URLSearchParams({
            latitude,
            longitude,
            timezone: "auto",
            forecast_days: "1",

            current: [
                "temperature_2m",
                "relative_humidity_2m",
                "apparent_temperature",
                "precipitation",
                "weather_code",
                "wind_speed_10m"
            ].join(","),

            hourly: [
                "precipitation_probability"
            ].join(",")
        });

        try {
            const response = await fetch(
                `${WEATHER_API}?${params}`
            );

            if (!response.ok) {
                throw new Error("Weather service unavailable.");
            }

            const data = await response.json();

            if (currentRequest !== requestNumber) return;

            if (!data.current) {
                throw new Error("Weather data is unavailable.");
            }

            const current = data.current;

            const placeName = knownName ||
                await getPlaceName(latitude, longitude);

            if (currentRequest !== requestNumber) return;

            currentLocation = {
                name: placeName,
                latitude,
                longitude
            };

            const weather = getWeather(current.weather_code);

            // Find current hour's rain probability
            const currentHour = String(current.time).slice(0, 13);

            const hourIndex = data.hourly.time.findIndex(
                time => String(time).slice(0, 13) === currentHour
            );

            const rainProbability = hourIndex >= 0
                ? data.hourly.precipitation_probability[hourIndex] ?? 0
                : 0;

            // Update marker
            updateMarker(
                latitude,
                longitude,
                placeName,
                current.temperature_2m,
                weather[0]
            );

            // Update weather alerts
            checkWeatherAlerts({
                name: placeName,
                code: current.weather_code,
                wind: current.wind_speed_10m,
                rain: rainProbability
            });

            // Save selected location for other scripts
            window.aetherMapLocation = currentLocation;

            console.log(
                "AETHER map weather updated:",
                placeName
            );

        } catch (error) {

            if (currentRequest !== requestNumber) return;

            console.error("AETHER map weather error:", error);

            updateText(
                "forecastAlertMessage",
                error.message || "Could not load weather."
            );

            updateText(
                "forecastAlertStatus",
                "Weather unavailable"
            );
        }
    }

    // ==========================================
    // UPDATE MAP MARKER
    // ==========================================

    function updateMarker(lat, lon, placeName, temp, condition) {

        if (!map) return;

        const popupHTML = `
            <div class="aether-map-popup">
                <strong>${escapeHTML(placeName)}</strong>
                <br>
                ${Math.round(temp)}°C
                · ${escapeHTML(condition)}
            </div>
        `;

        if (marker) {

            marker.setLatLng([lat, lon]);

            marker.setPopupContent(popupHTML);

        } else {

            marker = L.marker([lat, lon])
                .addTo(map)
                .bindPopup(popupHTML);
        }

        marker.openPopup();

        // Move map to selected location
        map.flyTo([lat, lon], 10, {
            animate: true,
            duration: 1.2
        });
    }

    // ==========================================
    // WEATHER ALERT CENTRE
    // ==========================================

    function checkWeatherAlerts(weather) {

        let message =
            "No selected forecast trigger detected for thunderstorms, strong winds or high rain probability. This is not a safety guarantee.";

        let status = "No forecast trigger detected";
        let alertType = "";

        if ([95, 96, 99].includes(weather.code)) {

            message =
                `Thunderstorm conditions appear in the forecast near ${weather.name}. Avoid exposed outdoor areas and follow official advice.`;

            status = "Thunderstorm in forecast";
            alertType = "thunderstorm";

        } else if (weather.wind >= 50) {

            message =
                `Strong winds are indicated in the forecast near ${weather.name}. Check official local weather advisories.`;

            status = "Strong wind forecast signal";
            alertType = "wind";

        } else if (weather.rain >= 70) {

            message =
                `High rainfall probability is indicated near ${weather.name}. Carry rain protection and monitor official updates.`;

            status = "High rain probability";
            alertType = "rain";
        }

        updateText("forecastAlertMessage", message);
        updateText("forecastAlertStatus", status);

        const statusElement = $("forecastAlertStatus");

        if (statusElement) {
            statusElement.classList.remove(
                "green",
                "yellow",
                "orange",
                "red"
            );

            if (alertType === "thunderstorm") {
                statusElement.classList.add("red");
            } else if (alertType === "wind") {
                statusElement.classList.add("orange");
            } else if (alertType === "rain") {
                statusElement.classList.add("yellow");
            } else {
                statusElement.classList.add("green");
            }
        }

        if (alertType) {
            sendNotification(
                weather.name,
                message,
                alertType
            );
        }
    }

    // ==========================================
    // BROWSER NOTIFICATIONS
    // ==========================================

    function sendNotification(name, message, type) {

        if (!notificationsEnabled) return;

        if (!("Notification" in window)) return;

        if (Notification.permission !== "granted") return;

        const key =
            `${name}-${type}-${new Date().toDateString()}`;

        if (lastNotification === key) return;

        lastNotification = key;

        const notification = new Notification(
            `AETHER Weather Alert — ${name}`,
            {
                body: message,
                tag: key
            }
        );

        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }

    async function enableNotifications() {

        if (!("Notification" in window)) {

            updateText(
                "notificationStatus",
                "Your browser does not support notifications."
            );

            return;
        }

        try {

            const permission =
                await Notification.requestPermission();

            if (permission === "granted") {

                notificationsEnabled = true;

                updateText(
                    "notificationStatus",
                    "Notifications enabled. Keep AETHER open."
                );

                const button = $("enableNotifications");

                if (button) {
                    button.textContent = "Notifications Enabled";
                    button.disabled = true;
                }

            } else {

                updateText(
                    "notificationStatus",
                    "Notification permission was not granted."
                );
            }

        } catch (error) {

            console.error("Notification error:", error);

            updateText(
                "notificationStatus",
                "Could not enable notifications."
            );
        }
    }

    // ==========================================
    // DEVICE LOCATION
    // ==========================================

    function locateMe() {

        if (!navigator.geolocation) {

            updateText(
                "forecastAlertMessage",
                "Your browser does not support location services."
            );

            return;
        }

        const button = $("mapMyLocation");

        setButtonLoading(
            button,
            true,
            '<i class="fa-solid fa-location-crosshairs"></i> My Location'
        );

        navigator.geolocation.getCurrentPosition(

            async position => {

                const lat = position.coords.latitude;
                const lon = position.coords.longitude;

                const placeName = await getPlaceName(lat, lon);

                await loadWeather(lat, lon, placeName);

                setButtonLoading(
                    button,
                    false,
                    '<i class="fa-solid fa-location-crosshairs"></i> My Location'
                );
            },

            error => {

                let message = "Unable to detect your location.";

                if (error.code === 1) {
                    message = "Location permission denied. Allow location access in browser settings.";
                } else if (error.code === 2) {
                    message = "Your location is unavailable.";
                } else if (error.code === 3) {
                    message = "Location request timed out. Please try again.";
                }

                updateText("forecastAlertMessage", message);
                updateText("forecastAlertStatus", "Location unavailable");

                setButtonLoading(
                    button,
                    false,
                    '<i class="fa-solid fa-location-crosshairs"></i> My Location'
                );
            },

            {
                enableHighAccuracy: true,
                timeout: 18000,
                maximumAge: 300000
            }
        );
    }

    // ==========================================
    // RECENT RAINVIEWER RADAR
    // ==========================================

    async function toggleRadar() {

        const button = $("radarToggle");

        if (!map || !button) return;

        if (radarLayer) {

            map.removeLayer(radarLayer);
            radarLayer = null;

            button.innerHTML =
                '<i class="fa-solid fa-cloud-rain"></i> Recent Radar';

            return;
        }

        button.disabled = true;
        button.textContent = "Loading radar...";

        try {

            const response = await fetch(RADAR_API);

            if (!response.ok) {
                throw new Error("Radar service unavailable.");
            }

            const data = await response.json();

            const frames = data.radar?.past || [];

            if (!frames.length) {
                throw new Error("No recent radar frame available.");
            }

            const latestFrame = frames[frames.length - 1];

            const radarURL =
                `${data.host}${latestFrame.path}/256/{z}/{x}/{y}/2/1_1.png`;

            radarLayer = L.tileLayer(radarURL, {
                opacity: 0.65,
                maxNativeZoom: 7,
                maxZoom: 12,
                attribution: "Radar © RainViewer"
            }).addTo(map);

            button.innerHTML =
                '<i class="fa-solid fa-eye-slash"></i> Hide Radar';

        } catch (error) {

            console.error("Radar error:", error);

            updateText(
                "forecastAlertMessage",
                error.message || "Unable to load radar."
            );

        } finally {

            button.disabled = false;

            if (!radarLayer) {
                button.innerHTML =
                    '<i class="fa-solid fa-cloud-rain"></i> Recent Radar';
            }
        }
    }

    // ==========================================
    // CONNECT TOP AETHER SEARCH TO MAP
    // ==========================================

    // The main script dispatches this event after
    // successfully loading a searched location.

    window.addEventListener("aether:locationchange", event => {

        const place = event.detail;

        if (!place) return;

        const lat = Number(place.latitude);
        const lon = Number(place.longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return;
        }

        loadWeather(
            lat,
            lon,
            [
                place.name,
                place.admin1,
                place.country
            ].filter(Boolean).join(", ")
        );
    });

    // ==========================================
    // CONNECT TEMPERATURE UNIT TO MAIN WEBSITE
    // ==========================================

    window.addEventListener("aether:unitchange", event => {

        const unit = event.detail?.unit;

        if (unit === "F" || unit === "C") {
            // Map popup temperature remains in Celsius
            // unless you choose to add a separate popup conversion.
            console.log("AETHER temperature unit:", unit);
        }
    });

    // ==========================================
    // INITIALIZE MAP
    // ==========================================

    function initializeMap() {

        const mapContainer = $("aetherWeatherMap");

        if (!mapContainer) {
            console.error("AETHER map container not found.");
            return;
        }

        if (!window.L) {
            console.error("Leaflet library not loaded.");
            return;
        }

        if (map !== null) return;

        // Default view: Odisha
        map = L.map("aetherWeatherMap", {
            zoomControl: true
        }).setView([20.2961, 85.8245], 7);

        // OpenStreetMap tiles
        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution:
                    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }
        ).addTo(map);

        // Click anywhere to load weather
        map.on("click", async event => {

            const lat = event.latlng.lat;
            const lon = event.latlng.lng;

            await loadWeather(lat, lon);
        });

        // Device location
        const locationButton = $("mapMyLocation");

        if (locationButton) {
            locationButton.addEventListener("click", locateMe);
        }

        // Radar
        const radarButton = $("radarToggle");

        if (radarButton) {
            radarButton.addEventListener("click", toggleRadar);
        }

        // Notifications
        const notificationButton = $("enableNotifications");

        if (notificationButton) {
            notificationButton.addEventListener(
                "click",
                enableNotifications
            );
        }

        // Initial weather
        loadWeather(
            20.2961,
            85.8245,
            "Bhubaneswar, Odisha, India"
        );

        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 400);

        console.log(
            "AETHER interactive map initialized successfully."
        );
    }

    // ==========================================
    // START APPLICATION
    // ==========================================

    if (document.readyState === "loading") {

        document.addEventListener(
            "DOMContentLoaded",
            initializeMap,
            { once: true }
        );

    } else {

        initializeMap();
    }

})();

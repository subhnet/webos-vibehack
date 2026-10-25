#!/usr/bin/env python3
"""Serve weather data from Open-Meteo on http://0.0.0.0:9999/weather.

The launcher fetches this endpoint every 15 minutes.
Open-Meteo is completely free and requires no API key.

Usage (run alongside home-watch.py):
    python weather-proxy.py                          # uses lat/lon from WEATHER_LAT / WEATHER_LON env vars
    python weather-proxy.py 19.076 72.877            # explicit lat lon
"""
import json
import os
import sys
import time
import threading
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DEFAULT_LAT = float(sys.argv[1]) if len(sys.argv) > 1 else float(os.environ.get("WEATHER_LAT", 19.076))
DEFAULT_LON = float(sys.argv[2]) if len(sys.argv) > 2 else float(os.environ.get("WEATHER_LON", 72.877))
PORT = int(os.environ.get("WEATHER_PORT", 9999))
CACHE_TTL = 900   # seconds (15 min)

# WMO weather-code → emoji
WMO = {
    0: "☀️",  1: "🌤️",  2: "⛅",  3: "☁️",
    45: "🌫️", 48: "🌫️",
    51: "🌦️", 53: "🌦️", 55: "🌦️",
    61: "🌧️", 63: "🌧️", 65: "🌧️",
    71: "❄️",  73: "❄️",  75: "❄️",  77: "❄️",
    80: "🌦️", 81: "🌦️", 82: "⛈️",
    85: "❄️",  86: "❄️",
    95: "⛈️", 96: "⛈️", 99: "⛈️",
}

# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------
_cache = {}
_lock = threading.Lock()


def fetch_weather(lat, lon):
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&current=temperature_2m,weathercode&timezone=auto"
    )
    try:
        raw = urllib.request.urlopen(url, timeout=10).read()
        r = json.loads(raw)
        cur = r["current"]
        code = int(cur.get("weathercode", 0))
        return {
            "temp": round(cur["temperature_2m"]),
            "unit": r["current_units"]["temperature_2m"],
            "code": code,
            "icon": WMO.get(code, "🌡️"),
        }
    except Exception as e:
        print(f"weather fetch error: {e}")
        return None


def get_weather(lat, lon):
    key = (lat, lon)
    with _lock:
        now = time.time()
        cached = _cache.get(key)
        if cached is None or now - cached["ts"] > CACHE_TTL:
            data = fetch_weather(lat, lon)
            if data:
                cached = {"data": data, "ts": now}
                _cache[key] = cached
        return cached["data"] if cached else None


def weather_coordinates(path):
    """Return validated coordinates, with environment/CLI values as a fallback."""
    query = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    lat_text = query.get("lat", [None])[0]
    lon_text = query.get("lon", [None])[0]
    if lat_text is None and lon_text is None:
        return DEFAULT_LAT, DEFAULT_LON
    if lat_text is None or lon_text is None:
        return None
    try:
        lat, lon = float(lat_text), float(lon_text)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass   # suppress access log noise

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path != "/weather":
            self.send_response(404)
            self.end_headers()
            return
        coordinates = weather_coordinates(self.path)
        if coordinates is None:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"valid lat and lon are required"}')
            return
        data = get_weather(*coordinates)
        if data is None:
            self.send_response(503)
            self.end_headers()
            return
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()


if __name__ == "__main__":
    print(f"Weather proxy on http://0.0.0.0:{PORT}/weather  (default lat={DEFAULT_LAT}, lon={DEFAULT_LON})")
    # Pre-warm the cache
    threading.Thread(target=get_weather, args=(DEFAULT_LAT, DEFAULT_LON), daemon=True).start()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

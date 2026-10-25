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
from http.server import BaseHTTPRequestHandler, HTTPServer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
LAT = float(sys.argv[1]) if len(sys.argv) > 1 else float(os.environ.get("WEATHER_LAT", 19.076))
LON = float(sys.argv[2]) if len(sys.argv) > 2 else float(os.environ.get("WEATHER_LON", 72.877))
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
_cache = {"data": None, "ts": 0}
_lock = threading.Lock()


def fetch_weather():
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={LAT}&longitude={LON}"
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


def get_weather():
    with _lock:
        now = time.time()
        if _cache["data"] is None or now - _cache["ts"] > CACHE_TTL:
            data = fetch_weather()
            if data:
                _cache["data"] = data
                _cache["ts"] = now
        return _cache["data"]


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass   # suppress access log noise

    def do_GET(self):
        if self.path != "/weather":
            self.send_response(404)
            self.end_headers()
            return
        data = get_weather()
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
    print(f"Weather proxy on http://0.0.0.0:{PORT}/weather  (lat={LAT}, lon={LON})")
    # Pre-warm the cache
    threading.Thread(target=get_weather, daemon=True).start()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

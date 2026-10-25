#!/usr/bin/env python3
"""Make the Home button open the launcher instead of LG's home.

webOS does not let an app replace Home, or even see which app is in front, so this runs on
another always-on device on the same network (a Mac, a Raspberry Pi, a phone in Termux). It
watches the foreground app over the TV's remote-control service and, the moment LG's home
appears, launches the launcher on top. LG's home shows for about half a second.

Press Home twice within ESCAPE_SECONDS to stay on LG's home (for its menus).

    python3 home-watch.py 192.168.1.50

Also runs:
  - A notification WebSocket server on port 9998 (send toasts to the launcher).
  - Media-app tracking that pushes a 'Now Playing' event when you return to the launcher.

Needs: pip install websockets. Pair once first (sync-apps.py does it).
"""
import asyncio
import json
import os
import sys
import time

import lgtv

LAUNCHER = "com.gathin.tvhome"
LG_HOME = "com.webos.app.home"
ESCAPE_SECONDS = 3.0
NOTIFICATION_PORT = int(os.environ.get("NOTIFICATION_PORT", 9998))

# Known streaming/media apps: id → display name
MEDIA_APPS = {
    "netflix": "Netflix",
    "amazon": "Prime Video",
    "youtube.leanback.v4": "YouTube",
    "hotstar": "JioHotstar",
    "com.apple.appletv": "Apple TV",
    "com.apple.applemusic": "Apple Music",
    "org.jellyfin.webos": "Jellyfin",
    "com.webos.app.mediadiscovery": "Media Player",
}

# ---- notification WebSocket server ---------------------------------------------------------

_notification_clients: set = set()


async def _notification_handler(websocket):
    _notification_clients.add(websocket)
    try:
        # Clients such as notify.py send a message; relay it to every other connected client
        # (the launcher). The launcher itself only listens.
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if isinstance(msg, dict):
                await broadcast(msg, exclude=websocket)
    except Exception:
        pass
    finally:
        _notification_clients.discard(websocket)


async def broadcast(payload: dict, exclude=None) -> None:
    clients = [c for c in list(_notification_clients) if c is not exclude]
    if not clients:
        return
    msg = json.dumps(payload)
    await asyncio.gather(
        *[c.send(msg) for c in clients],
        return_exceptions=True,
    )


LOG_FILE = os.environ.get("HOME_WATCH_LOG")
if not LOG_FILE and sys.platform == "win32":
    local_app_data = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    LOG_FILE = os.path.join(local_app_data, "tv-vibehack-home-watch.log")


def log(*args):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(a) for a in args)
    if sys.stdout is not None:
        try:
            print(line, flush=True)
        except OSError:
            pass
    if LOG_FILE:
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass


async def watch(host):
    ws = await lgtv.session(host, ping_interval=10, ping_timeout=10)
    log("connected to", host)
    last_redirect = 0.0
    last_media_app = None   # track the most recent streaming app in foreground
    try:
        await ws.send(json.dumps({"type": "subscribe", "id": "fg",
                                  "uri": "ssap://com.webos.applicationManager/getForegroundAppInfo",
                                  "payload": {}}))
        async for raw in ws:
            msg = json.loads(raw)
            if msg.get("id") != "fg":
                continue
            app = msg.get("payload", {}).get("appId", "")

            # Media-app tracking: when user returns to the launcher, push a media event.
            if app in MEDIA_APPS:
                last_media_app = app
            elif app == LAUNCHER and last_media_app:
                await broadcast({"type": "media",
                                 "appId": last_media_app,
                                 "title": MEDIA_APPS.get(last_media_app, last_media_app)})
                log("media event: last playing app was", last_media_app)

            if app != LG_HOME:
                continue
            now = time.monotonic()
            if now - last_redirect < ESCAPE_SECONDS:
                log("Home pressed twice: staying on LG home")
                last_redirect = 0.0
                continue
            last_redirect = now
            await ws.send(json.dumps({"type": "request", "id": "launch", "uri": "ssap://system.launcher/launch",
                                      "payload": {"id": LAUNCHER}}))
            log("LG home -> launcher")
    finally:
        await ws.close()


async def _run_watch(host):
    delay = 5
    while True:
        try:
            await watch(host)
            delay = 5
        except Exception as e:
            # TV off, in standby or off the network: keep trying, but back off.
            log("not connected or error:", type(e).__name__, e)
            delay = min(delay * 2, 20)
        await asyncio.sleep(delay)


async def main(host):
    import websockets as _ws
    async with _ws.serve(_notification_handler, "0.0.0.0", NOTIFICATION_PORT):
        log(f"notification server on ws://0.0.0.0:{NOTIFICATION_PORT}")
        await _run_watch(host)


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TV_HOST")
    if not host:
        sys.exit("usage: home-watch.py <TV IP>")
    try:
        asyncio.run(main(host))
    except KeyboardInterrupt:
        pass
    except Exception as e:
        import traceback
        log("fatal error:", traceback.format_exc())

#!/usr/bin/env python3
"""Send a toast notification to the launcher running on the TV.

Usage:
    python notify.py "Hello from PC 👋"
    TV_COMPANION_HOST=localhost python notify.py "Dinner is ready!"

The notification WebSocket server is embedded in home-watch.py (port 9998).
"""
import asyncio
import json
import os
import sys

HOST = os.environ.get("TV_COMPANION_HOST", "localhost")
PORT = int(os.environ.get("TV_COMPANION_PORT", 9998))


async def main(text: str) -> None:
    try:
        import websockets
    except ImportError:
        sys.exit("websockets not installed: pip install websockets")

    url = f"ws://{HOST}:{PORT}"
    try:
        async with websockets.connect(url, open_timeout=5) as ws:
            await ws.send(json.dumps({"type": "notify", "text": text}))
            print(f"Sent: {text!r}")
    except Exception as e:
        sys.exit(f"Could not connect to {url}: {e}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: notify.py <message>")
    asyncio.run(main(sys.argv[1]))

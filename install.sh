#!/usr/bin/env bash
# Sync the TV's apps, package the launcher and install it on an LG TV in Developer Mode.
#   TV_HOST=192.168.1.50 ./install.sh
# One-time setup (Developer Mode app open on the TV, Key Server on):
#   ares-setup-device -a lgtv -i "{'host':'$TV_HOST','port':'9922','username':'prisoner'}"
#   ares-novacom --device lgtv --getkey          # enter the passphrase shown on the TV
#   ares-setup-device -m lgtv -i "{'privatekey':'lgtv_webos','passphrase':'<passphrase>'}"
set -euo pipefail
cd "$(dirname "$0")"
: "${TV_HOST:?set TV_HOST to the TV IP address, e.g. TV_HOST=192.168.1.50 $0}"
DEVICE="${DEVICE:-lgtv}"
APP_ID=com.gathin.tvhome

# LG's webOS CLI: use it from PATH, otherwise fetch it with npx.
ares() {
  if command -v "ares-$1" >/dev/null; then "ares-$1" "${@:2}"
  else npx -y -p @webos-tools/cli "ares-$1" "${@:2}"; fi
}

PY="${PY:-}"
if [ -z "$PY" ]; then
  if [ -x venv/bin/python ]; then PY=venv/bin/python
  elif [ -x venv/Scripts/python.exe ]; then PY=venv/Scripts/python.exe
  elif command -v python3 >/dev/null; then PY=python3
  elif command -v py >/dev/null; then PY="py -3"
  else PY=python; fi
fi
"$PY" sync-apps.py "$TV_HOST"

if [ ! -f app/icon.png ] || [ ! -f app/largeIcon.png ]; then
  # The webOS app list wants PNG icons: 80px and 130px.
  if command -v sips >/dev/null; then
    sips -s format png -z 80 80 assets/icon.jpg --out app/icon.png >/dev/null
    sips -s format png -z 130 130 assets/icon.jpg --out app/largeIcon.png >/dev/null
  elif command -v powershell.exe >/dev/null; then
    powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Drawing; foreach (\$s in 80,130) { \$img=[System.Drawing.Image]::FromFile((Resolve-Path 'assets/icon.jpg')); \$bmp=New-Object System.Drawing.Bitmap \$s,\$s; \$g=[System.Drawing.Graphics]::FromImage(\$bmp); \$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; \$g.DrawImage(\$img,0,0,\$s,\$s); \$out = if(\$s -eq 80){'app/icon.png'}else{'app/largeIcon.png'}; \$bmp.Save(\$out,[System.Drawing.Imaging.ImageFormat]::Png); \$g.Dispose(); \$bmp.Dispose(); \$img.Dispose() }" >/dev/null 2>&1 || true
  elif "$PY" -c "from PIL import Image" 2>/dev/null; then
    "$PY" -c "from PIL import Image; img=Image.open('assets/icon.jpg'); img.resize((80,80)).save('app/icon.png'); img.resize((130,130)).save('app/largeIcon.png')"
  elif command -v magick >/dev/null; then
    magick assets/icon.jpg -resize 80x80 app/icon.png
    magick assets/icon.jpg -resize 130x130 app/largeIcon.png
  fi
fi

rm -rf build && mkdir build
ares package app -o build
ares install -d "$DEVICE" build/${APP_ID}_*.ipk
ares launch -d "$DEVICE" "$APP_ID"
echo "Installed. Hold a number key on the remote while it is open to make it a one-press shortcut."

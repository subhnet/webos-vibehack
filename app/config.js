// Launcher configuration. Edit this file, then run install.ps1 / install.sh.
// App ids: run `python3 sync-apps.py --list` (or look in app/apps.js after a sync).
window.CONFIG = {
  // Apps pinned to the dock row at the bottom, in this order. Missing apps are skipped.
  dockApps: ['netflix', 'amazon', 'youtube.leanback.v4', 'hotstar'],

  // Apps never shown as tiles (inputs and Live TV are already in the Inputs menu).
  hiddenApps: [
    'com.gathin.tvhome',
    'com.webos.app.livetv',
    'com.webos.app.hdmi1', 'com.webos.app.hdmi2', 'com.webos.app.hdmi3', 'com.webos.app.hdmi4',
    'com.webos.app.lgchannels',   // LG Channels
    'shortcutcopilot'             // Copilot
  ],

  // The Live TV app, offered at the end of the Inputs menu. Leave empty to omit.
  liveTvApp: 'com.webos.app.livetv',

  // Tiles per row in the grid; the dock always has this many slots.
  columns: 4,

  // ── Theme ──────────────────────────────────────────────────────────────────────────
  // 'black' | 'gradient' | 'time-of-day'
  theme: 'time-of-day',

  // Seconds of idle on the launcher before the screensaver activates (0 = disabled).
  screensaverAfter: 300,

  // ── App Folders ─────────────────────────────────────────────────────────────────────
  // Group apps into folder tiles. Folder member apps are hidden from the main grid.
  // Example: { name: 'Games', apps: ['com.miniclip.eightballpool', 'com.playworks.app.doodlejump'] }
  folders: [],

  // ── Companion PC ────────────────────────────────────────────────────────────────────
  // Local IP of the PC running home-watch.py. Used for weather proxy and notifications.
  // Set to '' to disable both weather and notifications.
  companionHost: '172.28.176.1',

  // ── Weather ─────────────────────────────────────────────────────────────────────────
  // Latitude / longitude for Open-Meteo (free, no API key). Set both or leave null to disable.
  weatherLat: 12.9716,
  weatherLon: 77.5946,

  // ── Sleep Timer ─────────────────────────────────────────────────────────────────────
  // Minute options shown in the sleep-timer overlay (press Green / color key).
  sleepTimerOptions: [15, 30, 60, 90],
};

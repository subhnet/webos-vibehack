/*
 * tvOS style home for webOS: black, a pinned dock row, an app grid, and one glass highlight that
 * springs between tiles. A port of the Android launcher in ../../launcher.
 *
 * webOS does not let third-party apps list installed apps, so sync-apps.py writes them into apps.js.
 */
(function () {
  'use strict';

  var COLUMNS = Math.max(1, CONFIG.columns || 4);
  var TILE_W = 360, TILE_H = 202;
  var CELL_W = (1920 - 2 * 112) / COLUMNS;
  var ROW_PITCH = 292;
  var DOCK_TOP = 708;           // tile top of the dock row: next row peeks in at the bottom
  var DOCK_GAP = 36;            // extra space below the dock
  var FOCUS_SCALE = 1.1;
  var GLASS_PAD = 12;           // room for the glass glow around the scaled tile
  var VIEW_TOP = 80, VIEW_BOTTOM = 1060;    // area grid rows scroll into (the header hides below the dock)

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, RED: 403, GREEN: 404 };

  var GREETINGS = [[5, 'Good night'], [12, 'Good morning'], [17, 'Good afternoon'], [22, 'Good evening'], [24, 'Good night']];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];

  var ICON_INPUT = 'M18,7V4c0,-1.1 -0.9,-2 -2,-2H8C6.9,2 6,2.9 6,4v3H5v6l3,6v3h8v-3l3,-6V7H18zM8,4h8v3h-2V5h-1v2h-2V5h-1v2H8V4z';
  var ICON_LIVETV = 'M21,6h-7.59l3.29,-3.29L16,2l-4,4l-4,-4l-0.71,0.71L10.59,6H3c-1.1,0 -2,0.89 -2,2v12c0,1.1 0.9,2 2,2h18c1.1,0 2,-0.89 2,-2V8C23,6.89 22.1,6 21,6zM21,20H3V8h18V20zM9,10v8l7,-4L9,10z';

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), tilesEl = $('tiles'), glass = $('glass'), hero = $('hero');
  var ambients = [$('ambientA'), $('ambientB')], ambientFront = 0, ambientColor = null;
  var pills = [$('btnInputs'), $('btnWifi'), $('btnSettings')];
  var panel = $('inputsPanel');

  var items = [];               // {app, el, card, color} — app.folderApps marks a folder tile
  var zone = 'grid';            // 'grid' | 'top' | 'inputs' | 'search' | 'sleep' | 'folder'
  var focused = 0, pillFocus = 0, inputFocus = 0, inputRows = [];
  var offset = 0, heroShown = false, glassShown = false;
  var editing = null;           // {item, snapshot} while a tile is being moved

  // ---- luna bus ------------------------------------------------------------------------------

  var bridges = [];   // keep a reference: a collected bridge drops its callback

  function luna(uri, params, cb) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        var res;
        try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false }; }
        if (cb) cb(res);
        if (!params || !params.subscribe) bridges.splice(bridges.indexOf(b), 1);
      };
      bridges.push(b);
      b.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      if (cb) cb({ returnValue: false, errorText: String(e) });   // not on a TV (desktop preview)
    }
  }

  function launch(id, title, params) {
    recordLaunch(id);
    hideNowPlaying();
    luna('luna://com.webos.applicationManager/launch', { id: id, params: params || {} }, function (res) {
      if (res.returnValue === false) toast("Can't open " + (title || id));
    });
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('shown'); }, 2200);
  }

  // ---- recently used -------------------------------------------------------------------------

  var RECENT_KEY = 'tvhome.recent';
  var RECENT_MAX = 6;
  var lastRecentSignature = null;

  function loadRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
  }

  function recordLaunch(id) {
    var known = (window.TV_APPS && TV_APPS.apps) || [], exists = false;
    for (var i = 0; i < known.length; i++) {
      if (known[i].id === id) { exists = true; break; }
    }
    if (!exists) return;   // Settings, HDMI inputs and other non-tile launches stay out of recents

    var r = loadRecent().filter(function (x) { return x !== id; });
    r.unshift(id);
    if (r.length > RECENT_MAX) r.length = RECENT_MAX;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) { /* storage unavailable */ }
  }

  function recentApps(byId) {
    return loadRecent().map(function (id) { return byId[id]; }).filter(Boolean);
  }

  // ---- apps ----------------------------------------------------------------------------------

  function orderedApps() {
    var all = (window.TV_APPS && TV_APPS.apps) || [];
    var byId = {};
    all.forEach(function (a) { byId[a.id] = a; });
    var hidden = {};
    (CONFIG.hiddenApps || []).forEach(function (id) { hidden[id] = true; });
    var byTitle = function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; };

    // Folders: member apps leave the grid and appear inside a synthetic folder tile.
    var folderOf = {}, folders = [];
    (CONFIG.folders || []).forEach(function (f) {
      if (!f || !f.name || !f.apps || !f.apps.length) return;
      var members = [];
      f.apps.forEach(function (id) {
        var a = byId[id];
        if (a && !hidden[id] && members.indexOf(a) < 0) members.push(a);
      });
      if (!members.length) return;
      var folder = {
        id: '__folder__:' + f.name,
        title: f.name,
        icon: members[0].icon,
        iconColor: members[0].iconColor,
        folderApps: members
      };
      folders.push(folder);
      members.forEach(function (a) { folderOf[a.id] = folder; hidden[a.id] = true; });
    });

    // An order arranged on the TV wins, until dockApps in config.js changes.
    var saved = loadOrder();
    if (saved) {
      var placed = [], seen = {}, placedFolders = {};
      saved.forEach(function (id) {
        var direct = folders.filter(function (x) { return x.id === id; })[0];
        if (direct) {
          if (!placedFolders[direct.id]) { placed.push(direct); placedFolders[direct.id] = true; }
        } else if (folderOf[id]) {
          var f = folderOf[id];
          if (!placedFolders[f.id]) { placed.push(f); placedFolders[f.id] = true; }
        } else if (byId[id] && !hidden[id] && !seen[id]) {
          placed.push(byId[id]);
          seen[id] = true;
          hidden[id] = true;
        }
      });

      var remaining = all.filter(function (a) { return !hidden[a.id] && !seen[a.id]; }).sort(byTitle);
      folders.forEach(function (f) {
        if (placedFolders[f.id]) return;
        var anchor = f.folderApps[0].title.toLowerCase();
        var at = remaining.length;
        for (var i = 0; i < remaining.length; i++) {
          if (remaining[i].title.toLowerCase() > anchor) { at = i; break; }
        }
        remaining.splice(at, 0, f);
        placedFolders[f.id] = true;
      });
      return placed.concat(remaining);
    }

    var dock = [], dockIds = {};
    (CONFIG.dockApps || []).forEach(function (id) {
      if (!byId[id] || dock.length >= COLUMNS) return;
      var f = folderOf[id];
      if (f) {
        if (dock.indexOf(f) < 0) dock.push(f);
      } else if (!hidden[id] && !dockIds[id]) {
        dock.push(byId[id]);
        dockIds[id] = true;
        hidden[id] = true;
      }
    });

    var rest = all.filter(function (a) { return !hidden[a.id]; });
    rest.sort(byTitle);

    // A folder sits where its first (alphabetical) member would have been.
    folders.forEach(function (f) {
      if (dock.indexOf(f) >= 0) return;
      var anchor = f.folderApps[0].title.toLowerCase();
      var at = rest.length;
      for (var i = 0; i < rest.length; i++) {
        if (rest[i].title.toLowerCase() > anchor) { at = i; break; }
      }
      rest.splice(at, 0, f);
    });

    // Recently used apps become the first grid row, below the pinned dock.
    var recent = recentApps(byId).filter(function (a) { return !hidden[a.id]; });
    if (recent.length) {
      var dedup = rest.filter(function (a) { return recent.indexOf(a) < 0; });
      return dock.concat(recent, dedup);
    }
    return dock.concat(rest);
  }

  var ORDER_KEY = 'tvhome.order';

  function loadOrder() {
    try {
      var s = JSON.parse(localStorage.getItem(ORDER_KEY));
      return s && s.dock === (CONFIG.dockApps || []).join(',') ? s.ids : null;
    } catch (e) {
      return null;
    }
  }

  function saveOrder() {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify({
        dock: (CONFIG.dockApps || []).join(','),
        ids: items.map(function (it) { return it.app.id; })
      }));
    } catch (e) { /* storage unavailable: the order lasts until the app restarts */ }
  }

  function rowOf(i) { return Math.floor(i / COLUMNS); }
  function tileLeft(i) { return 112 + (i % COLUMNS) * CELL_W + (CELL_W - TILE_W) / 2; }
  function tileTop(i) { var r = rowOf(i); return DOCK_TOP + r * ROW_PITCH + (r > 0 ? DOCK_GAP : 0); }

  function build() {
    tilesEl.innerHTML = '';
    var recentIds = {};
    loadRecent().forEach(function (id) { recentIds[id] = true; });

    items = orderedApps().map(function (app) {
      var el = document.createElement('div');
      el.className = 'item';
      var card = document.createElement('div');
      card.className = 'card';
      var item = { app: app, el: el, card: card, color: null };

      if (app.folderApps) {
        card.classList.add('folderCard');
        var collage = document.createElement('div');
        collage.className = 'folderCollage';
        app.folderApps.slice(0, 4).forEach(function (a) {
          var mini = document.createElement('img');
          mini.src = a.icon;
          collage.appendChild(mini);
        });
        card.appendChild(collage);
        var folderLabel = document.createElement('div');
        folderLabel.className = 'folderCardLabel';
        folderLabel.textContent = app.title;
        card.appendChild(folderLabel);
        item.color = [96, 96, 128];
      } else {
        var img = document.createElement('img');
        img.onload = function () { paintTile(item, img); };
        img.src = app.icon;
        card.appendChild(img);
        var name = document.createElement('div');
        name.className = 'name';
        name.textContent = app.title;
        el.appendChild(name);
        if (recentIds[app.id]) el.setAttribute('data-recent', '');
      }

      el.appendChild(card);
      el.addEventListener('mouseover', function () {
        if (zone === 'grid' && !editing) focusTile(items.indexOf(item));
      });
      el.addEventListener('click', function () {
        if (editing) finishEdit(true);
        else activateItem(item);
      });
      tilesEl.appendChild(el);
      return item;
    });
    layout();
  }

  function activateItem(item) {
    if (item.app.folderApps) openFolder(item);
    else launch(item.app.id, item.app.title);
  }

  /** Places every tile by its position in items; tiles glide when the order changes. */
  function layout() {
    items.forEach(function (it, i) {
      it.el.style.left = tileLeft(i) + 'px';
      it.el.style.top = tileTop(i) + 'px';
      it.el.classList.toggle('dock', rowOf(i) === 0);   // the dock has no labels: the top shelf names it
    });

    var band = $('dockBand');
    var n = Math.min(COLUMNS, items.length);
    band.style.display = n ? 'block' : 'none';
    band.style.left = (tileLeft(0) - 28) + 'px';
    band.style.top = (DOCK_TOP - 28) + 'px';
    band.style.width = ((n - 1) * CELL_W + TILE_W + 56) + 'px';
    band.style.height = (TILE_H + 56) + 'px';
  }

  function animateIn() {
    items.forEach(function (it, i) {
      it.el.classList.remove('shown');
      setTimeout(function () { it.el.classList.add('shown'); }, 60 + Math.min(i, 16) * 40);
    });
  }

  /**
   * Store icons are square logos on a solid colour: fill the wide tile with that colour so the logo
   * reads as a banner. LG's system icons are glyphs on transparent: use the app's own colour.
   */
  function paintTile(item, img) {
    var px = null, edge = null;
    try {
      var c = document.createElement('canvas');
      c.width = 12; c.height = 12;
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0, 12, 12);
      px = g.getImageData(0, 0, 12, 12).data;
      edge = edgeColor(img);
    } catch (e) { /* tainted canvas: fall back to the app's colour */ }

    var glyphColor = null;
    if (edge && edge[3] > 200) {
      item.card.style.background = 'rgb(' + edge[0] + ',' + edge[1] + ',' + edge[2] + ')';
    } else {
      item.card.classList.add('glyph');
      item.card.style.background = glyphBackground(item.app.iconColor);
      glyphColor = glyphBackground(item.app.iconColor) === '#2c2c2e' ? null : parseColor(item.app.iconColor);
    }
    // A white glyph says nothing about the app: glow in the tile's colour instead.
    item.color = glyphColor || (px ? vividColor(px) : parseColor(item.app.iconColor));
    if (items[focused] === item) setAmbient(item.color);
  }

  /**
   * The icon's background at full size: a corner pixel, or the middle of the left edge for rounded
   * icons whose corners are transparent. A downscaled sample would blend in the logo.
   */
  function edgeColor(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    var corner = g.getImageData(2, 2, 1, 1).data;
    return corner[3] > 200 ? corner : g.getImageData(2, Math.floor(h / 2), 1, 1).data;
  }

  function glyphBackground(hex) {
    var c = parseColor(hex);
    if (!c) return '#2c2c2e';
    var hsv = rgbToHsv(c);
    if (hsv[1] < 0.15 && (hsv[2] > 0.85 || hsv[2] < 0.1)) return '#2c2c2e';   // white or black glyph colour
    return 'rgb(' + c.join(',') + ')';
  }

  /** A vivid colour from the icon: the most saturated, not too dark pixel, or the lifted average. */
  function vividColor(px) {
    var best = null, bestScore = -1, sum = [0, 0, 0], n = 0;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      var p = [px[i], px[i + 1], px[i + 2]];
      sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++;
      var hsv = rgbToHsv(p);
      var score = hsv[1] * Math.min(1, hsv[2] * 1.4);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!n) return [68, 68, 68];
    if (bestScore < 0.25) {   // nearly monochrome icon (e.g. white): its average, lifted
      var avg = rgbToHsv([sum[0] / n, sum[1] / n, sum[2] / n]);
      avg[2] = Math.max(avg[2], 0.55);
      return hsvToRgb(avg);
    }
    var h = rgbToHsv(best);
    h[1] = Math.min(1, h[1] * 1.1);
    h[2] = Math.max(0.5, h[2]);
    return hsvToRgb(h);
  }

  function parseColor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  }

  function rgbToHsv(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  }

  function hsvToRgb(hsv) {
    var h = hsv[0], s = hsv[1], v = hsv[2];
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(function (k) { return Math.round((k + m) * 255); });
  }

  // ---- focus & glass -------------------------------------------------------------------------

  function focusTile(i) {
    if (!items.length) return;
    i = Math.max(0, Math.min(i, items.length - 1));
    setZone('grid');
    if (items[focused]) items[focused].el.classList.remove('focused');
    focused = i;
    items[i].el.classList.add('focused');

    var top = tileTop(i), row = rowOf(i);
    if (row === 0) {
      offset = 0;
    } else {
      // Scroll just enough so the whole glass and the name below the tile are visible.
      if (top - offset + TILE_H + 70 > VIEW_BOTTOM) offset = top + TILE_H + 70 - VIEW_BOTTOM;
      if (top - offset - 24 < VIEW_TOP) offset = top - 24 - VIEW_TOP;
    }
    stage.style.transform = 'translateY(' + (-offset) + 'px)';
    // Keep the header until the content (the dock band is topmost) would run into it.
    var header = document.querySelector('header');
    var headerBottom = header.offsetTop + header.offsetHeight;   // layout box: ignores the hide slide
    document.body.classList.toggle('scrolled', DOCK_TOP - 28 - offset < headerBottom + 24);

    var w = TILE_W * FOCUS_SCALE + 2 * GLASS_PAD, h = TILE_H * FOCUS_SCALE + 2 * GLASS_PAD;
    var x = tileLeft(i) + TILE_W / 2 - w / 2, y = top + TILE_H / 2 - h / 2;
    glass.style.width = w + 'px';
    glass.style.height = h + 'px';
    glass.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    if (!glassShown) {
      // First show: jump there without the spring, then fade in.
      glass.style.transition = 'none';
      glass.offsetWidth;   // flush the jump before restoring the transition
      glass.style.transition = '';
      glass.style.opacity = '1';
      glassShown = true;
    }

    if (row === 0) showHero(items[i]);
    else hideHero();
    setAmbient(items[i].color);   // the glow follows the focused tile in every row
  }

  function hideGlass() {
    glassShown = false;
    glass.style.opacity = '0';
  }

  function showHero(item) {
    var label = item.app.title;
    hero.style.top = (DOCK_TOP - 28 - 52 - 96) + 'px';
    if (!heroShown) {
      hero.textContent = label;
      hero.style.transform = 'none';
      hero.style.opacity = '1';
      heroShown = true;
    } else if (hero.textContent !== label) {
      hero.style.opacity = '0';
      hero.style.transform = 'translateX(-24px)';
      clearTimeout(hero.swap);
      hero.swap = setTimeout(function () {
        hero.textContent = label;
        hero.style.transition = 'none';
        hero.style.transform = 'translateX(24px)';
        hero.offsetWidth;
        hero.style.transition = '';
        hero.style.transform = 'none';
        hero.style.opacity = '1';
      }, 120);
    }
    setAmbient(item.color);
  }

  function hideHero() {
    if (!heroShown) return;
    heroShown = false;
    hero.style.opacity = '0';
  }

  /** Crossfades the glow to a new colour by swapping between two layers. */
  function setAmbient(color) {
    if (!color) return;
    var key = color.join(',');
    if (key === ambientColor) return;
    ambientColor = key;
    var back = ambients[1 - ambientFront];
    back.style.background = 'radial-gradient(circle 1190px at 32% 42%, rgba(' + key + ',0.36) 0%, rgba(' +
      key + ',0.15) 50%, rgba(' + key + ',0) 100%)';
    back.style.opacity = '1';
    ambients[ambientFront].style.opacity = '0';
    ambientFront = 1 - ambientFront;
  }

  function focusPill(i) {
    setZone('top');
    document.body.classList.remove('scrolled');
    pills[pillFocus].classList.remove('focused');
    pillFocus = Math.max(0, Math.min(i, pills.length - 1));
    pills[pillFocus].classList.add('focused');
  }

  function setZone(z) {
    if (zone === z) return;
    if (zone === 'top') pills[pillFocus].classList.remove('focused');
    if (zone === 'grid') {
      if (items[focused]) items[focused].el.classList.remove('focused');
      hideGlass();
    }
    zone = z;
  }

  /** The pill straight above a dock tile, by horizontal distance. */
  function pillAbove(i) {
    var cx = tileLeft(i) + TILE_W / 2, best = 0, bestD = Infinity;
    pills.forEach(function (p, k) {
      var r = p.getBoundingClientRect();
      var d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  // ---- top bar -------------------------------------------------------------------------------

  function updateClock() {
    var now = new Date(), h = now.getHours();
    for (var k = 0; k < GREETINGS.length; k++) {
      if (h < GREETINGS[k][0]) { $('greeting').textContent = GREETINGS[k][1]; break; }
    }
    var m = now.getMinutes();
    $('clock').textContent = ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m;
    $('ampm').textContent = h < 12 ? 'am' : 'pm';
    $('date').textContent = DAYS[now.getDay()] + '  ' + now.getDate() + ' ' + MONTHS[now.getMonth()];

    if (CONFIG.theme === 'time-of-day') applyTheme();
    if ($('screensaver').classList.contains('active')) updateScreensaver();
  }

  /** Shows the Wi-Fi network name when the TV reports it, otherwise the connection type. */
  function watchNetwork() {
    luna('luna://com.palm.connectionmanager/getStatus', { subscribe: true }, function (res) {
      if (res.returnValue === false && !res.wifi && !res.wired) return;
      var text = 'Wi-Fi';
      if (res.wired && res.wired.state === 'connected') text = 'Ethernet';
      else if (res.wifi && res.wifi.state === 'connected') text = res.wifi.ssid || 'Wi-Fi';
      else if (res.isInternetConnectionAvailable === false) text = 'Offline';
      $('wifiLabel').textContent = text;
    });
  }

  function activatePill(i) {
    if (i === 0) showInputs();
    else if (i === 1) launch('com.palm.app.settings', 'Settings', { target: 'network' });
    else launch('com.palm.app.settings', 'Settings');
  }

  // ---- inputs dropdown -----------------------------------------------------------------------

  function showInputs() {
    panel.innerHTML = '';
    inputRows = [];
    var inputs = (window.TV_APPS && TV_APPS.inputs) || [];
    inputs.forEach(function (inp) { addInputRow(ICON_INPUT, inp.label, inp.appId); });
    if (CONFIG.liveTvApp) {
      if (inputRows.length) panel.appendChild(Object.assign(document.createElement('div'), { className: 'separator' }));
      addInputRow(ICON_LIVETV, 'Live TV', CONFIG.liveTvApp);
    }
    if (!inputRows.length) { toast('No inputs found'); return; }

    // Hang right below the Inputs pill, at least as wide as it.
    var r = pills[0].getBoundingClientRect();
    panel.style.left = r.left + 'px';
    panel.style.top = (r.bottom + 20) + 'px';
    panel.style.minWidth = Math.max(r.width, 300) + 'px';
    panel.classList.remove('hidden');
    pills[pillFocus].classList.remove('focused');
    zone = 'inputs';
    focusInput(0);
  }

  function addInputRow(icon, label, appId) {
    var row = document.createElement('div');
    row.className = 'inputRow';
    row.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icon + '"/></svg>';
    row.appendChild(document.createTextNode(label));
    var idx = inputRows.length;
    row.addEventListener('mouseover', function () { focusInput(idx); });
    row.addEventListener('click', function () { hideInputs(); launch(appId, label); });
    row.appId = appId;
    row.label = label;
    inputRows.push(row);
    panel.appendChild(row);
  }

  function focusInput(i) {
    if (inputRows[inputFocus]) inputRows[inputFocus].classList.remove('focused');
    inputFocus = Math.max(0, Math.min(i, inputRows.length - 1));
    inputRows[inputFocus].classList.add('focused');
  }

  function hideInputs() {
    panel.classList.add('hidden');
    zone = 'none';
    focusPill(0);
  }

  // ---- volume HUD ----------------------------------------------------------------------------

  var VOL_ICON_ON = 'M3,9v6h4l5,5V4L7,9H3zm13.5,3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73,2.5-2.25,2.5-4.02z' +
    'M14,3.23v2.06c2.89.86,5,3.54,5,6.71s-2.11,5.85-5,6.71v2.06c4.01-.91,7-4.49,7-8.77s-2.99-7.86-7-8.77z';
  var VOL_ICON_OFF = 'M16.5,12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45,2.45c.03-.2.05-.41.05-.63zm2.5,0c0,.94-.2,1.82-.54,2.64' +
    'l1.51,1.51C20.63,14.91,21,13.5,21,12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86,5,3.54,5,6.71zM4.27,3L3,4.27,' +
    '7.73,9H3v6h4l5,5v-6.73l4.25,4.25c-.67.52-1.42.93-2.25,1.18v2.06c1.38-.31,2.63-.95,3.69-1.81L19.73,21,' +
    '21,19.73l-9-9L4.27,3zM12,4L9.91,6.09,12,8.18V4z';
  var volHideTimer, volFirst = true;

  function isMutedValue(v) { return v === true || v === 'mute' || v === 'muted'; }

  function showVolumeHud(vol, muted) {
    var hud = $('volumeHud'), fill = $('volFill'), num = $('volNum'), icon = $('volumeHud').querySelector('svg');
    var level = Math.max(0, Math.min(100, Number(vol) || 0));
    icon.querySelector('path').setAttribute('d', muted || level === 0 ? VOL_ICON_OFF : VOL_ICON_ON);
    fill.style.width = (muted ? 0 : level) + '%';
    num.textContent = muted ? 'Muted' : level;
    hud.classList.remove('hidden');
    clearTimeout(volHideTimer);
    volHideTimer = setTimeout(function () { hud.classList.add('hidden'); }, 2200);
  }

  function watchVolume() {
    luna('luna://com.webos.service.audio/getVolume', { subscribe: true }, function (res) {
      if (res.returnValue === false) return;
      var status = res.volumeStatus || res;
      var vol = typeof status.volume !== 'undefined' ? status.volume : res.volume;
      var muted = typeof status.muteStatus !== 'undefined' ? status.muteStatus : res.muted;
      // The subscription sends the current level immediately: don't flash the HUD at startup.
      if (volFirst) { volFirst = false; return; }
      showVolumeHud(vol, isMutedValue(muted));
    });
  }

  // ---- sleep timer ---------------------------------------------------------------------------

  var sleepEnd = 0, sleepTotal = 0, sleepTickId = null, sleepWarned = false;
  var sleepPills = [], sleepFocus = 0;

  function openSleepOverlay() {
    if (zone === 'inputs') { panel.classList.add('hidden'); zone = 'none'; }

    var entries = (CONFIG.sleepTimerOptions || [15, 30, 60, 90]).map(function (min) {
      return { label: min + ' min', min: min };
    });
    if (sleepEnd > Date.now()) entries.push({ label: 'Cancel', cancel: true });

    var pillsEl = $('sleepPills');
    pillsEl.innerHTML = '';
    sleepPills = [];
    entries.forEach(function (entry, idx) {
      var p = document.createElement('div');
      p.className = 'sleepPill';
      p.textContent = entry.label;
      p.addEventListener('mouseover', function () { focusSleepPill(idx); });
      p.addEventListener('click', function () { activateSleepPill(idx); });
      pillsEl.appendChild(p);
      sleepPills.push({ el: p, entry: entry });
    });

    if (!sleepPills.length) return;
    setZone('sleep');
    $('sleepOverlay').classList.remove('hidden');
    sleepFocus = 0;
    focusSleepPill(0);
    noteActivity();
  }

  function focusSleepPill(i) {
    if (!sleepPills.length) return;
    if (sleepPills[sleepFocus]) sleepPills[sleepFocus].el.classList.remove('focused');
    sleepFocus = Math.max(0, Math.min(i, sleepPills.length - 1));
    sleepPills[sleepFocus].el.classList.add('focused');
  }

  function activateSleepPill(i) {
    var item = sleepPills[i];
    if (!item) return;
    closeSleepOverlay();
    if (item.entry.cancel) cancelSleep();
    else startSleep(item.entry.min * 60);
  }

  function closeSleepOverlay() {
    if (sleepPills[sleepFocus]) sleepPills[sleepFocus].el.classList.remove('focused');
    $('sleepOverlay').classList.add('hidden');
    setZone('grid');
    focusTile(focused);
  }

  function startSleep(seconds) {
    clearInterval(sleepTickId);
    sleepEnd = Date.now() + seconds * 1000;
    sleepTotal = seconds;
    sleepWarned = false;
    $('sleepRing').classList.remove('hidden');
    sleepTickId = setInterval(tickSleep, 1000);
    tickSleep();
    toast('Sleeping in ' + Math.round(seconds / 60) + ' min');
  }

  function cancelSleep() {
    clearInterval(sleepTickId);
    sleepTickId = null;
    sleepEnd = 0;
    sleepTotal = 0;
    sleepWarned = false;
    $('sleepRing').classList.add('hidden');
    toast('Sleep timer cancelled');
  }

  function tickSleep() {
    var left = Math.max(0, sleepEnd - Date.now()) / 1000;
    var frac = sleepTotal ? left / sleepTotal : 0;
    var circ = 113.1;
    $('sleepArc').setAttribute('stroke-dashoffset', (circ * (1 - frac)).toFixed(1));
    $('sleepRingLabel').textContent = Math.ceil(left / 60) + 'm';
    if (!sleepWarned && sleepTotal > 300 && left <= 300 && left > 0) {
      sleepWarned = true;
      toast('Sleeping in 5 minutes');
    }
    if (left <= 0) {
      clearInterval(sleepTickId);
      sleepTickId = null;
      sleepEnd = 0;
      $('sleepRing').classList.add('hidden');
      luna('luna://system/turnOff', {});
    }
  }

  // ---- themes & screensaver ------------------------------------------------------------------

  var THEME_HOURS = [
    [5, '#0a0a12'],   // night → deep navy
    [7, '#1a1008'],   // dawn → warm amber tint
    [12, '#080d1a'],  // noon → cool blue
    [17, '#1a0a05'],  // dusk → orange tint
    [21, '#0a0816'],  // evening → purple
    [24, '#0a0a12']
  ];

  function applyTheme() {
    var theme = CONFIG.theme || 'black';
    document.body.classList.toggle('theme-gradient', theme === 'gradient');
    document.body.classList.toggle('theme-time', theme === 'time-of-day');
    if (theme === 'time-of-day') {
      var h = new Date().getHours(), color = THEME_HOURS[0][1];
      for (var i = 0; i < THEME_HOURS.length; i++) {
        if (h < THEME_HOURS[i][0]) { color = THEME_HOURS[i][1]; break; }
      }
      document.body.style.background = color;
    } else if (theme === 'gradient') {
      document.body.style.background = '';
    } else {
      document.body.style.background = '#000';
    }
  }

  var idleTimer = null;

  function updateScreensaver() {
    var now = new Date(), h = now.getHours(), m = now.getMinutes();
    $('ssClock').textContent = ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m;
    $('ssDate2').textContent = DAYS[now.getDay()] + ' ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
  }

  function showScreensaver() {
    var ss = $('screensaver');
    updateScreensaver();
    ss.style.display = 'flex';
    requestAnimationFrame(function () { ss.classList.add('active'); });
  }

  /** Any key, click or mouse move hides the screensaver and restarts the idle countdown. */
  function noteActivity() {
    var ss = $('screensaver');
    if (ss.classList.contains('active')) {
      ss.classList.remove('active');
      setTimeout(function () {
        if (!ss.classList.contains('active')) ss.style.display = 'none';
      }, 2000);
    }
    clearTimeout(idleTimer);
    var after = Number(CONFIG.screensaverAfter) || 0;
    if (!after) return;
    idleTimer = setTimeout(showScreensaver, after * 1000);
  }

  // ---- now playing ---------------------------------------------------------------------------

  var npPlaying = false, npHideTimer = null;

  function showNowPlaying(data) {
    data = data || {};
    $('npTitle').textContent = data.title || 'Now Playing';
    $('npArtist').textContent = data.artist || data.appId || '';
    $('npArt').style.backgroundImage = data.artworkUri ? 'url("' + data.artworkUri + '")' : '';
    npPlaying = data.playing !== false;
    $('npPlay').textContent = npPlaying ? '\u23F8' : '\u25B6';
    $('nowPlaying').classList.remove('hidden');
    clearTimeout(npHideTimer);
    npHideTimer = setTimeout(hideNowPlaying, 30000);
  }

  function hideNowPlaying() {
    clearTimeout(npHideTimer);
    $('nowPlaying').classList.add('hidden');
    npPlaying = false;
  }

  function watchMedia() {
    // Streaming apps often keep their media pipeline private; the watcher's WebSocket media
    // event fills the gap. Try the luna service too, and ignore it when it has nothing to say.
    luna('luna://com.webos.media/getForegroundAppMediaStatus', { subscribe: true }, function (res) {
      if (res.returnValue === false) return;
      var playing = res.playStatus === 'playing' || res.state === 'play';
      if (!playing) { hideNowPlaying(); return; }
      showNowPlaying({
        title: res.title || res.mediaTitle || 'Now Playing',
        artist: res.artist || res.appId || '',
        artworkUri: res.artworkUri
      });
    });

    $('npPlay').addEventListener('click', function () {
      luna('luna://com.webos.media/' + (npPlaying ? 'pause' : 'play'), {});
      npPlaying = !npPlaying;
      $('npPlay').textContent = npPlaying ? '\u23F8' : '\u25B6';
      noteActivity();
    });
    $('npPrev').addEventListener('click', function () {
      luna('luna://com.webos.media/previous', {});
      noteActivity();
    });
    $('npNext').addEventListener('click', function () {
      luna('luna://com.webos.media/next', {});
      noteActivity();
    });
  }

  // ---- weather -------------------------------------------------------------------------------

  function watchWeather() {
    if (!CONFIG.companionHost || CONFIG.weatherLat === null || CONFIG.weatherLat === '' ||
        CONFIG.weatherLon === null || CONFIG.weatherLon === '') return;
    // Keep the location in config.js as the single source of truth.  The companion
    // service validates these values before asking Open-Meteo for the forecast.
    var url = 'http://' + CONFIG.companionHost + ':9999/weather?lat=' +
      encodeURIComponent(CONFIG.weatherLat) + '&lon=' + encodeURIComponent(CONFIG.weatherLon);

    function poll() {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.timeout = 8000;
      xhr.onload = function () {
        if (xhr.status !== 200) return;
        try {
          var d = JSON.parse(xhr.responseText);
          if (typeof d.temp === 'undefined') return;
          $('weatherIcon').textContent = d.icon || '\uD83C\uDF21';
          $('weatherTemp').textContent = d.temp + (d.unit || '°C');
          $('weather').classList.remove('hidden');
        } catch (e) { /* bad payload: keep the last good reading */ }
      };
      xhr.send();
    }

    poll();
    setInterval(poll, 15 * 60 * 1000);
  }

  // ---- notifications (companion WebSocket) ---------------------------------------------------

  var companionSocket = null, companionRetry = 5000;

  function connectCompanion() {
    if (!CONFIG.companionHost || !window.WebSocket) return;
    try {
      companionSocket = new WebSocket('ws://' + CONFIG.companionHost + ':9998');
    } catch (e) {
      scheduleCompanionReconnect();
      return;
    }
    companionSocket.onopen = function () { companionRetry = 5000; };
    companionSocket.onmessage = function (evt) {
      var msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (!msg) return;
      if (msg.type === 'notify' && msg.text) {
        toast(msg.text);
        noteActivity();
      } else if (msg.type === 'media') {
        showNowPlaying({ title: msg.title, artist: msg.appId, playing: true });
      }
    };
    companionSocket.onclose = function () {
      companionSocket = null;
      scheduleCompanionReconnect();
    };
    companionSocket.onerror = function () {
      try { companionSocket.close(); } catch (e) { /* already closed */ }
    };
  }

  function scheduleCompanionReconnect() {
    setTimeout(connectCompanion, companionRetry);
    companionRetry = Math.min(companionRetry * 2, 30000);
  }

  // ---- quick search --------------------------------------------------------------------------

  var searchMatches = [], searchFocus = 0, searchInResults = false;

  function openSearch() {
    if (zone === 'inputs') { panel.classList.add('hidden'); zone = 'none'; }
    searchInResults = false;
    setZone('search');
    $('searchOverlay').classList.remove('hidden');
    $('searchInput').value = '';
    filterSearch('');
    $('searchInput').focus();
    noteActivity();
  }

  function closeSearch() {
    $('searchOverlay').classList.add('hidden');
    $('searchInput').blur();
    $('searchResults').innerHTML = '';
    searchMatches = [];
    searchInResults = false;
    setZone('grid');
    focusTile(focused);
  }

  function searchEntries() {
    var out = [], seen = {};
    items.forEach(function (it) {
      if (it.app.folderApps) {
        out.push(it.app);   // the folder itself is searchable by name
        it.app.folderApps.forEach(function (a) { out.push(a); });
      } else {
        out.push(it.app);
      }
    });
    return out.filter(function (a) {
      if (seen[a.id]) return false;
      seen[a.id] = true;
      return true;
    });
  }

  function filterSearch(q) {
    var results = $('searchResults');
    results.innerHTML = '';
    searchMatches = [];
    searchInResults = false;

    var lq = String(q || '').toLowerCase();
    searchMatches = searchEntries().filter(function (app) {
      return !lq || app.title.toLowerCase().indexOf(lq) >= 0;
    }).slice(0, 12);

    searchFocus = 0;
    searchMatches.forEach(function (app, idx) {
      var row = document.createElement('div');
      row.className = 'searchRow';
      var img = document.createElement('img');
      img.src = app.icon;
      row.appendChild(img);
      row.appendChild(document.createTextNode(app.title));
      row.addEventListener('mouseover', function () { focusSearchResult(idx); });
      row.addEventListener('click', function () { activateSearchResult(idx); });
      results.appendChild(row);
    });
  }

  function clearSearchFocus() {
    var rows = $('searchResults').children;
    if (rows[searchFocus]) rows[searchFocus].classList.remove('focused');
  }

  function focusSearchResult(i) {
    if (!searchMatches.length) return;
    if (searchFocus !== i) {
      var rows = $('searchResults').children;
      if (rows[searchFocus]) rows[searchFocus].classList.remove('focused');
    }
    searchFocus = Math.max(0, Math.min(i, searchMatches.length - 1));
    var current = $('searchResults').children[searchFocus];
    if (current) current.classList.add('focused');
  }

  function activateSearchResult(i) {
    var app = searchMatches[i];
    if (!app) return;
    if (app.folderApps) {
      var it = items.filter(function (x) { return x.app === app; })[0];
      closeSearch();
      if (it) openFolder(it);
    } else {
      closeSearch();
      launch(app.id, app.title);
    }
  }

  // ---- folders -------------------------------------------------------------------------------

  var folderOpen = null, folderFocus = 0, folderTiles = [];

  function openFolder(item) {
    if (!item || !item.app.folderApps) return;
    folderOpen = item;
    folderFocus = 0;
    folderTiles = [];

    var grid = $('folderGrid');
    grid.innerHTML = '';
    $('folderTitle').textContent = item.app.title;

    item.app.folderApps.forEach(function (app) {
      var tile = document.createElement('div');
      tile.className = 'folderTile';
      var card = document.createElement('div');
      card.className = 'folderTileCard';
      var img = document.createElement('img');
      img.src = app.icon;
      card.appendChild(img);
      var label = document.createElement('div');
      label.className = 'folderTileLabel';
      label.textContent = app.title;
      tile.appendChild(card);
      tile.appendChild(label);

      var entry = { app: app, el: tile };
      tile.addEventListener('mouseover', function () { focusFolder(folderTiles.indexOf(entry)); });
      tile.addEventListener('click', function () {
        closeFolder();
        launch(app.id, app.title);
      });
      folderTiles.push(entry);
      grid.appendChild(tile);
    });

    setZone('folder');
    $('folderOverlay').classList.remove('hidden');
    focusFolder(0);
    noteActivity();
  }

  function focusFolder(i) {
    if (!folderTiles.length) return;
    if (folderTiles[folderFocus]) folderTiles[folderFocus].el.classList.remove('focused');
    folderFocus = Math.max(0, Math.min(i, folderTiles.length - 1));
    folderTiles[folderFocus].el.classList.add('focused');
  }

  function closeFolder() {
    if (folderTiles[folderFocus]) folderTiles[folderFocus].el.classList.remove('focused');
    $('folderOverlay').classList.add('hidden');
    $('folderGrid').innerHTML = '';
    folderOpen = null;
    folderTiles = [];
    setZone('grid');
    focusTile(focused);
  }

  // ---- rearranging ---------------------------------------------------------------------------

  /** Hold OK on a tile: it wiggles, the arrows move it, OK places it, Back puts everything back. */
  function startEdit() {
    var it = items[focused];
    if (!it) return;
    editing = { item: it, snapshot: items.slice() };
    it.el.classList.add('moving');
    document.body.classList.add('editing');
    toast('Arrows to move  ·  OK to place  ·  Back to cancel');
  }

  function moveTo(to) {
    if (to < 0 || to >= items.length || to === focused) return;
    items.splice(to, 0, items.splice(focused, 1)[0]);
    focused = to;
    layout();
    focusTile(to);
  }

  function finishEdit(keep) {
    var it = editing.item;
    if (!keep) {
      items = editing.snapshot;
      layout();
    }
    editing = null;
    it.el.classList.remove('moving');
    document.body.classList.remove('editing');
    if (keep) saveOrder();
    focused = items.indexOf(it);
    focusTile(focused);
  }

  // ---- keys ----------------------------------------------------------------------------------

  var LONG_PRESS_MS = 600;
  var okDown = false, okTimer = null;

  // On tiles OK acts on release, so a held OK can start rearranging instead of opening the app.
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.OK) return;
    okDown = false;
    if (!okTimer) return;
    clearTimeout(okTimer);
    okTimer = null;
    var it = items[focused];
    if (zone === 'grid' && it && !editing) activateItem(it);
  });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;

    // Waking the screensaver consumes the keypress; it shouldn't also open an app.
    var ss = $('screensaver');
    if (ss.classList.contains('active')) {
      noteActivity();
      e.preventDefault();
      return;
    }

    if (zone === 'search') {
      if (k === KEY.BACK || k === KEY.ESC) { closeSearch(); e.preventDefault(); }
      else if (k === KEY.DOWN) {
        if (!searchInResults) { searchInResults = true; focusSearchResult(0); }
        else focusSearchResult(searchFocus + 1);
        e.preventDefault();
      } else if (k === KEY.UP) {
        if (searchInResults) {
          if (searchFocus > 0) focusSearchResult(searchFocus - 1);
          else { searchInResults = false; clearSearchFocus(); $('searchInput').focus(); }
        }
        e.preventDefault();
      } else if (k === KEY.OK && searchInResults) {
        activateSearchResult(searchFocus);
        e.preventDefault();
      }
      return;   // everything else belongs to the on-screen keyboard
    }

    if (zone === 'sleep') {
      if (k === KEY.LEFT) focusSleepPill(sleepFocus - 1);
      else if (k === KEY.RIGHT) focusSleepPill(sleepFocus + 1);
      else if (k === KEY.OK) activateSleepPill(sleepFocus);
      else if (k === KEY.BACK || k === KEY.ESC) closeSleepOverlay();
      else return;
      e.preventDefault();
      return;
    }

    if (zone === 'folder') {
      if (k === KEY.LEFT) focusFolder(folderFocus - 1);
      else if (k === KEY.RIGHT) focusFolder(folderFocus + 1);
      else if (k === KEY.UP) focusFolder(folderFocus - 4);
      else if (k === KEY.DOWN) focusFolder(folderFocus + 4);
      else if (k === KEY.OK) {
        var ft = folderTiles[folderFocus];
        if (ft) { closeFolder(); launch(ft.app.id, ft.app.title); }
      } else if (k === KEY.BACK || k === KEY.ESC) closeFolder();
      else return;
      e.preventDefault();
      return;
    }

    if (!editing && k === KEY.RED) { openSearch(); e.preventDefault(); return; }
    if (!editing && k === KEY.GREEN) { openSleepOverlay(); e.preventDefault(); return; }

    if (k === KEY.OK && okDown) { e.preventDefault(); return; }   // key repeat while held
    if (k === KEY.OK) okDown = true;
    if (editing) {
      if (k === KEY.LEFT) moveTo(focused - 1);
      else if (k === KEY.RIGHT) moveTo(focused + 1);
      else if (k === KEY.UP) moveTo(focused - COLUMNS);
      else if (k === KEY.DOWN) moveTo(Math.min(focused + COLUMNS, items.length - 1));
      else if (k === KEY.OK) finishEdit(true);
      else if (k === KEY.BACK || k === KEY.ESC) finishEdit(false);
      else return;
    } else if (zone === 'inputs') {
      if (k === KEY.UP) focusInput(inputFocus - 1);
      else if (k === KEY.DOWN) focusInput(inputFocus + 1);
      else if (k === KEY.OK) { var row = inputRows[inputFocus]; hideInputs(); launch(row.appId, row.label); }
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.LEFT || k === KEY.RIGHT) hideInputs();
      else return;
    } else if (zone === 'top') {
      if (k === KEY.LEFT) focusPill(pillFocus - 1);
      else if (k === KEY.RIGHT) focusPill(pillFocus + 1);
      else if (k === KEY.DOWN) focusTile(rowOf(focused) === 0 ? focused : 0);
      else if (k === KEY.OK) activatePill(pillFocus);
      else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    } else {
      var col = focused % COLUMNS, last = items.length - 1;
      if (k === KEY.LEFT) { if (col > 0) focusTile(focused - 1); }
      else if (k === KEY.RIGHT) { if (col < COLUMNS - 1 && focused < last) focusTile(focused + 1); }
      else if (k === KEY.UP) {
        if (rowOf(focused) === 0) focusPill(pillAbove(focused));
        else focusTile(focused - COLUMNS);
      } else if (k === KEY.DOWN) {
        if (rowOf(focused) < rowOf(last)) focusTile(Math.min(focused + COLUMNS, last));
      } else if (k === KEY.OK) {
        okTimer = setTimeout(function () { okTimer = null; startEdit(); }, LONG_PRESS_MS);
      } else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    }
    e.preventDefault();
  });

  pills.forEach(function (p, i) {
    p.addEventListener('mouseover', function () { if (zone !== 'inputs') focusPill(i); });
    p.addEventListener('click', function () { activatePill(i); });
  });

  $('searchInput').addEventListener('input', function () {
    filterSearch(this.value);
    noteActivity();
  });

  ['mousemove', 'mousedown', 'touchstart'].forEach(function (evt) {
    document.addEventListener(evt, noteActivity, true);
  });

  // ---- lifecycle -----------------------------------------------------------------------------

  function closeAllOverlays() {
    if (folderOpen) {
      if (folderTiles[folderFocus]) folderTiles[folderFocus].el.classList.remove('focused');
      $('folderOverlay').classList.add('hidden');
      $('folderGrid').innerHTML = '';
      folderOpen = null;
      folderTiles = [];
    }
    $('searchOverlay').classList.add('hidden');
    $('searchInput').blur();
    $('searchResults').innerHTML = '';
    searchMatches = [];
    if (sleepPills[sleepFocus]) sleepPills[sleepFocus].el.classList.remove('focused');
    $('sleepOverlay').classList.add('hidden');
    panel.classList.add('hidden');
    pills.forEach(function (p) { p.classList.remove('focused'); });
  }

  /** Back from another app (or opened again from the shortcut): replay the entrance, keep the tile. */
  function resume() {
    if (editing) finishEdit(false);
    closeAllOverlays();
    updateClock();
    hideNowPlaying();

    // No custom order: the app we just launched should move into the first grid row (Recent).
    var currentId = items[focused] ? items[focused].app.id : null;
    var recentSignature = loadRecent().join(',');
    if (!loadOrder() && recentSignature !== lastRecentSignature) {
      lastRecentSignature = recentSignature;
      build();
      focused = 0;
      for (var i = 0; i < items.length; i++) {
        if (items[i].app.id === currentId) { focused = i; break; }
      }
    }

    zone = 'none';
    animateIn();
    focusTile(focused);
    noteActivity();
  }

  document.addEventListener('webOSRelaunch', resume);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resume(); });

  applyTheme();
  build();
  lastRecentSignature = loadRecent().join(',');
  updateClock();
  setInterval(updateClock, 10000);
  watchNetwork();
  watchVolume();
  watchMedia();
  watchWeather();
  connectCompanion();
  animateIn();
  zone = 'none';
  focusTile(0);
  noteActivity();
})();

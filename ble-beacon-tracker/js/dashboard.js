/* =============================================================================
 * dashboard.js
 * -----------------------------------------------------------------------------
 * Everything in the sidebar and the viewport overlays:
 *   - buttons, mode switch, manual-movement pad, sliders and check boxes
 *   - RSSI cards, position read-outs and statistics
 *   - the live 2-D floor plan (with trails) and the RSSI history chart
 *
 * The dashboard never changes the simulation itself. User actions are passed
 * on through the `handlers` object that main.js supplies to Dashboard.init().
 * ========================================================================== */

const Dashboard = (function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const cssColor = function (n) { return '#' + n.toString(16).padStart(6, '0'); };

  const ALGORITHM_TEXT = {
    'linear': 'Solves the circle equations of all three beacons together as a linear least-squares problem. Fast, but sensitive to noisy distances.',
    'gauss-newton': 'Starts from the linear solution and iteratively minimises the weighted range error. Usually the most accurate option.',
    'centroid': 'Averages the beacon positions, giving nearer beacons more weight. Very stable, but biased towards the middle of the beacon triangle.'
  };

  let handlers = null;
  const rows = [];            // DOM references of the three beacon cards
  const el = {};              // other DOM references
  let lastReading = null;     // kept so canvases can be redrawn after a resize
  let lastState = null;

  /* ===========================================================================
   * Initialisation
   * ========================================================================= */

  function init(h) {
    handlers = h;

    // Cache the elements that are updated often
    ['status-pill', 'btn-start', 'btn-pause', 'btn-reset', 'mode-auto', 'mode-manual', 'manual-box',
     'st-estx', 'st-estz', 'st-truex', 'st-truez', 'st-err', 'st-nearest', 'st-roomest', 'st-roomtrue',
     'st-samples', 'st-meanerr', 'st-roomacc', 'minimap', 'rssi-chart', 'cam-reset',
     'view-hint', 'sel-algo', 'algo-desc', 'beacon-rows', 'sel-path', 'sel-quality',
     'caption', 'cap-title', 'cap-sub', 'toast', 'fps-chip'
    ].forEach(function (id) { el[id] = $(id); });

    buildBeaconRows();
    bindControlButtons();
    bindSliders();
    bindOptions();
    bindManualPad();
    bindCameraButtons();
    bindPathAndQuality();

    // Redraw the canvases when their size changes
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(function () { redrawCanvases(); });
      ro.observe(el['minimap']);
      ro.observe(el['rssi-chart']);
    }
    updateAlgorithmText();
  }

  /* One card per beacon, built from the BEACONS list in config.js. */
  function buildBeaconRows() {
    BEACONS.forEach(function (b, i) {
      const root = document.createElement('div');
      root.className = 'beacon-row';
      root.style.setProperty('--c', cssColor(b.color));
      root.innerHTML =
        '<div class="beacon-top">' +
          '<span class="beacon-name">' + b.name + '<small>at (' + b.x + ', ' + b.z + ') m</small></span>' +
          '<span class="beacon-rssi">-- dBm</span>' +
        '</div>' +
        '<div class="bar"><i></i></div>' +
        '<div class="beacon-sub">waiting for first scan</div>' +
        '<div class="beacon-sub2"><span class="bstatus">idle</span><span class="bnoise"></span></div>';
      el['beacon-rows'].appendChild(root);
      rows[i] = {
        root: root,
        rssi: root.querySelector('.beacon-rssi'),
        bar: root.querySelector('.bar > i'),
        sub: root.querySelector('.beacon-sub'),
        status: root.querySelector('.bstatus'),
        noise: root.querySelector('.bnoise')
      };
    });
  }

  function bindControlButtons() {
    el['btn-start'].addEventListener('click', function () { handlers.onStart(); });
    el['btn-pause'].addEventListener('click', function () { handlers.onPause(); });
    el['btn-reset'].addEventListener('click', function () { handlers.onReset(); });
    el['mode-auto'].addEventListener('click', function () { handlers.onMode('auto'); });
    el['mode-manual'].addEventListener('click', function () { handlers.onMode('manual'); });
  }

  /* Range sliders: the data-param attribute names the key inside `params`. */
  function bindSliders() {
    document.querySelectorAll('input[type="range"][data-param]').forEach(function (input) {
      const key = input.dataset.param;
      const unit = input.dataset.unit || '';
      const decimals = parseInt(input.dataset.decimals || '0', 10);
      const output = input.closest('.slider').querySelector('output');

      input.value = params[key];                                  // start from the value in config.js
      output.textContent = Number(params[key]).toFixed(decimals) + unit;

      input.addEventListener('input', function () {
        params[key] = parseFloat(input.value);
        output.textContent = params[key].toFixed(decimals) + unit;
        handlers.onParam(key);
      });
      input.addEventListener('change', function () { input.blur(); });  // keep arrow keys free for manual mode
    });

    el['sel-algo'].value = params.algorithm;
    el['sel-algo'].addEventListener('change', function () {
      params.algorithm = el['sel-algo'].value;
      updateAlgorithmText();
      handlers.onParam('algorithm');
      el['sel-algo'].blur();
    });
  }

  function updateAlgorithmText() {
    el['algo-desc'].textContent = ALGORITHM_TEXT[params.algorithm] || '';
  }

  function bindOptions() {
    document.querySelectorAll('input[type="checkbox"][data-option]').forEach(function (box) {
      handlers.onOption(box.dataset.option, box.checked);         // apply the initial state
      box.addEventListener('change', function () {
        handlers.onOption(box.dataset.option, box.checked);
        redrawCanvases();
        box.blur();
      });
    });
  }

  /* On-screen arrow pad (works with mouse and touch). */
  function bindManualPad() {
    document.querySelectorAll('.dpad button').forEach(function (btn) {
      const dir = btn.dataset.dir;
      const press = function (e) { e.preventDefault(); btn.classList.add('down'); handlers.onDirection(dir, true); };
      const release = function () { btn.classList.remove('down'); handlers.onDirection(dir, false); };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('pointercancel', release);
    });
  }

  /* Camera dock: every button carries data-shot="overview|top|orbit|indoor|corridor|beacons|follow|tour". */
  function bindCameraButtons() {
    document.querySelectorAll('[data-shot]').forEach(function (btn) {
      btn.addEventListener('click', function () { handlers.onShot(btn.dataset.shot); btn.blur(); });
    });
    el['cam-reset'].addEventListener('click', function () { handlers.onResetView(); el['cam-reset'].blur(); });
  }

  /* Test-path selector (built from PATHS in config.js) and render-quality selector. */
  function bindPathAndQuality() {
    Object.keys(PATHS).forEach(function (key) {
      const o = document.createElement('option');
      o.value = key; o.textContent = PATHS[key].name;
      el['sel-path'].appendChild(o);
    });
    el['sel-path'].value = DEFAULT_PATH;
    el['sel-path'].addEventListener('change', function () { handlers.onPath(el['sel-path'].value); el['sel-path'].blur(); });
    el['sel-quality'].addEventListener('change', function () { handlers.onQuality(el['sel-quality'].value); el['sel-quality'].blur(); });
  }

  let captionTimer = 0, toastTimer = 0;

  /* Called by the 3D viewer whenever the camera shot changes (button, tour or free-camera interrupt). */
  function setShot(name, info, touring) {
    const key = (name.indexOf('beacon') === 0) ? 'beacons' : name;
    document.querySelectorAll('[data-shot]').forEach(function (b) {
      const on = touring ? (b.dataset.shot === 'tour') : (b.dataset.shot === key);
      b.classList.toggle('active', on);
    });
    const hints = {
      overview: 'Drag to orbit. Scroll to zoom. Right-drag to pan.',
      top: 'Scroll to zoom. Drag to pan.',
      follow: 'Auto-follows the avatar. Drag to look around, scroll to zoom.',
      free: 'Free camera. Drag, scroll and right-drag to move.'
    };
    el['view-hint'].textContent = touring ? 'Cinematic tour running. Drag or scroll to take control.'
      : (hints[name] || (info.mode === 'scripted' ? 'Automatic shot. Drag or scroll to take control.' : 'Drag to orbit. Scroll to zoom. Right-drag to pan.'));
    if (name === 'free' || !info.label) return;
    el['cap-title'].textContent = info.label;
    el['cap-sub'].textContent = info.sub || '';
    el['caption'].classList.remove('show'); void el['caption'].offsetWidth; el['caption'].classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(function () { el['caption'].classList.remove('show'); }, 3800);
  }

  /* Called when the strongest beacon changes (simulated coverage handoff). */
  function showHandoff(from, to) {
    el['toast'].textContent = 'Coverage handoff: ' + BEACONS[from].id + ' to ' + BEACONS[to].id + ' (simulated)';
    el['toast'].style.setProperty('--c', cssColor(BEACONS[to].color));
    el['toast'].classList.remove('show'); void el['toast'].offsetWidth; el['toast'].classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el['toast'].classList.remove('show'); }, 2600);
  }

  function setFps(fps) { el['fps-chip'].textContent = Math.round(fps) + ' fps'; }

  /* ===========================================================================
   * State display
   * ========================================================================= */

  function setStatus(status) {
    const pill = el['status-pill'];
    pill.className = 'pill ' + (status === 'running' ? 'running' : status === 'paused' ? 'paused' : 'idle');
    pill.textContent = status === 'running' ? 'Running' : status === 'paused' ? 'Paused' : 'Ready';
    el['btn-start'].disabled = (status === 'running');
    el['btn-start'].textContent = (status === 'paused') ? 'Resume' : 'Start';
    el['btn-pause'].disabled = (status !== 'running');
  }

  function setMode(mode) {
    el['mode-auto'].classList.toggle('active', mode === 'auto');
    el['mode-manual'].classList.toggle('active', mode === 'manual');
    el['manual-box'].hidden = (mode !== 'manual');
  }

  /* ===========================================================================
   * Read-outs (called after every simulated BLE scan)
   * ========================================================================= */

  function update(r, state) {
    lastReading = r;
    lastState = state;

    // --- RSSI cards ---
    r.beacons.forEach(function (b, i) {
      rows[i].rssi.textContent = b.raw + ' dBm';
      rows[i].bar.style.width = clamp((b.filtered + 100) / 60 * 100, 0, 100).toFixed(0) + '%';
      rows[i].sub.textContent = 'filtered ' + b.filtered.toFixed(1) + ' dBm | est. ' +
        b.estD2.toFixed(1) + ' m | true ' + b.trueD2.toFixed(1) + ' m';
      rows[i].root.classList.toggle('nearest', i === r.nearest);
      rows[i].status.textContent = (i === r.nearest) ? 'strongest' : (b.filtered < -88 ? 'weak' : 'active');
      rows[i].status.className = 'bstatus ' + ((i === r.nearest) ? 'top' : (b.filtered < -88 ? 'weak' : 'ok'));
      rows[i].noise.textContent = 'noise ' + (b.noise >= 0 ? '+' : '') + b.noise.toFixed(1) + ' dB (simulated)';
    });

    // --- Position read-outs ---
    el['st-estx'].textContent = r.est.x.toFixed(2) + ' m';
    el['st-estz'].textContent = r.est.z.toFixed(2) + ' m';
    el['st-truex'].textContent = r.truth.x.toFixed(2) + ' m';
    el['st-truez'].textContent = r.truth.z.toFixed(2) + ' m';
    el['st-err'].textContent = r.error.toFixed(2) + ' m';
    el['st-nearest'].textContent = BEACONS[r.nearest].name;

    const match = (r.roomEst.id === r.roomTrue.id);
    el['st-roomest'].innerHTML = r.roomEst.name + ' <span class="' + (match ? 'ok' : 'bad') + '">' + (match ? '(correct)' : '(wrong)') + '</span>';
    el['st-roomtrue'].textContent = r.roomTrue.name;

    // --- Running statistics ---
    const s = state.stats;
    el['st-samples'].textContent = s.n;
    el['st-meanerr'].textContent = s.n ? (s.errSum / s.n).toFixed(2) + ' m' : '-';
    el['st-roomacc'].textContent = s.n ? (100 * s.roomHits / s.n).toFixed(0) + ' %' : '-';

    redrawCanvases();
  }

  /* ===========================================================================
   * Canvas drawing helpers
   * ========================================================================= */

  /* Matches the canvas bitmap to its CSS size and device pixel ratio. */
  function fitCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function redrawCanvases() {
    drawMinimap();
    drawChart();
  }

  /* Live 2-D floor plan with beacons, trails and both position markers. */
  function drawMinimap() {
    const c = fitCanvas(el['minimap']);
    const ctx = c.ctx;
    if (!c.w || !c.h) return;

    const pad = 10;
    const s = Math.min((c.w - 2 * pad) / BUILDING.width, (c.h - 2 * pad) / BUILDING.depth);
    const ox = (c.w - BUILDING.width * s) / 2;
    const oy = (c.h - BUILDING.depth * s) / 2;
    const X = function (x) { return ox + x * s; };
    const Z = function (z) { return oy + z * s; };

    ctx.clearRect(0, 0, c.w, c.h);

    // Rooms and their names
    ROOMS.forEach(function (room) {
      ctx.fillStyle = 'rgba(' + ((room.color >> 16) & 255) + ',' + ((room.color >> 8) & 255) + ',' + (room.color & 255) + ',0.2)';
      ctx.fillRect(X(room.x1), Z(room.z1), (room.x2 - room.x1) * s, (room.z2 - room.z1) * s);
      ctx.fillStyle = 'rgba(200,214,238,0.75)';
      ctx.font = '600 ' + Math.max(9, s * 0.42) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ty = room.row === 'top' ? room.z1 + 0.8 : room.row === 'bottom' ? room.z2 - 0.8 : (room.z1 + room.z2) / 2;
      ctx.fillText(room.name, X((room.x1 + room.x2) / 2), Z(ty));
    });

    // Walls
    ctx.fillStyle = '#7d8fb0';
    WALL_PIECES.forEach(function (p) {
      ctx.fillRect(X(p.x1), Z(p.z1), (p.x2 - p.x1) * s, (p.z2 - p.z1) * s);
    });

    const reading = lastReading;
    const state = lastState;

    // Estimated-distance circles (one per beacon)
    const showCircles = document.querySelector('input[data-option="showCircles"]').checked;
    if (reading && showCircles) {
      ctx.lineWidth = 1.2;
      BEACONS.forEach(function (b, i) {
        ctx.strokeStyle = cssColor(b.color);
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(X(b.x), Z(b.z), reading.beacons[i].estD2 * s, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // Trails (true = yellow, estimated = pink)
    const showTrail = document.querySelector('input[data-option="showTrail"]').checked;
    if (state && showTrail) {
      drawPath(ctx, state.trailTrue, X, Z, 'rgba(250,204,21,0.8)', 1.6);
      drawPath(ctx, state.trailEst, X, Z, 'rgba(232,121,249,0.85)', 1.4);
    }

    // Beacons
    BEACONS.forEach(function (b) {
      ctx.fillStyle = cssColor(b.color);
      ctx.beginPath();
      ctx.arc(X(b.x), Z(b.z), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0a1120';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 10px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(b.id, X(b.x) + 8, Z(b.z) - 7);
    });

    // True and estimated position markers
    if (reading) {
      // Error vector between the two
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(reading.truth.x), Z(reading.truth.z));
      ctx.lineTo(X(reading.est.x), Z(reading.est.z));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#facc15';                       // true position: filled dot
      ctx.strokeStyle = '#0a1120';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(X(reading.truth.x), Z(reading.truth.z), 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#e879f9';                     // estimated position: ring with cross
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(reading.est.x), Z(reading.est.z), 6.5, 0, Math.PI * 2);
      ctx.moveTo(X(reading.est.x) - 9, Z(reading.est.z));
      ctx.lineTo(X(reading.est.x) + 9, Z(reading.est.z));
      ctx.moveTo(X(reading.est.x), Z(reading.est.z) - 9);
      ctx.lineTo(X(reading.est.x), Z(reading.est.z) + 9);
      ctx.stroke();
    }
  }

  function drawPath(ctx, points, X, Z, color, width) {
    if (!points || points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(X(points[0].x), Z(points[0].z));
    for (let i = 1; i < points.length; i++) ctx.lineTo(X(points[i].x), Z(points[i].z));
    ctx.stroke();
  }

  /* RSSI history chart: raw readings of all three beacons, last 100 scans (20 s). */
  function drawChart() {
    const c = fitCanvas(el['rssi-chart']);
    const ctx = c.ctx;
    if (!c.w || !c.h) return;

    const left = 38, right = 10, top = 22, bottom = 8;
    const pw = c.w - left - right, ph = c.h - top - bottom;
    const yMin = -100, yMax = -30;
    const Y = function (v) { return top + (yMax - v) / (yMax - yMin) * ph; };

    ctx.clearRect(0, 0, c.w, c.h);

    // Grid lines and dBm labels
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    [-40, -55, -70, -85, -100].forEach(function (v) {
      ctx.strokeStyle = '#1c2b4a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, Y(v));
      ctx.lineTo(left + pw, Y(v));
      ctx.stroke();
      ctx.fillStyle = '#7f93b5';
      ctx.fillText(v, left - 6, Y(v));
    });

    // Legend
    ctx.textAlign = 'left';
    BEACONS.forEach(function (b, i) {
      ctx.fillStyle = cssColor(b.color);
      ctx.fillRect(left + i * 62, 6, 10, 3);
      ctx.fillStyle = '#c3d0e6';
      ctx.fillText(b.id, left + i * 62 + 15, 8);
    });
    ctx.fillStyle = '#7f93b5';
    ctx.textAlign = 'right';
    ctx.fillText('dBm', c.w - right, 8);

    if (!lastState) return;
    const maxPts = 100;
    BEACONS.forEach(function (b, i) {
      const data = lastState.history[i].slice(-maxPts);
      if (data.length < 2) return;
      ctx.strokeStyle = cssColor(b.color);
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach(function (v, k) {
        const x = left + (k / (maxPts - 1)) * pw;
        if (k === 0) ctx.moveTo(x, Y(v)); else ctx.lineTo(x, Y(v));
      });
      ctx.stroke();
    });
  }

  return {
    init: init,
    update: update,
    setStatus: setStatus,
    setMode: setMode,
    redraw: redrawCanvases,
    setShot: setShot,
    showHandoff: showHandoff,
    setFps: setFps
  };
})();

/* =============================================================================
 * main.js
 * -----------------------------------------------------------------------------
 * The simulation itself: it owns the state, moves the person, takes simulated
 * BLE scans five times per second, runs the positioning algorithm and passes
 * the results on to the 3D viewer (scene.js) and the dashboard (dashboard.js).
 *
 * Reminder: all RSSI data is produced by the model in ble-model.js. No real
 * Bluetooth hardware is accessed anywhere in this project.
 * ========================================================================== */

(function () {
  'use strict';

  /* Stop early with a clear message if the Three.js libraries could not be loaded. */
  if (!window.THREE || !THREE.OrbitControls) {
    document.getElementById('canvas-host').innerHTML =
      '<p style="padding:24px;color:#fca5a5">Three.js could not be loaded. Make sure the files in ' +
      '<b>js/lib</b> exist (three.min.js and OrbitControls.js) or connect to the internet once.</p>';
    return;
  }

  /* ===========================================================================
   * Simulation state
   * ========================================================================= */
  const state = {
    status: 'idle',                 // 'idle' | 'running' | 'paused'
    mode: 'auto',                   // 'auto' (patrol route) | 'manual' (keyboard / buttons)
    person: { x: 0, z: 0, heading: 0 },
    moving: false,                  // true while the person is walking (for the walking animation)
    pathKey: DEFAULT_PATH,          // selected test path (see PATHS in config.js)
    wpIndex: 1,                     // index of the waypoint the walker is heading to
    dwell: 0,                       // remaining pause time at a waypoint (s)
    sampleAcc: 0,                   // time accumulated towards the next BLE scan (s)
    smoothed: [null, null, null],   // filtered RSSI per beacon (EMA state)
    history: [[], [], []],          // raw RSSI per beacon, for the chart
    trailTrue: [],                  // true positions {x, z}
    trailEst: [],                   // estimated positions {x, z}
    stats: { n: 0, errSum: 0, roomHits: 0 },
    keys: { up: false, down: false, left: false, right: false }
  };

  /* ===========================================================================
   * Collision handling (manual mode)
   * ========================================================================= */

  /* True if a person standing at (x, z) would overlap a wall or leave the building. */
  function collides(x, z) {
    const r = SIM.personRadius;
    if (x < r || x > BUILDING.width - r || z < r || z > BUILDING.depth - r) return true;
    for (let i = 0; i < WALL_PIECES.length; i++) {
      const w = WALL_PIECES[i];
      if (x > w.x1 - r && x < w.x2 + r && z > w.z1 - r && z < w.z2 + r) return true;
    }
    for (let i = 0; i < FURNITURE_BLOCKS.length; i++) {      // desks, shelves, racks, tables ...
      const f = FURNITURE_BLOCKS[i];
      if (x > f.x1 - r && x < f.x2 + r && z > f.z1 - r && z < f.z2 + r) return true;
    }
    return false;
  }

  /* Waypoints of the currently selected test path. */
  function pathPoints() { return PATHS[state.pathKey].points; }

  /* Moves by (dx, dz); each axis is tried separately so the person slides along walls. */
  function tryMove(dx, dz) {
    const p = state.person;
    if (!collides(p.x + dx, p.z)) p.x += dx;
    if (!collides(p.x, p.z + dz)) p.z += dz;
  }

  /* True if the straight line between two points is free of walls. */
  function lineIsClear(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.1));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (collides(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /* When the walker is switched back to automatic mode, it continues with the
   * nearest waypoint that it can reach without crossing a wall. */
  function pickNearestWaypoint() {
    const p = state.person;
    let best = -1, bestDist = Infinity, fallback = 0, fallbackDist = Infinity;
    pathPoints().forEach(function (w, i) {
      const d = Math.hypot(w[0] - p.x, w[1] - p.z);
      if (d < fallbackDist) { fallbackDist = d; fallback = i; }
      if (d < bestDist && lineIsClear(p.x, p.z, w[0], w[1])) { bestDist = d; best = i; }
    });
    state.wpIndex = (best >= 0) ? best : fallback;
    state.dwell = 0;
  }

  /* ===========================================================================
   * Movement
   * ========================================================================= */

  function updateMovement(dt) {
    const p = state.person;
    state.moving = false;

    if (state.mode === 'auto') {
      // Pause at the end of a visit so the readings can settle
      if (state.dwell > 0) { state.dwell -= dt; return; }

      const wp = pathPoints()[state.wpIndex];
      const dx = wp[0] - p.x, dz = wp[1] - p.z;
      const dist = Math.hypot(dx, dz);
      const step = params.speed * dt;

      if (dist <= step) {                                   // waypoint reached
        p.x = wp[0];
        p.z = wp[1];
        state.dwell = wp[2] || 0;
        state.wpIndex = (state.wpIndex + 1) % pathPoints().length;
      } else {
        p.x += dx / dist * step;
        p.z += dz / dist * step;
        p.heading = Math.atan2(dx, dz);
        state.moving = true;
      }
    } else {
      // Manual mode: W/A/S/D, arrow keys or the on-screen pad
      const ix = (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0);
      const iz = (state.keys.down ? 1 : 0) - (state.keys.up ? 1 : 0);
      if (ix !== 0 || iz !== 0) {
        const len = Math.hypot(ix, iz);
        const step = params.speed * dt;
        tryMove(ix / len * step, iz / len * step);
        p.heading = Math.atan2(ix, iz);
        state.moving = true;
      }
    }
  }

  /* ===========================================================================
   * One simulated BLE scan report
   * ---------------------------------------------------------------------------
   * commit = true : the reading becomes part of the history (filter, trails, statistics)
   * commit = false: only a preview for the dashboard (used while paused or after a
   *                 slider change) - nothing is stored.
   * ========================================================================= */
  function takeScan(commit, snapMarker) {
    const p = state.person;
    const heightDiff = SIM.beaconHeight - SIM.receiverHeight;

    // 1-4. For each beacon: true distance -> simulated RSSI -> filter -> distance estimate
    const perBeacon = BEACONS.map(function (b, i) {
      const dx = p.x - b.x, dz = p.z - b.z;
      const trueD2 = Math.hypot(dx, dz);                           // floor distance
      const trueD3 = Math.sqrt(trueD2 * trueD2 + heightDiff * heightDiff);   // radio distance

      const raw = BleModel.measure(trueD3);                        // simulated, noisy RSSI (dBm)
      const filtered = BleModel.smooth(state.smoothed[i], raw);    // smoothed RSSI
      const estD3 = BleModel.rssiToDistance(filtered);             // distance from the RSSI
      const estD2 = BleModel.toFloorDistance(estD3);               // horizontal part

      // Realised measurement noise (dB) = reading minus the noise-free model value
      const noise = raw - BleModel.meanRssi(trueD3);
      // Unfiltered distance estimate from this single raw reading (shown as the "noise cloud" in 3D)
      const rawD2 = BleModel.toFloorDistance(BleModel.rssiToDistance(raw));

      return { raw: raw, filtered: filtered, trueD2: trueD2, estD2: estD2, noise: noise, rawD2: rawD2 };
    });

    // 5. Position from the three estimated floor distances
    const est = Positioning.estimate(params.algorithm, BEACONS, perBeacon.map(function (b) { return b.estD2; }));
    const estRaw = Positioning.estimate(params.algorithm, BEACONS, perBeacon.map(function (b) { return b.rawD2; }));

    // Nearest beacon = strongest filtered RSSI
    let nearest = 0;
    perBeacon.forEach(function (b, i) { if (b.filtered > perBeacon[nearest].filtered) nearest = i; });

    const reading = {
      beacons: perBeacon,
      est: est,
      estRaw: estRaw,
      committed: commit,
      truth: { x: p.x, z: p.z },
      error: Math.hypot(est.x - p.x, est.z - p.z),
      nearest: nearest,
      roomEst: findRoom(est.x, est.z),
      roomTrue: findRoom(p.x, p.z)
    };

    if (commit) {
      perBeacon.forEach(function (b, i) {
        state.smoothed[i] = b.filtered;
        state.history[i].push(b.raw);
        if (state.history[i].length > 200) state.history[i].shift();
      });
      pushTrailPoint(state.trailTrue, p.x, p.z, 'true');
      pushTrailPoint(state.trailEst, est.x, est.z, 'est');

      state.stats.n++;
      state.stats.errSum += reading.error;
      if (reading.roomEst.id === reading.roomTrue.id) state.stats.roomHits++;
    }

    Viewer.setReading(reading, snapMarker);
    Dashboard.update(reading, state);
  }

  function pushTrailPoint(list, x, z, kind) {
    list.push({ x: x, z: z });
    if (list.length > SIM.maxTrailPoints) list.shift();
    Viewer.pushTrail(kind, x, z);
  }

  /* ===========================================================================
   * Control handlers (called by the dashboard)
   * ========================================================================= */

  function setStatus(s) {
    state.status = s;
    Dashboard.setStatus(s);
  }

  /* Puts everything back to the start position and clears all history. */
  function resetSimulation() {
    const start = pathPoints()[0];
    state.person.x = start[0];
    state.person.z = start[1];
    state.person.heading = Math.PI / 2;
    state.moving = false;
    state.wpIndex = 1;
    state.dwell = 0;
    state.sampleAcc = 0;
    state.smoothed = [null, null, null];
    state.history = [[], [], []];
    state.trailTrue = [];
    state.trailEst = [];
    state.stats = { n: 0, errSum: 0, roomHits: 0 };
    Viewer.clearTrails();
    Viewer.resetFx();
    setStatus('idle');
    takeScan(false, true);                  // preview so the dashboard is not empty
  }

  const handlers = {
    onStart: function () { setStatus('running'); },
    onPause: function () { setStatus('paused'); },
    onReset: resetSimulation,

    onMode: function (mode) {
      state.mode = mode;
      state.keys = { up: false, down: false, left: false, right: false };
      if (mode === 'auto') pickNearestWaypoint();
      Dashboard.setMode(mode);
    },

    /* A slider or the algorithm selector changed. */
    onParam: function (key) {
      // A new radio model invalidates the filter history.
      if (key === 'txPower' || key === 'pathLossExp') state.smoothed = [null, null, null];
      // While not running, show the effect immediately (preview only).
      if (state.status !== 'running' && key !== 'speed') takeScan(false, false);
    },

    /* Selecting a test path restarts the walk on that path (and keeps running if it was running). */
    onPath: function (key) {
      if (!PATHS[key]) return;
      const wasRunning = state.status === 'running';
      state.pathKey = key;
      resetSimulation();
      if (state.mode === 'auto' && wasRunning) setStatus('running');
    },

    onShot: function (name) {
      if (name === 'tour') {                      // the cinematic tour needs motion: start the walk if idle
        if (Viewer.isTouring()) { Viewer.stopTour(); return; }
        if (state.status !== 'running') setStatus('running');
        Viewer.startTour();
      } else {
        Viewer.setShot(name);
      }
    },
    onResetView: function () { Viewer.resetView(); },
    onQuality: function (q) { Viewer.setQuality(q); },
    onOption: function (name, value) { Viewer.setOption(name, value); },
    onDirection: function (dir, down) { if (state.mode === 'manual') state.keys[dir] = down; }
  };

  /* ===========================================================================
   * Keyboard input for manual mode
   * ========================================================================= */
  const KEYMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };

  window.addEventListener('keydown', function (e) {
    const dir = KEYMAP[e.key.toLowerCase()];
    if (!dir || e.target.tagName === 'SELECT' || state.mode !== 'manual') return;
    state.keys[dir] = true;
    e.preventDefault();
  });
  window.addEventListener('keyup', function (e) {
    const dir = KEYMAP[e.key.toLowerCase()];
    if (dir) state.keys[dir] = false;
  });
  window.addEventListener('blur', function () {
    state.keys = { up: false, down: false, left: false, right: false };
  });

  /* ===========================================================================
   * Main loop
   * ========================================================================= */
  let lastTime = performance.now();

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);       // seconds; capped after tab switches
    lastTime = now;

    if (state.status === 'running') {
      updateMovement(dt);

      // BLE scans arrive at a fixed rate, independent of the screen refresh rate
      state.sampleAcc += dt;
      const interval = 1 / SIM.sampleRateHz;
      while (state.sampleAcc >= interval) {
        state.sampleAcc -= interval;
        takeScan(true, false);
      }
    }

    Viewer.setPerson(state.person.x, state.person.z, state.person.heading, state.moving && state.status === 'running');
    Viewer.render(dt, now / 1000);
    requestAnimationFrame(frame);
  }

  /* ===========================================================================
   * Start-up
   * ========================================================================= */
  Viewer.init(document.getElementById('canvas-host'));
  Viewer.onShot = function (name, info, touring) { Dashboard.setShot(name, info, touring); };
  Viewer.onHandoff = function (from, to) { Dashboard.showHandoff(from, to); };
  Dashboard.init(handlers);
  Dashboard.setMode(state.mode);
  Dashboard.setShot('overview', { label: 'Aerial overview', sub: 'Architectural digital twin' }, false);
  resetSimulation();
  setInterval(function () { Dashboard.setFps(Viewer.getFps()); }, 700);
  requestAnimationFrame(frame);
})();

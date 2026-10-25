/* =============================================================================
 * campus-main.js
 * Simulation orchestrator: moves the demo walker, takes simulated BLE scans,
 * drives the attendance engine, and updates the 3D viewer and dashboard.
 *
 * All RSSI values are mathematical simulation – no Bluetooth hardware used.
 * ========================================================================== */

(function () {
  'use strict';

  if (!window.THREE || !THREE.OrbitControls) {
    document.getElementById('canvas-host').innerHTML =
      '<p style="padding:24px;color:#fca5a5">Three.js could not be loaded. ' +
      'Ensure js/lib/three.min.js and OrbitControls.js exist or connect to the internet.</p>';
    return;
  }

  /* =========================================================================
   * Simulation state
   * ======================================================================= */
  const state = {
    status: 'idle',
    sampleAcc: 0,
    smoothed: [],           // [null] * n_beacons (EMA state)
    history: [],            // [[]] * n_beacons
    trailTrue: [],
    trailEst: [],
    stats: { n: 0, errSum: 0, roomHits: 0 },
    keys: { up: false, down: false, left: false, right: false },
    person: { x: 4.5, z: 11.5, heading: 0 }, // walk in corridor by default
    moving: false,
    simSpeed: 30,  // sim-minutes per real second
    wpIndex: 0
  };

  // Initialize per-beacon arrays
  CAMPUS_BEACONS.forEach(function () {
    state.smoothed.push(null);
    state.history.push([]);
  });

  /* Demo-walker waypoints (patrol the corridor and peek into A101) */
  const WALKER_WAYPOINTS = [
    [2, 11.5], [4, 11.5], [4, 8], [4.5, 5], [4.5, 8], [4, 11.5],
    [13.5, 11.5], [13.5, 8], [13.5, 5], [13.5, 8], [13.5, 11.5],
    [22.5, 11.5], [22.5, 8], [22.5, 5], [22.5, 8], [22.5, 11.5],
    [33.5, 11.5], [33.5, 8], [33.5, 5], [33.5, 8], [33.5, 11.5],
    [33.5, 14], [5, 20], [5, 14], [13.5, 14]
  ];

  function collides(x, z) {
    const r = CAMPUS_SIM.personRadius;
    if (x < r || x > CAMPUS.width - r || z < r || z > CAMPUS.depth - r) return true;
    for (let i = 0; i < CAMPUS_WALL_PIECES.length; i++) {
      const w = CAMPUS_WALL_PIECES[i];
      if (x > w.x1 - r && x < w.x2 + r && z > w.z1 - r && z < w.z2 + r) return true;
    }
    return false;
  }

  function updateMovement(dt) {
    const p = state.person;
    state.moving = false;
    const wp = WALKER_WAYPOINTS[state.wpIndex];
    const dx = wp[0] - p.x, dz = wp[1] - p.z;
    const dist = Math.hypot(dx, dz);
    const step = campusParams.speed * dt;
    if (dist <= step) {
      p.x = wp[0]; p.z = wp[1];
      state.wpIndex = (state.wpIndex + 1) % WALKER_WAYPOINTS.length;
    } else {
      const nx = p.x + dx / dist * step, nz = p.z + dz / dist * step;
      if (!collides(nx, nz)) { p.x = nx; p.z = nz; }
      p.heading = Math.atan2(dx, dz);
      state.moving = true;
    }
  }

  /* =========================================================================
   * BLE scan (one scan for the demo walker, plus per-student updates)
   * ======================================================================= */
  function takeScan(commit) {
    const p = state.person;
    const heightDiff = CAMPUS_SIM.beaconHeight - CAMPUS_SIM.receiverHeight;
    const now = performance.now() / 1000;

    const perBeacon = CAMPUS_BEACONS.map(function (b, i) {
      const dx = p.x - b.x, dz = p.z - b.z;
      const trueD2 = Math.hypot(dx, dz);
      const trueD3 = Math.sqrt(trueD2 * trueD2 + heightDiff * heightDiff);

      // Wall attenuation for the walker
      const walls = wallsBetween(p.x, p.z, b.x, b.z);
      const meanRssi = b.txPower - 10 * (b.pathLoss || campusParams.pathLossExp) * Math.log10(Math.max(trueD3, 0.1));
      const noisyRssi = meanRssi + (Math.random() - 0.5) * 2 * campusParams.noiseStd - walls * campusParams.wallAttenuation;
      const raw = Math.round(clamp(noisyRssi, -100, -30));

      const filtered = BleModel.smooth(state.smoothed[i], raw);
      const estD3 = BleModel.rssiToDistance(filtered);
      const estD2 = BleModel.toFloorDistance(estD3);
      const rawD2 = BleModel.toFloorDistance(BleModel.rssiToDistance(raw));
      const noise = raw - meanRssi;

      return { raw, filtered, trueD2, estD2, rawD2, noise };
    });

    const est = Positioning.estimate(campusParams.algorithm, CAMPUS_BEACONS, perBeacon.map(function (b) { return b.estD2; }));
    const estRaw = Positioning.estimate(campusParams.algorithm, CAMPUS_BEACONS, perBeacon.map(function (b) { return b.rawD2; }));

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
      roomEst: findCampusRoom(est.x, est.z),
      roomTrue: findCampusRoom(p.x, p.z)
    };

    if (commit) {
      perBeacon.forEach(function (b, i) {
        state.smoothed[i] = b.filtered;
        state.history[i].push(b.raw);
        if (state.history[i].length > 200) state.history[i].shift();
      });
      state.trailTrue.push({ x: p.x, z: p.z });
      state.trailEst.push({ x: est.x, z: est.z });
      if (state.trailTrue.length > CAMPUS_SIM.maxTrailPoints) state.trailTrue.shift();
      if (state.trailEst.length > CAMPUS_SIM.maxTrailPoints) state.trailEst.shift();
      state.stats.n++;
      state.stats.errSum += reading.error;
      if (reading.roomEst.id === reading.roomTrue.id) state.stats.roomHits++;
    }

    return reading;
  }

  /* Update all demo students' presence */
  function updateStudentPresences(now) {
    DEMO_STUDENTS.forEach(function (s) {
      AttendanceEngine.updateStudentPresence(s.id, s.seatX, s.seatZ, now);
    });
  }

  /* =========================================================================
   * Main frame loop
   * ======================================================================= */
  let lastTime = performance.now();

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (state.status === 'running') {
      updateMovement(dt);
      AttendanceEngine.tickClock(dt);

      state.sampleAcc += dt;
      const interval = 1 / CAMPUS_SIM.sampleRateHz;
      let reading = null;
      while (state.sampleAcc >= interval) {
        state.sampleAcc -= interval;
        reading = takeScan(true);
        updateStudentPresences(now / 1000);
      }
      if (reading) {
        CampusViewer.setReading(reading);
        CampusDashboard.update(reading, state);
      }
    }

    CampusViewer.setPerson(state.person.x, state.person.z, state.person.heading, state.moving && state.status === 'running');
    CampusViewer.render(dt, now / 1000);
    requestAnimationFrame(frame);
  }

  /* =========================================================================
   * Handlers passed to dashboard
   * ======================================================================= */
  function setStatus(s) {
    state.status = s;
    AttendanceEngine.setRunning(s === 'running');
    CampusDashboard.setStatus(s);
  }

  function resetSimulation() {
    state.person.x = 4.5;
    state.person.z = 11.5;
    state.person.heading = 0;
    state.moving = false;
    state.wpIndex = 0;
    state.sampleAcc = 0;
    state.smoothed = CAMPUS_BEACONS.map(function () { return null; });
    state.history = CAMPUS_BEACONS.map(function () { return []; });
    state.trailTrue = [];
    state.trailEst = [];
    state.stats = { n: 0, errSum: 0, roomHits: 0 };
    CampusViewer.clearTrails();
    CampusViewer.resetFx();
    AttendanceEngine.resetClock();
    setStatus('idle');
    const reading = takeScan(false);
    CampusDashboard.update(reading, state);
  }

  const handlers = {
    onStart:  function () { setStatus('running'); },
    onPause:  function () { setStatus('paused'); },
    onReset:  resetSimulation,
    onShot:   function (name) {
      if (name === 'tour') {
        if (CampusViewer.isTouring()) CampusViewer.stopTour();
        else { if (state.status !== 'running') setStatus('running'); CampusViewer.startTour(); }
      } else { CampusViewer.setShot(name); }
    },
    onNextPeriod: function () {
      AttendanceEngine.advancePeriod();
      CampusDashboard.showToast('Advanced to next period: ' + (AttendanceEngine.activePeriod() || {}).name, 'info');
    },
    onSimSpeed: function (v) {
      state.simSpeed = v;
    },
    onQuality: function (q) { CampusViewer.setQuality(q); },
    onOption: function (name, val) { CampusViewer.setOption(name, val); }
  };

  /* =========================================================================
   * Boot
   * ======================================================================= */
  AttendanceEngine.init();
  CampusViewer.init(document.getElementById('canvas-host'));
  CampusViewer.onShot = function (name, info, touring) { CampusDashboard.setShot(name, info, touring); };
  CampusDashboard.init(handlers);
  CampusDashboard.renderFaceRecogTab();

  resetSimulation();
  CampusViewer.setShot('overview');

  setInterval(function () { CampusDashboard.setFps(CampusViewer.getFps()); }, 700);
  requestAnimationFrame(frame);
})();

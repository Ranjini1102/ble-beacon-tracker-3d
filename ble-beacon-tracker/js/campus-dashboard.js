/* =============================================================================
 * campus-dashboard.js
 * Professional admin dashboard for the Smart Campus Attendance System.
 * White-and-green professional palette with real-time data from the simulation.
 * ========================================================================== */

const CampusDashboard = (function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  let handlers = null;
  let activeTab = 'overview';
  let selectedStudent = null;
  let faceVerifyRunning = false;
  let miniCtx = null, rssiCtx = null;
  let miniCanvas, rssiCanvas;

  /* =========================================================================
   * Init
   * ======================================================================= */
  function init(h) {
    handlers = h;
    renderTabs();
    bindTabs();
    bindControls();
    bindCameraButtons();
    bindStudentPanel();
    renderBeaconManagement();
    renderStudentList();
    renderPeriodBar();
    setStatus('idle');
    miniCanvas = $('db-minimap');
    rssiCanvas = $('db-rssi-chart');
    if (miniCanvas) miniCtx = miniCanvas.getContext('2d');
    if (rssiCanvas) rssiCtx = rssiCanvas.getContext('2d');
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(function () { redrawMinimap(); });
      if (miniCanvas) ro.observe(miniCanvas);
    }
  }

  /* =========================================================================
   * Tabs
   * ======================================================================= */
  function renderTabs() {
    const tabBar = $('tab-bar');
    if (!tabBar) return;
    const tabs = [
      { id: 'overview',   icon: '🏫', label: 'Overview' },
      { id: 'classroom',  icon: '📋', label: 'Classroom' },
      { id: 'students',   icon: '👥', label: 'Students' },
      { id: 'beacons',    icon: '📡', label: 'Beacons' },
      { id: 'library',    icon: '📚', label: 'Library' },
      { id: 'reports',    icon: '📊', label: 'Reports' },
      { id: 'facerecog',  icon: '🎭', label: 'Face ID' }
    ];
    tabBar.innerHTML = tabs.map(function (t) {
      return '<button class="tab-btn' + (t.id === activeTab ? ' active' : '') + '" data-tab="' + t.id + '">' +
             '<span class="tab-icon">' + t.icon + '</span><span class="tab-label">' + t.label + '</span></button>';
    }).join('');
  }

  function bindTabs() {
    const tabBar = $('tab-bar');
    if (!tabBar) return;
    tabBar.addEventListener('click', function (e) {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === activeTab); });
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.toggle('active', p.dataset.pane === activeTab); });
    });
  }

  /* =========================================================================
   * Controls
   * ======================================================================= */
  function bindControls() {
    const start = $('db-btn-start'), pause = $('db-btn-pause'), reset = $('db-btn-reset');
    const nextP = $('db-btn-next-period');
    if (start) start.addEventListener('click', function () { handlers.onStart(); });
    if (pause) pause.addEventListener('click', function () { handlers.onPause(); });
    if (reset) reset.addEventListener('click', function () { handlers.onReset(); });
    if (nextP) nextP.addEventListener('click', function () { handlers.onNextPeriod(); });

    const speedSl = $('db-sim-speed');
    if (speedSl) speedSl.addEventListener('input', function () {
      handlers.onSimSpeed(parseFloat(speedSl.value));
      const out = $('db-sim-speed-out');
      if (out) out.textContent = speedSl.value + 'x';
    });
  }

  function bindCameraButtons() {
    document.querySelectorAll('[data-shot]').forEach(function (btn) {
      btn.addEventListener('click', function () { handlers.onShot(btn.dataset.shot); btn.blur(); });
    });
  }

  /* =========================================================================
   * Student detail panel
   * ======================================================================= */
  function bindStudentPanel() {
    const faceBtn = $('db-face-verify-btn');
    if (faceBtn) {
      faceBtn.addEventListener('click', function () {
        if (!selectedStudent || faceVerifyRunning) return;
        runFaceVerify(selectedStudent);
      });
    }
    const punchBtn = $('db-punch-btn');
    if (punchBtn) {
      punchBtn.addEventListener('click', function () {
        if (!selectedStudent) return;
        const result = AttendanceEngine.punchIn(selectedStudent, Date.now() / 1000);
        showToast(result.msg, result.ok ? 'success' : 'error');
        updateStudentDetail(selectedStudent);
      });
    }
  }

  function selectStudent(studentId) {
    selectedStudent = studentId;
    document.querySelectorAll('.student-row').forEach(function (r) {
      r.classList.toggle('selected', r.dataset.studentId === studentId);
    });
    updateStudentDetail(studentId);
    // Switch to students tab
    activeTab = 'students';
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === 'students'); });
    document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.toggle('active', p.dataset.pane === 'students'); });
  }

  function updateStudentDetail(studentId) {
    const panel = $('db-student-detail');
    if (!panel) return;
    const report = AttendanceEngine.getStudentReport(studentId);
    if (!report || !report.student) { panel.innerHTML = '<p class="muted">Select a student to view details.</p>'; return; }

    const ps = report.presence || {};
    const period = AttendanceEngine.activePeriod();
    const rec = period && report.periods && report.periods[period.periodId] || null;

    const statusColor = { 'Present': '#22c55e', 'Signal Weak': '#f59e0b', 'Temporarily Lost': '#ef4444', 'Outside Assigned Room': '#ff6b4a', 'Unknown': '#6b7280', 'No Active Session': '#6b7280' };
    const statusIcon  = { 'Present': '✅', 'Signal Weak': '⚠️', 'Temporarily Lost': '🔴', 'Outside Assigned Room': '❌', 'Unknown': '❓', 'No Active Session': '⏸️' };

    panel.innerHTML = `
      <div class="student-card-header">
        <div class="student-avatar-large">${report.student.name.charAt(0)}</div>
        <div>
          <div class="student-name-big">${report.student.name}</div>
          <div class="student-roll">${report.student.roll} · ${report.student.dept}</div>
        </div>
      </div>
      <div class="presence-status-badge" style="background:${(statusColor[ps.status] || '#6b7280') + '22'};color:${statusColor[ps.status] || '#6b7280'};border-color:${statusColor[ps.status] || '#6b7280'}44">
        ${statusIcon[ps.status] || '❓'} ${ps.status || 'Unknown'}
      </div>
      <div class="stat-grid2">
        <div class="stat2"><span class="k">Room</span><span class="v">${ps.roomId || '—'}</span></div>
        <div class="stat2"><span class="k">RSSI</span><span class="v">${ps.rssi ? ps.rssi + ' dBm' : '—'}</span></div>
        <div class="stat2"><span class="k">Confidence</span><span class="v">${ps.confidence != null ? ps.confidence + '%' : '—'}</span></div>
        <div class="stat2"><span class="k">Last Seen</span><span class="v">${ps.lastSeen ? new Date(ps.lastSeen * 1000).toLocaleTimeString() : '—'}</span></div>
        ${rec ? `<div class="stat2"><span class="k">Punch-in</span><span class="v ${rec.status === 'punched' ? 'green' : ''}">${rec.status === 'punched' ? '✅ ' + rec.punchTime : rec.status}</span></div>` : ''}
        ${rec ? `<div class="stat2"><span class="k">Face ID</span><span class="v ${rec.faceVerified ? 'green' : 'muted'}">${rec.faceVerified ? '✅ ' + rec.faceScore + '%' : 'Not verified'}</span></div>` : ''}
      </div>
      <div class="btn-row2" style="margin-top:10px">
        <button id="db-punch-btn" class="db-btn primary small" ${!period || (rec && rec.status === 'punched') ? 'disabled' : ''}>
          ${rec && rec.status === 'punched' ? '✅ Punched In' : '📲 Punch In'}
        </button>
        <button id="db-face-verify-btn" class="db-btn secondary small" ${faceVerifyRunning ? 'disabled' : ''}>
          🎭 Face Verify
        </button>
      </div>
      <div id="db-face-result" class="face-result-area"></div>
      <div class="period-table">
        <div class="period-table-title">Attendance Record</div>
        ${TIMETABLE.map(function (p) {
          const r = report.periods && report.periods[p.periodId];
          const sch = CLASS_SCHEDULE[p.periodId];
          const statusClass = r ? (r.status === 'punched' ? 'punched' : r.status === 'active' ? 'active' : 'idle') : 'idle';
          return '<div class="period-row ' + statusClass + '">' +
            '<span class="period-name">' + p.name + '</span>' +
            '<span class="period-sub">' + (sch ? sch.subject : '') + '</span>' +
            '<span class="period-status">' + (r ? (r.status === 'punched' ? '✅ ' + r.punchTime : r.status) : '—') + '</span>' +
            '</div>';
        }).join('')}
      </div>
    `;

    // Re-bind buttons
    bindStudentPanel();
  }

  function runFaceVerify(studentId) {
    faceVerifyRunning = true;
    const resultEl = $('db-face-result');
    const btn = $('db-face-verify-btn');
    if (resultEl) resultEl.innerHTML = '<div class="face-scanning">🔍 Scanning face… (simulated)</div>';
    if (btn) btn.disabled = true;
    AttendanceEngine.runFaceVerification(studentId).then(function (res) {
      faceVerifyRunning = false;
      if (resultEl) {
        resultEl.innerHTML = `<div class="face-result ${res.matched ? 'match' : 'nomatch'}">
          ${res.matched ? '✅' : '❌'} ${res.status}<br>
          <span class="muted">Match score: ${res.score}% · SIMULATED – not real biometrics</span>
        </div>`;
      }
      if (btn) btn.disabled = false;
    });
  }

  /* =========================================================================
   * Overview tab updater
   * ======================================================================= */
  function updateOverview(stats) {
    const set = function (id, v) { const el = $(id); if (el) el.textContent = v; };
    set('ov-total',   stats.totalStudents);
    set('ov-present', stats.present);
    set('ov-absent',  stats.absent);
    set('ov-punched', stats.punched);
    set('ov-period',  stats.activePeriod ? stats.activePeriod.name + ' – ' + (CLASS_SCHEDULE[stats.activePeriod.periodId] || {}).subject : 'Break / No session');
    set('ov-simtime', stats.simTime);
    const sch = stats.activePeriod ? CLASS_SCHEDULE[stats.activePeriod.periodId] : null;
    set('ov-classroom', sch ? sch.roomId + ' (' + CAMPUS_ROOMS.find(function (r) { return r.id === sch.roomId; })?.name + ')' : '—');
    set('ov-faculty',   sch ? sch.faculty : '—');

    // Active beacons pill
    set('ov-beacons', CAMPUS_BEACONS.length + ' active');

    // Period progress bar
    const bar = $('ov-period-bar');
    if (bar && stats.activePeriod) {
      const p = stats.activePeriod;
      const start = p.startHour * 60 + p.startMin;
      const end   = p.endHour * 60 + p.endMin;
      const pct   = Math.min(((stats.simMinutes - start) / (end - start)) * 100, 100);
      bar.style.width = pct.toFixed(1) + '%';
    }
  }

  /* =========================================================================
   * Classroom monitoring tab
   * ======================================================================= */
  function updateClassroomMonitoring() {
    const tbody = $('cm-tbody');
    if (!tbody) return;
    const presence = AttendanceEngine.getAllPresence();
    const period   = AttendanceEngine.activePeriod();
    const records  = AttendanceEngine.getAllRecords();

    tbody.innerHTML = DEMO_STUDENTS.map(function (s) {
      const ps = presence[s.id] || {};
      const rec = period && records[s.id] && records[s.id][period.periodId] || {};
      const statusColor = { 'Present': 'green', 'Signal Weak': 'yellow', 'Temporarily Lost': 'red', 'Outside Assigned Room': 'orange', 'Unknown': 'grey' };
      const sc = statusColor[ps.status] || 'grey';
      return '<tr class="cm-row" data-id="' + s.id + '">' +
        '<td><span class="status-dot ' + sc + '"></span></td>' +
        '<td>' + s.name + '</td>' +
        '<td>' + s.roll + '</td>' +
        '<td>' + (ps.roomId || '—') + '</td>' +
        '<td>' + (ps.rssi ? ps.rssi + ' dBm' : '—') + '</td>' +
        '<td>' + (ps.confidence != null ? ps.confidence + '%' : '—') + '</td>' +
        '<td>' + (rec.status === 'punched' ? '<span class="tag-green">✅ ' + rec.punchTime + '</span>' : '<span class="tag-grey">' + (rec.status || '—') + '</span>') + '</td>' +
        '<td>' + (ps.status || '—') + '</td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('.cm-row').forEach(function (row) {
      row.addEventListener('click', function () { selectStudent(row.dataset.id); });
    });
  }

  /* =========================================================================
   * Student list tab
   * ======================================================================= */
  function renderStudentList() {
    const list = $('db-student-list');
    if (!list) return;
    list.innerHTML = DEMO_STUDENTS.map(function (s) {
      return '<div class="student-row" data-student-id="' + s.id + '">' +
        '<div class="student-avatar-sm">' + s.name.charAt(0) + '</div>' +
        '<div class="student-info">' +
          '<span class="student-name-sm">' + s.name + '</span>' +
          '<span class="student-roll-sm">' + s.roll + '</span>' +
        '</div>' +
        '<span class="student-status-dot" id="ss-dot-' + s.id + '">●</span>' +
        '</div>';
    }).join('');
    list.querySelectorAll('.student-row').forEach(function (row) {
      row.addEventListener('click', function () { selectStudent(row.dataset.studentId); });
    });
  }

  function updateStudentList() {
    const presence = AttendanceEngine.getAllPresence();
    const colorMap = { 'Present': '#22c55e', 'Signal Weak': '#f59e0b', 'Temporarily Lost': '#ef4444', 'Outside Assigned Room': '#ff6b4a', 'Unknown': '#6b7280', 'No Active Session': '#6b7280' };
    DEMO_STUDENTS.forEach(function (s) {
      const dot = $('ss-dot-' + s.id);
      if (dot) {
        const ps = presence[s.id] || {};
        dot.style.color = colorMap[ps.status] || '#6b7280';
      }
    });
    if (selectedStudent) updateStudentDetail(selectedStudent);
  }

  /* =========================================================================
   * Beacon management tab
   * ======================================================================= */
  function renderBeaconManagement() {
    const grid = $('db-beacon-grid');
    if (!grid) return;
    grid.innerHTML = CAMPUS_BEACONS.map(function (b) {
      const hex = '#' + b.color.toString(16).padStart(6, '0');
      return '<div class="beacon-card" style="--bc:' + hex + '">' +
        '<div class="beacon-card-header">' +
          '<span class="beacon-led" style="background:' + hex + '"></span>' +
          '<span class="beacon-card-id">' + b.id + '</span>' +
        '</div>' +
        '<div class="beacon-card-room">' + (CAMPUS_ROOMS.find(function (r) { return r.id === b.roomId; }) || {}).name + '</div>' +
        '<div class="beacon-props">' +
          '<div><span class="k">Position</span><span class="v">' + b.x + ', ' + b.z + ' m</span></div>' +
          '<div><span class="k">TX Power</span><span class="v">' + b.txPower + ' dBm</span></div>' +
          '<div><span class="k">Path Loss n</span><span class="v">' + b.pathLoss + '</span></div>' +
          '<div><span class="k">Wall Atten.</span><span class="v">' + b.wallAtten + ' dB/wall</span></div>' +
        '</div>' +
        '<div class="beacon-rssi-live" id="bcard-rssi-' + b.id + '">RSSI: — dBm</div>' +
        '<div class="beacon-status ok" id="bcard-status-' + b.id + '">● Active</div>' +
      '</div>';
    }).join('');
  }

  function updateBeaconCards(beacons) {
    if (!beacons) return;
    beacons.forEach(function (b, i) {
      const cb = CAMPUS_BEACONS[i];
      if (!cb) return;
      const rssiEl = $('bcard-rssi-' + cb.id);
      if (rssiEl) rssiEl.textContent = 'RSSI: ' + (b.raw != null ? b.raw : '—') + ' dBm | filtered: ' + (b.filtered != null ? b.filtered.toFixed(1) : '—') + ' dBm';
    });
  }

  /* =========================================================================
   * Library tab
   * ======================================================================= */
  function updateLibraryTab() {
    const presence = AttendanceEngine.getAllPresence();
    const libRooms = CAMPUS_ROOMS.filter(function (r) { return r.type === 'library'; });
    const container = $('db-library-zones');
    if (!container) return;
    // Count students per zone (simple – full demo students are in A101, but show lib beacons)
    const zoneCounts = {};
    libRooms.forEach(function (r) { zoneCounts[r.id] = 0; });
    Object.keys(presence).forEach(function (id) {
      const ps = presence[id];
      if (ps && zoneCounts[ps.roomId] != null) zoneCounts[ps.roomId]++;
    });
    container.innerHTML = libRooms.map(function (r) {
      const beacon = CAMPUS_BEACONS.find(function (b) { return b.roomId === r.id; });
      return '<div class="lib-zone-card">' +
        '<div class="lib-zone-name">' + r.name + '</div>' +
        '<div class="lib-zone-occupancy"><span class="lib-count">' + (zoneCounts[r.id] || 0) + '</span> / ' + r.capacity + ' students</div>' +
        (beacon ? '<div class="lib-beacon-info">Beacon: ' + beacon.id + '</div>' : '') +
        '<div class="lib-status-bar"><div class="lib-bar-fill" style="width:' + Math.round((zoneCounts[r.id] || 0) / r.capacity * 100) + '%"></div></div>' +
      '</div>';
    }).join('');
  }

  /* =========================================================================
   * Reports tab
   * ======================================================================= */
  function updateReports() {
    const tbody = $('report-tbody');
    if (!tbody) return;
    const records = AttendanceEngine.getAllRecords();
    tbody.innerHTML = DEMO_STUDENTS.map(function (s) {
      const row = '<tr><td>' + s.name + '</td><td>' + s.roll + '</td>' +
        TIMETABLE.map(function (p) {
          const rec = records[s.id] && records[s.id][p.periodId];
          const cls = rec ? (rec.status === 'punched' ? 'tag-green' : 'tag-grey') : 'tag-grey';
          const txt = rec ? (rec.status === 'punched' ? '✅' : rec.status === 'active' ? '🔄' : '—') : '—';
          return '<td><span class="' + cls + '">' + txt + '</span></td>';
        }).join('') + '</tr>';
      return row;
    }).join('');
  }

  /* =========================================================================
   * Period selector bar
   * ======================================================================= */
  function renderPeriodBar() {
    const bar = $('db-period-bar');
    if (!bar) return;
    bar.innerHTML = TIMETABLE.map(function (p) {
      const sch = CLASS_SCHEDULE[p.periodId] || {};
      return '<div class="period-chip" id="period-chip-' + p.periodId + '">' +
        '<div class="period-chip-name">' + p.name + '</div>' +
        '<div class="period-chip-time">' + p.startHour + ':' + String(p.startMin).padStart(2, '0') + '–' + p.endHour + ':' + String(p.endMin).padStart(2, '0') + '</div>' +
        '<div class="period-chip-sub">' + (sch.subject || '') + '</div>' +
      '</div>';
    }).join('');
  }

  function updatePeriodBar(simMinutes) {
    TIMETABLE.forEach(function (p) {
      const chip = $('period-chip-' + p.periodId);
      if (!chip) return;
      const start = p.startHour * 60 + p.startMin;
      const end   = p.endHour * 60 + p.endMin;
      const active = simMinutes >= start && simMinutes < end;
      const past   = simMinutes >= end;
      chip.className = 'period-chip' + (active ? ' active' : past ? ' past' : '');
    });
  }

  /* =========================================================================
   * Face recognition tab
   * ======================================================================= */
  function renderFaceRecogTab() {
    const container = $('db-face-recog-panel');
    if (!container) return;
    container.innerHTML = `
      <div class="face-notice">
        <span class="face-notice-icon">⚠️</span>
        <strong>SIMULATED – No real camera or biometric data used.</strong>
        All face verification scores are randomly generated for demonstration purposes only.
        Consent-based mock data only. No real faces are stored.
      </div>
      <div class="face-grid">
        ${DEMO_STUDENTS.map(function (s) {
          return '<div class="face-student-card" id="fsc-' + s.id + '">' +
            '<div class="face-avatar">' + s.name.charAt(0) + '</div>' +
            '<div class="face-student-name">' + s.name + '</div>' +
            '<div class="face-student-roll">' + s.roll + '</div>' +
            '<div class="face-status" id="fstat-' + s.id + '">Not verified</div>' +
            '<button class="db-btn secondary small face-verify-btn" data-id="' + s.id + '">🎭 Verify</button>' +
          '</div>';
        }).join('')}
      </div>
    `;
    container.querySelectorAll('.face-verify-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const sid = btn.dataset.id;
        btn.disabled = true;
        const fstat = $('fstat-' + sid);
        if (fstat) fstat.textContent = '🔍 Scanning…';
        AttendanceEngine.runFaceVerification(sid).then(function (res) {
          btn.disabled = false;
          if (fstat) fstat.textContent = res.matched ? '✅ ' + res.score + '%' : '❌ Failed';
          const card = $('fsc-' + sid);
          if (card) card.classList.toggle('face-matched', res.matched);
        });
      });
    });
  }

  /* =========================================================================
   * Minimap & RSSI chart
   * ======================================================================= */
  function redrawMinimap(reading, simState) {
    if (!miniCanvas || !miniCtx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = miniCanvas.clientWidth, h = miniCanvas.clientHeight;
    if (!w || !h) return;
    miniCanvas.width = Math.round(w * dpr);
    miniCanvas.height = Math.round(h * dpr);
    const ctx = miniCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = 8;
    const sx = (w - 2 * pad) / CAMPUS.width, sz = (h - 2 * pad) / CAMPUS.depth;
    const s = Math.min(sx, sz);
    const ox = (w - CAMPUS.width * s) / 2, oy = (h - CAMPUS.depth * s) / 2;
    const X = function (x) { return ox + x * s; };
    const Z = function (z) { return oy + z * s; };

    // Rooms
    CAMPUS_ROOMS.forEach(function (room) {
      const r = (room.color >> 16) & 255, g = (room.color >> 8) & 255, b = room.color & 255;
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.25)';
      ctx.fillRect(X(room.x1), Z(room.z1), (room.x2 - room.x1) * s, (room.z2 - room.z1) * s);
      ctx.fillStyle = 'rgba(180,200,240,0.7)';
      ctx.font = '500 ' + Math.max(7, s * 0.35) + 'px "Segoe UI",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(room.id, X((room.x1 + room.x2) / 2), Z((room.z1 + room.z2) / 2));
    });

    // Walls
    ctx.fillStyle = '#4a5a7c';
    CAMPUS_WALL_PIECES.forEach(function (p) {
      ctx.fillRect(X(p.x1), Z(p.z1), (p.x2 - p.x1) * s, (p.z2 - p.z1) * s);
    });

    // Beacons
    CAMPUS_BEACONS.forEach(function (b) {
      ctx.fillStyle = '#' + b.color.toString(16).padStart(6, '0');
      ctx.beginPath(); ctx.arc(X(b.x), Z(b.z), 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Demo students
    const presence = AttendanceEngine.getAllPresence();
    const colorMap = { 'Present': '#22c55e', 'Signal Weak': '#f59e0b', 'Temporarily Lost': '#ef4444', 'Outside Assigned Room': '#ff6b4a' };
    DEMO_STUDENTS.forEach(function (s) {
      const ps = presence[s.id];
      ctx.fillStyle = ps ? (colorMap[ps.status] || '#6b7280') : '#6b7280';
      ctx.beginPath(); ctx.arc(X(s.seatX), Z(s.seatZ), 3.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  function redrawRssiChart(history) {
    if (!rssiCanvas || !rssiCtx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = rssiCanvas.clientWidth, h = rssiCanvas.clientHeight;
    if (!w || !h) return;
    rssiCanvas.width = Math.round(w * dpr);
    rssiCanvas.height = Math.round(h * dpr);
    const ctx = rssiCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const left = 36, right = 6, top = 18, bottom = 6;
    const pw = w - left - right, ph = h - top - bottom;
    const yMin = -100, yMax = -30;
    const Y = function (v) { return top + (yMax - v) / (yMax - yMin) * ph; };

    // Grid
    [-40, -55, -70, -85, -100].forEach(function (v) {
      ctx.strokeStyle = '#1c2b4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, Y(v)); ctx.lineTo(left + pw, Y(v)); ctx.stroke();
      ctx.fillStyle = '#7f93b5'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(v, left - 4, Y(v) + 3);
    });

    if (!history) return;
    const maxPts = 100;
    CAMPUS_BEACONS.slice(0, 4).forEach(function (b, i) {
      const data = (history[i] || []).slice(-maxPts);
      if (data.length < 2) return;
      ctx.strokeStyle = '#' + b.color.toString(16).padStart(6, '0');
      ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      data.forEach(function (v, k) {
        const x = left + (k / (maxPts - 1)) * pw;
        if (k === 0) ctx.moveTo(x, Y(v)); else ctx.lineTo(x, Y(v));
      });
      ctx.stroke();
      // legend
      ctx.fillStyle = '#' + b.color.toString(16).padStart(6, '0');
      ctx.fillRect(left + i * 70, 6, 10, 3);
      ctx.fillStyle = '#aab8d0'; ctx.textAlign = 'left'; ctx.font = '10px monospace';
      ctx.fillText(b.id, left + i * 70 + 14, 9);
    });
  }

  /* =========================================================================
   * Toast
   * ======================================================================= */
  let toastTimer = null;
  function showToast(msg, type) {
    const t = $('db-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'db-toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3000);
  }

  /* =========================================================================
   * Status
   * ======================================================================= */
  function setStatus(status) {
    const pill = $('db-status-pill');
    if (!pill) return;
    pill.className = 'db-pill ' + status;
    pill.textContent = status === 'running' ? '● Running' : status === 'paused' ? '⏸ Paused' : '◉ Ready';
    const start = $('db-btn-start'), pause = $('db-btn-pause');
    if (start) { start.disabled = status === 'running'; start.textContent = status === 'paused' ? 'Resume' : 'Start'; }
    if (pause) { pause.disabled = status !== 'running'; }
  }

  function setFps(fps) { const el = $('db-fps'); if (el) el.textContent = Math.round(fps) + ' fps'; }

  /* =========================================================================
   * Master update (called every frame from campus-main.js)
   * ======================================================================= */
  function update(reading, simState) {
    const stats = AttendanceEngine.getOverviewStats();
    updateOverview(stats);
    updatePeriodBar(stats.simMinutes);
    updateStudentList();
    if (activeTab === 'classroom') updateClassroomMonitoring();
    if (activeTab === 'library')   updateLibraryTab();
    if (activeTab === 'reports')   updateReports();
    if (activeTab === 'facerecog') renderFaceRecogTab();
    if (reading) {
      updateBeaconCards(reading.beacons);
      redrawMinimap(reading, simState);
      redrawRssiChart(simState ? simState.history : null);
    }
  }

  function setShot(name, info, touring) {
    document.querySelectorAll('[data-shot]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.shot === name);
    });
    const cap = $('db-caption');
    if (cap && info && info.label) {
      cap.textContent = info.label + (info.sub ? ' – ' + info.sub : '');
    }
  }

  return {
    init,
    update,
    setStatus,
    setFps,
    setShot,
    showToast,
    renderFaceRecogTab
  };
})();

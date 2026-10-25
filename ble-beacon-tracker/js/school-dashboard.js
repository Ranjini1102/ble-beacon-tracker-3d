/* =============================================================================
 * school-dashboard.js  –  Controller for 4 Integrated Application Views:
 *   1. 3D School Simulation
 *   2. Student Attendance App (Mobile View)
 *   3. Live Admin Attendance Dashboard
 *   4. Central Library Monitoring & Session Manager
 *
 * Synchronizes real-time state across all pages without duplicate student data.
 * ========================================================================== */
'use strict';

var SchoolDashboard = (function() {
  var $ = function(id) { return document.getElementById(id); };

  var activeView = 'simulation'; // 'simulation' | 'student-app' | 'admin-dashboard' | 'library'
  var activeTab = 'overview';   // sidebar subtab in 3D view
  var activeClassId = '10A';
  var selectedStudentId = '10A-S001';
  var currentStudentAppSid = '10A-S001';

  var miniCtx = null;
  var handlers = null;
  var pendingPunchSid = null;
  var pendingPunchClass = null;

  /* ── Initialization ─────────────────────────────────────────────────────── */
  function init(h) {
    handlers = h;

    bindMasterNav();
    bindTimePresets();
    bindControls();
    bindRoomButtons();

    // 3D Sidebar
    renderSidebarTabs();
    bindSidebarTabs();
    renderPeriodBar();
    renderStudentList('10A');
    renderBeaconPanel();

    // Student App View
    initStudentApp();

    // Admin Dashboard View
    initAdminDashboard();

    // Library Monitoring View
    initLibraryMonitoring();

    // Face Modal
    initFaceModal();

    // Minimap canvas
    var mc = $('db-minimap');
    if (mc) miniCtx = mc.getContext('2d');
  }

  /* ── 1. Master Navigation (4 Integrated Pages) ───────────────────────────── */
  function bindMasterNav() {
    var tabs = document.querySelectorAll('#nav-views .nav-tab');
    tabs.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var view = btn.dataset.view;
        switchView(view);
      });
    });
  }

  function switchView(viewName) {
    activeView = viewName;
    document.querySelectorAll('#nav-views .nav-tab').forEach(function(b) {
      b.classList.toggle('active', b.dataset.view === viewName);
    });
    document.querySelectorAll('.page-view').forEach(function(p) {
      p.classList.toggle('active', p.id === 'view-' + viewName);
    });

    if (viewName === 'simulation') {
      // Re-trigger Three.js viewport resize
      window.dispatchEvent(new Event('resize'));
    } else if (viewName === 'student-app') {
      updateStudentApp();
    } else if (viewName === 'admin-dashboard') {
      updateAdminDashboard();
    } else if (viewName === 'library') {
      updateLibraryMonitoring();
    }
  }

  /* ── 2. Simulation Time Presets ─────────────────────────────────────────── */
  function bindTimePresets() {
    document.querySelectorAll('.time-presets .preset-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var parts = btn.dataset.time.split(',').map(Number);
        jumpSimTime(parts[0], parts[1]);
        document.querySelectorAll('.time-presets .preset-btn').forEach(function(b) {
          b.classList.toggle('active', b === btn);
        });
      });
    });
  }

  function jumpSimTime(h, m) {
    SchoolEngine.setSimTime(h, m);
    var p1 = SchoolEngine.getPeriod1Status();
    showToast('Jumped to ' + SchoolEngine.getSimTimeStr() + ' · ' + p1.statusLabel, 'info');
    updateAllViews();
  }

  /* ── 3. Simulation Controls ─────────────────────────────────────────────── */
  function bindControls() {
    var start = $('db-start'), pause = $('db-pause'), reset = $('db-reset');
    var nextP = $('db-next-period');

    if (start) start.addEventListener('click', function() { handlers.onStart(); });
    if (pause) pause.addEventListener('click', function() { handlers.onPause(); });
    if (reset) reset.addEventListener('click', function() { handlers.onReset(); });
    if (nextP) nextP.addEventListener('click', function() { handlers.onNextPeriod(); });

    var sp = $('db-speed');
    if (sp) sp.addEventListener('input', function() {
      handlers.onSpeed(parseFloat(sp.value));
      var out = $('db-speed-out');
      if (out) out.textContent = sp.value + 'x';
    });

    var enterBtn = $('enter-fps-btn');
    if (enterBtn) enterBtn.addEventListener('click', function() {
      handlers.onToggleFPS();
    });
  }

  function setStatus(st) {
    var pill = $('db-status-pill');
    var start = $('db-start'), pause = $('db-pause');
    if (!pill) return;
    if (st === 'running') {
      pill.className = 'db-pill running'; pill.textContent = '● Running';
      if (start) start.disabled = true;
      if (pause) pause.disabled = false;
    } else if (st === 'paused') {
      pill.className = 'db-pill paused'; pill.textContent = '⏸ Paused';
      if (start) start.disabled = false;
      if (pause) pause.disabled = true;
    } else {
      pill.className = 'db-pill idle'; pill.textContent = '◉ Ready';
      if (start) start.disabled = false;
      if (pause) pause.disabled = true;
    }
  }

  /* ── 4. Room Quick Navigation Buttons ───────────────────────────────────── */
  function bindRoomButtons() {
    document.querySelectorAll('[data-room]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var rid = btn.dataset.room;
        handlers.onEnterRoom(rid);
        activeClassId = rid;
        renderStudentList(rid);
        // If in simulation view, switch sidebar to classroom tab
        activeTab = 'classroom';
        document.querySelectorAll('.tab-btn').forEach(function(b) {
          b.classList.toggle('active', b.dataset.tab === activeTab);
        });
        document.querySelectorAll('.tab-pane').forEach(function(p) {
          p.classList.toggle('active', p.dataset.pane === activeTab);
        });
      });
    });
  }

  /* ── 5. Sidebar Tabs (3D View) ─────────────────────────────────────────── */
  function renderSidebarTabs() {
    var tabs = [
      { id: 'overview',  icon: '🏫', label: 'Overview' },
      { id: 'classroom', icon: '📋', label: 'Classroom' },
      { id: 'beacons',   icon: '📡', label: 'Beacons' }
    ];
    var bar = $('tab-bar');
    if (!bar) return;
    bar.innerHTML = tabs.map(function(t) {
      return '<button class="tab-btn' + (t.id === activeTab ? ' active' : '') + '" data-tab="' + t.id + '">' +
        '<span class="tab-icon">' + t.icon + '</span><span class="tab-label">' + t.label + '</span></button>';
    }).join('');
  }

  function bindSidebarTabs() {
    var bar = $('tab-bar');
    if (!bar) return;
    bar.addEventListener('click', function(e) {
      var btn = e.target.closest('.tab-btn');
      if (!btn) return;
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.tab === activeTab);
      });
      document.querySelectorAll('.tab-pane').forEach(function(p) {
        p.classList.toggle('active', p.dataset.pane === activeTab);
      });
    });
  }

  /* ── 6. Period Bar in Sidebar ───────────────────────────────────────────── */
  function renderPeriodBar() {
    var bar = $('db-period-bar');
    if (!bar) return;
    bar.innerHTML = TIMETABLE.map(function(p) {
      return '<div class="period-chip" id="pchip-' + p.id + '" title="' + p.subject + '">' +
        '<div class="pchip-name">' + p.name + '</div>' +
        '<div class="pchip-time">' + p.startH + ':00–' + p.endH + ':00</div>' +
        '<div class="pchip-sub">' + p.subject + '</div>' +
        '</div>';
    }).join('');
  }

  function updatePeriodBar(simMins) {
    TIMETABLE.forEach(function(p) {
      var chip = $('pchip-' + p.id);
      if (!chip) return;
      var st = p.startH * 60 + p.startM, en = p.endH * 60 + p.endM;
      var active = simMins >= st && simMins < en, past = simMins >= en;
      chip.className = 'period-chip' + (active ? ' active' : past ? ' past' : '');
    });
  }

  /* ── 7. Classroom Roster (3D View Sidebar) ──────────────────────────────── */
  function renderStudentList(classId) {
    activeClassId = classId;
    var panel = $('cm-class-info');
    if (panel) {
      var room = SCHOOL_ROOMS.find(function(r) { return r.id === classId; }) || {};
      var beacon = SCHOOL_BEACONS.find(function(b) { return b.roomId === classId; }) || {};
      panel.innerHTML =
        '<span class="cm-room-badge" style="background:#10b98122;border-color:#10b98155;color:#10b981">' + (room.name || classId) + '</span>' +
        '<span class="cm-beacon-chip">📡 ' + (beacon.id || 'BCN-' + classId) + '</span>';
    }

    var tabs = $('cm-class-tabs');
    if (tabs) {
      tabs.innerHTML = ['10A', '10B', '10C', '9A', '9B', '9C'].map(function(c) {
        return '<button class="room-tab' + (c === classId ? ' active' : '') + '" data-room="' + c + '">' + c + '</button>';
      }).join('');
      tabs.querySelectorAll('.room-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
          renderStudentList(btn.dataset.room);
          handlers.onEnterRoom(btn.dataset.room);
        });
      });
    }

    updateClassroomRoster(classId);
  }

  function updateClassroomRoster(classId) {
    var tbody = $('cm-tbody');
    if (!tbody) return;
    classId = classId || activeClassId;
    var rows = SchoolEngine.getClassStats(classId);

    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">No students in this class.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function(r) {
      var s = r.student, ps = r.presence || {}, att = r.attendance;
      var scMap = {
        'Strong Signal': 'green', 'Moderate Signal': 'yellow', 'Weak Signal': 'orange',
        'Signal Lost': 'red', 'Outside Assigned Room': 'orange', '': 'grey'
      };
      var sc = scMap[ps.status || ''] || 'grey';
      var isPunched = att && att.status === 'PRESENT';

      return '<tr class="cm-row' + (s.id === selectedStudentId ? ' selected' : '') + '" data-sid="' + s.id + '" data-cls="' + s.classId + '">' +
        '<td><span class="status-dot ' + sc + '"></span></td>' +
        '<td class="student-name-cell">' + s.name + '</td>' +
        '<td class="mono">' + s.roll + '</td>' +
        '<td class="mono">' + (ps.rssi != null ? ps.rssi + ' dBm' : '—') + '</td>' +
        '<td>' + (ps.confidence != null ? ps.confidence + '%' : '—') + '</td>' +
        '<td><span class="status-badge ' + (att ? att.statusClass : '') + '">' + (att ? att.label : 'NOT MARKED') + '</span></td>' +
        '<td>' + (isPunched ? '<span class="tag-green">✅ ' + att.punchTime + '</span>' : '<span class="tag-grey">—</span>') + '</td>' +
        '<td><button class="db-btn small primary punch-btn" data-sid="' + s.id + '" data-cls="' + s.classId + '">' +
          (isPunched ? '✅ Present' : '📲 Punch In') + '</button></td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('.cm-row').forEach(function(row) {
      row.addEventListener('click', function(e) {
        if (e.target.classList.contains('punch-btn')) return;
        handleStudentSelect(row.dataset.sid, row.dataset.cls);
      });
    });

    tbody.querySelectorAll('.punch-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        handlePunchInFlow(btn.dataset.sid, btn.dataset.cls);
      });
    });
  }

  function handleStudentSelect(sid, cls) {
    selectedStudentId = sid;
    SchoolScene.selectStudent(sid);
    updateStudentDetail(sid, cls);
  }

  function updateStudentDetail(sid, cls) {
    var panel = $('cm-student-detail');
    if (!panel) return;
    var rep = SchoolEngine.getStudentReport(sid);
    var student = rep.student;
    if (!student) {
      panel.innerHTML = '<p class="muted">Select a student from the list.</p>';
      return;
    }

    var ps = rep.presence || {};
    var att = rep.attendance || { label: 'NOT MARKED', statusClass: '' };
    var lib = rep.libSession;
    var hist = rep.history || [];

    panel.innerHTML =
      '<div class="sd-header">' +
        '<div class="sd-avatar" style="background:linear-gradient(135deg,#10b981,#3b82f6)">' + student.name.charAt(0) + '</div>' +
        '<div>' +
          '<div class="sd-name">' + student.name + '</div>' +
          '<div class="sd-meta">' + student.id + ' · Class ' + student.classId + ' · ' + (student.seatNumber || 'Desk') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sd-status-badge ' + att.statusClass + '">' + att.label + ' (' + (ps.status || 'No Signal') + ')</div>' +
      '<div class="sd-grid">' +
        '<div class="sd-stat"><span class="k">RSSI</span><span class="v">' + (ps.rssi != null ? ps.rssi + ' dBm' : '—') + '</span></div>' +
        '<div class="sd-stat"><span class="k">Confidence</span><span class="v">' + (ps.confidence != null ? ps.confidence + '%' : '—') + '</span></div>' +
        '<div class="sd-stat"><span class="k">Beacon</span><span class="v">' + (ps.beaconId || 'BCN-' + student.classId) + '</span></div>' +
        '<div class="sd-stat"><span class="k">Classroom</span><span class="v">' + student.classId + '</span></div>' +
        (att.punched ? '<div class="sd-stat"><span class="k">Punch-in</span><span class="v green">✅ ' + att.punchTime + '</span></div>' : '') +
        (att.faceScore ? '<div class="sd-stat"><span class="k">Face Score</span><span class="v green">' + att.faceScore + '%</span></div>' : '') +
        (lib ? '<div class="sd-stat"><span class="k">Library ID</span><span class="v mono">' + lib.sessionId + '</span></div>' : '') +
      '</div>' +
      '<div class="sd-btns" style="margin-top:10px">' +
        '<button class="db-btn primary small" id="sd-punch-btn" ' + (att.punched ? 'disabled' : '') + '>' +
          (att.punched ? '✅ Attendance Confirmed' : '📲 Punch In & Verify') + '</button>' +
        '<button class="db-btn secondary small" id="sd-zoom-btn">🔍 Zoom on Avatar Face</button>' +
      '</div>';

    var pb = $('sd-punch-btn');
    if (pb && !att.punched) {
      pb.addEventListener('click', function() {
        handlePunchInFlow(sid, student.classId);
      });
    }

    var zb = $('sd-zoom-btn');
    if (zb) {
      zb.addEventListener('click', function() {
        SchoolScene.focusStudent(sid);
      });
    }
  }

  /* ── 8. Student Attendance App View ─────────────────────────────────────── */
  function initStudentApp() {
    var sel = $('app-student-select');
    if (!sel) return;

    // Populate dropdown with all 120 students grouped by class
    sel.innerHTML = '';
    ['10A', '10B', '10C', '9A', '9B', '9C'].forEach(function(cls) {
      var grp = document.createElement('optgroup');
      grp.label = 'Class ' + cls + ' (Beacon BCN-' + cls + ')';
      (SCHOOL_STUDENTS[cls] || []).forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.id + ' – ' + s.name + ' (' + s.roll + ')';
        if (s.id === currentStudentAppSid) opt.selected = true;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    });

    sel.addEventListener('change', function() {
      currentStudentAppSid = sel.value;
      updateStudentApp();
    });

    var punchBtn = $('app-punch-button');
    if (punchBtn) {
      punchBtn.addEventListener('click', function() {
        var rep = SchoolEngine.getStudentReport(currentStudentAppSid);
        if (rep && rep.student) {
          handlePunchInFlow(currentStudentAppSid, rep.student.classId);
        }
      });
    }
  }

  function updateStudentApp() {
    var rep = SchoolEngine.getStudentReport(currentStudentAppSid);
    if (!rep || !rep.student) return;
    var s = rep.student, ps = rep.presence || {}, att = rep.attendance || {};
    var p1 = SchoolEngine.getPeriod1Status();

    // Student Header
    var avEl = $('app-student-avatar');
    if (avEl) {
      avEl.textContent = s.name.charAt(0);
      avEl.style.background = s.skinTone ? ('linear-gradient(135deg,' + s.skinTone + ',#10b981)') : '#10b981';
    }
    var nameEl = $('app-student-name');
    if (nameEl) nameEl.textContent = s.name;
    var idEl = $('app-student-id');
    if (idEl) idEl.textContent = s.id + ' · Roll: ' + s.roll;
    var clsEl = $('app-student-class');
    if (clsEl) clsEl.innerHTML = 'Class: <strong>' + s.classId + '</strong> · Seat: <strong>' + (s.seatNumber || 'Desk') + '</strong>';

    // Period Card
    var clockDisp = $('app-clock-display');
    if (clockDisp) clockDisp.textContent = SchoolEngine.getSimTimeStr();
    var periodPill = $('app-period-pill');
    if (periodPill) {
      periodPill.textContent = p1.statusLabel;
      periodPill.className = 'pic-status-pill ' + (p1.state === 'ACTIVE' ? 'active' : p1.state === 'NOT_STARTED' ? 'not-started' : 'closed');
    }
    var periodMsg = $('app-period-msg');
    if (periodMsg) periodMsg.textContent = p1.message;

    // Beacon Telemetry Card
    var bcnIdEl = $('app-bcn-id');
    if (bcnIdEl) bcnIdEl.textContent = 'BCN-' + s.classId;
    var bcnStatEl = $('app-bcn-status');
    if (bcnStatEl) bcnStatEl.textContent = ps.status || 'Detecting…';
    var bcnRssiEl = $('app-bcn-rssi');
    if (bcnRssiEl) bcnRssiEl.textContent = (ps.rssi != null ? ps.rssi + ' dBm' : '—');
    var bcnQualEl = $('app-bcn-quality');
    if (bcnQualEl) bcnQualEl.textContent = (ps.confidence != null ? ps.confidence + '%' : '—');

    var sigBar = $('app-signal-bar');
    if (sigBar) {
      var pct = ps.confidence ? ps.confidence : 0;
      sigBar.style.width = pct + '%';
      sigBar.style.backgroundColor = pct > 70 ? '#10b981' : pct > 40 ? '#facc15' : '#ef4444';
    }

    var lastSeenEl = $('app-last-seen');
    if (lastSeenEl) lastSeenEl.textContent = ps.lastSeen || SchoolEngine.getSimTime24();

    // Attendance Action Card
    var attBadge = $('app-attendance-badge');
    if (attBadge) {
      attBadge.textContent = att.label || 'NOT MARKED';
      attBadge.className = 'status-badge ' + (att.statusClass || '');
    }

    var receipt = $('app-punch-receipt');
    var punchBtn = $('app-punch-button');
    var punchText = $('app-punch-text');
    var pacNotes = $('app-pac-notes');

    if (att.punched) {
      if (receipt) receipt.style.display = 'block';
      var pt = $('app-punch-time'); if (pt) pt.textContent = 'Marked at ' + att.punchTime;
      var psc = $('app-punch-score'); if (psc) psc.textContent = 'Face Biometric Verified: ' + att.faceScore + '% match';
      var ph = $('app-punch-hash'); if (ph) ph.textContent = 'Ref: ACK-2024-' + s.id + '-P1';

      if (punchBtn) {
        punchBtn.disabled = true;
        punchBtn.style.opacity = '0.6';
      }
      if (punchText) punchText.textContent = 'Attendance Confirmed ✅';
      if (pacNotes) pacNotes.textContent = 'Present status synchronized across all classroom dashboards.';
    } else {
      if (receipt) receipt.style.display = 'none';

      if (p1.state === 'NOT_STARTED') {
        if (punchBtn) {
          punchBtn.disabled = true;
          punchBtn.style.opacity = '0.5';
        }
        if (punchText) punchText.textContent = 'Attendance Not Started';
        if (pacNotes) pacNotes.textContent = 'Attendance opens at 09:00 AM. Punch-in is currently locked.';
      } else if (p1.state === 'CLOSED') {
        if (punchBtn) {
          punchBtn.disabled = true;
          punchBtn.style.opacity = '0.5';
        }
        if (punchText) punchText.textContent = 'Session Closed';
        if (pacNotes) pacNotes.textContent = 'Session closed at 10:00 AM. Attendance finalized as Absent.';
      } else {
        // Active
        if (punchBtn) {
          punchBtn.disabled = false;
          punchBtn.style.opacity = '1';
        }
        if (punchText) punchText.textContent = 'Punch In (Face Verification)';
        if (pacNotes) pacNotes.textContent = 'Assigned beacon BCN-' + s.classId + ' in range. Tap to verify face.';
      }
    }
  }

  /* ── 9. Admin Attendance Dashboard View ─────────────────────────────────── */
  function initAdminDashboard() {
    var classFilter = $('filter-class');
    var statusFilter = $('filter-status');
    var searchInput = $('filter-search');

    if (classFilter) classFilter.addEventListener('change', updateAdminDashboard);
    if (statusFilter) statusFilter.addEventListener('change', updateAdminDashboard);
    if (searchInput) searchInput.addEventListener('input', updateAdminDashboard);

    var autoBtn = $('admin-auto-punch-btn');
    if (autoBtn) {
      autoBtn.addEventListener('click', function() {
        var count = SchoolEngine.autoPunchClass(activeClassId || '10A');
        showToast('Auto-punched ' + count + ' students in Class ' + activeClassId, 'success');
        updateAllViews();
      });
    }

    var exportBtn = $('admin-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportAttendanceCSV);
    }
  }

  function updateAdminDashboard() {
    var stats = SchoolEngine.getOverviewStats();
    var p1 = stats.periodStatus;

    // KPI Cards
    var set = function(id, val) { var el = $(id); if (el) el.textContent = val; };
    set('kpi-total', stats.total);
    set('kpi-present', stats.present);
    set('kpi-present-pct', stats.pct + '% completion rate');
    set('kpi-not-marked', stats.notMarked);
    set('kpi-absent', stats.absent);
    set('kpi-face-ok', stats.faceVerified);
    set('kpi-face-pending', stats.facePending);
    set('kpi-signal-lost', stats.signalLost);

    var countdownEl = $('kpi-countdown');
    if (countdownEl) {
      if (p1.state === 'ACTIVE') countdownEl.textContent = p1.remainingMinutes + 'm remaining';
      else if (p1.state === 'NOT_STARTED') countdownEl.textContent = 'Opens in ' + p1.remainingMinutes + 'm';
      else countdownEl.textContent = 'Closed (10:00 AM)';
    }

    var periodTextEl = $('kpi-period-status-text');
    if (periodTextEl) periodTextEl.textContent = p1.statusLabel;

    // Render Classroom Summary Cards
    renderClassroomCards();

    // Render Master Student Table
    renderMasterTable();
  }

  function renderClassroomCards() {
    var grid = $('admin-class-cards');
    if (!grid) return;
    var classes = ['10A', '10B', '10C', '9A', '9B', '9C'];

    grid.innerHTML = classes.map(function(cls) {
      var rows = SchoolEngine.getClassStats(cls);
      var total = rows.length;
      var present = 0, absent = 0, notMarked = 0;
      rows.forEach(function(r) {
        if (r.attendance.status === 'PRESENT') present++;
        else if (r.attendance.status === 'ABSENT') absent++;
        else notMarked++;
      });
      var pct = total > 0 ? Math.round((present / total) * 100) : 0;

      return '<div class="admin-class-card" onclick="SchoolDashboard.filterByClass(\'' + cls + '\')">' +
        '<div class="acc-head">' +
          '<span class="acc-title">Class ' + cls + '</span>' +
          '<span class="acc-beacon">BCN-' + cls + '</span>' +
        '</div>' +
        '<div class="acc-meter">' +
          '<div class="acc-bar" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="acc-stats">' +
          '<span class="green"><strong>' + present + '</strong> Present</span>' +
          '<span class="yellow"><strong>' + notMarked + '</strong> Pending</span>' +
          '<span class="red"><strong>' + absent + '</strong> Absent</span>' +
        '</div>' +
        '<div class="acc-footer">' +
          '<span>' + pct + '% Attended</span>' +
          '<button class="db-btn small secondary" onclick="event.stopPropagation();SchoolDashboard.jumpToRoom3D(\'' + cls + '\')">View 3D</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function renderMasterTable() {
    var tbody = $('admin-master-tbody');
    if (!tbody) return;

    var classFilter = $('filter-class') ? $('filter-class').value : 'ALL';
    var statusFilter = $('filter-status') ? $('filter-status').value : 'ALL';
    var query = $('filter-search') ? $('filter-search').value.toLowerCase().trim() : '';

    var allStudents = SchoolEngine.getAllMasterStudents();
    var filtered = allStudents.filter(function(item) {
      var s = item.student;
      var att = item.attendance;
      var ps = item.presence;

      if (classFilter !== 'ALL' && s.classId !== classFilter) return false;

      if (statusFilter !== 'ALL') {
        if (statusFilter === 'SIGNAL_LOST') {
          if (!ps || ps.status !== 'Signal Lost') return false;
        } else if (att.status !== statusFilter) {
          return false;
        }
      }

      if (query) {
        var match = s.name.toLowerCase().indexOf(query) !== -1 ||
                    s.id.toLowerCase().indexOf(query) !== -1 ||
                    s.roll.toLowerCase().indexOf(query) !== -1;
        if (!match) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="muted" style="text-align:center;padding:24px">No student records match the active filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function(item) {
      var s = item.student, att = item.attendance, ps = item.presence;
      var isPresent = att.status === 'PRESENT';
      var scMap = {
        'Strong Signal': 'green', 'Moderate Signal': 'yellow', 'Weak Signal': 'orange',
        'Signal Lost': 'red', 'Outside Assigned Room': 'orange', '': 'grey'
      };
      var sc = scMap[ps.status || ''] || 'grey';

      return '<tr>' +
        '<td><span class="status-dot ' + sc + '" title="' + (ps.status || 'No Signal') + '"></span></td>' +
        '<td class="mono"><strong>' + s.id + '</strong></td>' +
        '<td class="student-name-cell">' + s.name + '</td>' +
        '<td>Class ' + s.classId + '</td>' +
        '<td class="mono">BCN-' + s.classId + '</td>' +
        '<td>' + (isPresent ? '<span class="green">Verified (' + (att.faceScore || 96) + '%)</span>' : '<span class="muted">Pending</span>') + '</td>' +
        '<td class="mono">' + (isPresent ? att.punchTime : '—') + '</td>' +
        '<td><span class="status-badge ' + att.statusClass + '">' + att.label + '</span></td>' +
        '<td class="mono">' + (ps.rssi != null ? ps.rssi + ' dBm' : '—') + '</td>' +
        '<td class="mono">' + (ps.lastSeen || '—') + '</td>' +
        '<td>' +
          '<button class="db-btn small ' + (isPresent ? 'secondary' : 'primary') + '" onclick="SchoolDashboard.handlePunchInFlow(\'' + s.id + '\',\'' + s.classId + '\')">' +
          (isPresent ? 'Verified ✅' : 'Punch In') + '</button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  function filterByClass(cls) {
    var sel = $('filter-class');
    if (sel) {
      sel.value = cls;
      updateAdminDashboard();
    }
  }

  function jumpToRoom3D(cls) {
    switchView('simulation');
    handlers.onEnterRoom(cls);
  }

  function exportAttendanceCSV() {
    var all = SchoolEngine.getAllMasterStudents();
    var headers = ['StudentID', 'Name', 'Class', 'Roll', 'AssignedBeacon', 'AttendanceStatus', 'PunchInTime', 'FaceScore', 'LatestRSSI_dBm'];
    var lines = [headers.join(',')];

    all.forEach(function(item) {
      var s = item.student, att = item.attendance, ps = item.presence;
      var row = [
        s.id,
        '"' + s.name + '"',
        s.classId,
        s.roll,
        'BCN-' + s.classId,
        att.status,
        att.punchTime || '',
        att.faceScore || '',
        ps.rssi != null ? ps.rssi : ''
      ];
      lines.push(row.join(','));
    });

    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'greenfield_academy_attendance_' + SchoolEngine.getSimTime24().replace(':', '') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Exported attendance CSV successfully', 'success');
  }

  /* ── 10. Central Library Monitoring ─────────────────────────────────────── */
  function initLibraryMonitoring() {
    // Initialized with default occupants
    updateLibraryMonitoring();
  }

  function updateLibraryMonitoring() {
    var sessions = SchoolEngine.getAllLibSessions();
    var activeList = [];
    Object.keys(sessions).forEach(function(k) {
      if (sessions[k].status === 'active') activeList.push(sessions[k]);
    });

    var activeEl = $('lib-active-count');
    if (activeEl) activeEl.textContent = activeList.length;
    var availEl = $('lib-available-count');
    if (availEl) availEl.textContent = Math.max(0, 24 - activeList.length);
    var pctEl = $('lib-occupancy-pct');
    if (pctEl) pctEl.textContent = Math.round((activeList.length / 24) * 100) + '%';

    var tbody = $('library-sessions-tbody');
    if (!tbody) return;

    if (activeList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No active library sessions right now.</td></tr>';
      return;
    }

    tbody.innerHTML = activeList.map(function(sess) {
      return '<tr>' +
        '<td><strong>' + sess.name + '</strong></td>' +
        '<td class="mono">' + sess.permanentId + '</td>' +
        '<td>Class ' + sess.classId + '</td>' +
        '<td class="mono green"><strong>' + sess.sessionId + '</strong></td>' +
        '<td class="mono">' + sess.start + '</td>' +
        '<td><span class="tag-green">Active In Library</span></td>' +
        '<td><button class="db-btn small" onclick="SchoolDashboard.endLibSession(\'' + sess.permanentId + '\')">End Session</button></td>' +
        '</tr>';
    }).join('');
  }

  function endLibSession(sid) {
    var res = SchoolEngine.endLibrarySession(sid);
    showToast(res.msg, res.ok ? 'success' : 'error');
    updateLibraryMonitoring();
  }

  /* ── 11. Face Verification Camera Modal & Punch-in Flow ─────────────────── */
  function initFaceModal() {
    var closeBtn = $('face-modal-close');
    var cancelBtn = $('fm-cancel-btn');
    var confirmBtn = $('fm-confirm-btn');

    if (closeBtn) closeBtn.addEventListener('click', closeFaceModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeFaceModal);

    if (confirmBtn) {
      confirmBtn.addEventListener('click', function() {
        if (!pendingPunchSid || !pendingPunchClass) return;
        var res = SchoolEngine.completePunchIn(pendingPunchSid, pendingPunchClass, {
          matched: true,
          score: 96.8
        });
        closeFaceModal();
        if (res.ok) {
          showToast(res.msg, 'success');
          // Update 3D scene student signal ring
          SchoolScene.setStudentSignalColor(pendingPunchSid, 0x10b981, 1.0);
          updateAllViews();
        } else {
          showToast(res.msg, 'error');
        }
      });
    }

    // Populate landmark dots
    var lmCont = $('fm-landmarks');
    if (lmCont) {
      lmCont.innerHTML = '';
      for (var i = 0; i < 48; i++) {
        var dot = document.createElement('div');
        dot.className = 'landmark-dot';
        dot.style.left = (20 + (i % 8) * 8 + Math.sin(i) * 3) + '%';
        dot.style.top  = (22 + Math.floor(i / 8) * 11 + Math.cos(i) * 3) + '%';
        lmCont.appendChild(dot);
      }
    }
  }

  function handlePunchInFlow(sid, classId) {
    var check = SchoolEngine.punchIn(sid, classId);
    if (!check.ok) {
      showToast(check.msg, 'error');
      return;
    }

    pendingPunchSid = sid;
    pendingPunchClass = classId;
    openFaceModal(sid, classId);
  }

  function openFaceModal(sid, classId) {
    var modal = $('face-modal');
    if (!modal) return;
    var rep = SchoolEngine.getStudentReport(sid);
    var s = rep.student;

    var nameEl = $('fm-student-name');
    if (nameEl) nameEl.textContent = s ? s.name : sid;
    var metaEl = $('fm-student-meta');
    if (metaEl) metaEl.textContent = 'ID: ' + sid + ' · Class ' + classId + ' · Beacon BCN-' + classId + ' Verified';
    var initEl = $('fm-initial');
    if (initEl) initEl.textContent = s ? s.name.charAt(0) : 'S';

    var scoreText = $('fm-score-text');
    var statusOverlay = $('fm-scan-status');
    var confirmBtn = $('fm-confirm-btn');

    if (scoreText) scoreText.textContent = 'Scanning facial biometrics…';
    if (statusOverlay) statusOverlay.innerHTML = '<div class="sso-text">🔍 Aligning facial landmarks…</div>';
    if (confirmBtn) confirmBtn.disabled = true;

    modal.style.display = 'flex';

    // Simulate real-time biometric scan
    setTimeout(function() {
      if (statusOverlay) statusOverlay.innerHTML = '<div class="sso-text green">✅ Match Confirmed (96.8%)</div>';
      if (scoreText) scoreText.innerHTML = '<span class="green">96.8% match (Authorized Student Face)</span>';
      if (confirmBtn) confirmBtn.disabled = false;
    }, 1400);
  }

  function closeFaceModal() {
    var modal = $('face-modal');
    if (modal) modal.style.display = 'none';
    pendingPunchSid = null;
    pendingPunchClass = null;
  }

  /* ── 12. Minimap ─────────────────────────────────────────────────────────── */
  function drawMinimap() {
    if (!miniCtx) return;
    var w = miniCtx.canvas.width, h = miniCtx.canvas.height;
    miniCtx.clearRect(0, 0, w, h);

    // Background
    miniCtx.fillStyle = '#0f172a';
    miniCtx.fillRect(0, 0, w, h);

    var scaleX = w / SCHOOL.width, scaleZ = h / SCHOOL.depth;

    // Rooms
    SCHOOL_ROOMS.forEach(function(r) {
      miniCtx.fillStyle = r.type === 'corridor' ? '#1e293b' : '#142036';
      miniCtx.fillRect(r.x1 * scaleX, r.z1 * scaleZ, (r.x2 - r.x1) * scaleX, (r.z2 - r.z1) * scaleZ);
      miniCtx.strokeStyle = '#334155';
      miniCtx.lineWidth = 1;
      miniCtx.strokeRect(r.x1 * scaleX, r.z1 * scaleZ, (r.x2 - r.x1) * scaleX, (r.z2 - r.z1) * scaleZ);

      // Label
      if (r.type !== 'corridor') {
        miniCtx.fillStyle = '#64748b';
        miniCtx.font = '9px "Inter",sans-serif';
        miniCtx.textAlign = 'center';
        miniCtx.fillText(r.id, (r.x1 + r.x2) / 2 * scaleX, (r.z1 + r.z2) / 2 * scaleZ + 3);
      }
    });

    // Beacons
    SCHOOL_BEACONS.forEach(function(b) {
      miniCtx.fillStyle = '#' + b.color.toString(16).padStart(6, '0');
      miniCtx.beginPath();
      miniCtx.arc(b.x * scaleX, b.z * scaleZ, 3.5, 0, Math.PI * 2);
      miniCtx.fill();
    });

    // Player position
    var player = SchoolScene.getPlayer();
    if (player) {
      miniCtx.fillStyle = '#facc15';
      miniCtx.beginPath();
      miniCtx.arc(player.x * scaleX, player.z * scaleZ, 4.5, 0, Math.PI * 2);
      miniCtx.fill();
    }
  }

  /* ── 13. Toast Notification ─────────────────────────────────────────────── */
  var toastTimer = null;
  function showToast(msg, type) {
    var t = $('db-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'db-toast show ' + (type || 'info');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function() {
      t.className = 'db-toast';
    }, 3200);
  }

  /* ── 14. Synchronized Update Tick ───────────────────────────────────────── */
  function update() {
    var stats = SchoolEngine.getOverviewStats();
    var p1 = stats.periodStatus;

    // Topbar
    var clockEl = $('db-clock');
    if (clockEl) clockEl.textContent = stats.simTime;
    var topPill = $('top-period-pill');
    var topPillText = $('top-period-text');
    if (topPillText) topPillText.textContent = p1.name + ' (' + p1.startStr + '–' + p1.endStr + ') · ' + p1.statusLabel;
    if (topPill) {
      topPill.className = 'period-pill ' + (p1.state === 'ACTIVE' ? 'active' : p1.state === 'NOT_STARTED' ? 'not-started' : 'closed');
    }

    // 3D Sidebar stats
    var set = function(id, val) { var el = $(id); if (el) el.textContent = val; };
    set('ov-total', stats.total);
    set('ov-present', stats.present);
    set('ov-not-marked', stats.notMarked);
    set('ov-absent', stats.absent);
    set('ov-pct', stats.pct + '%');
    var prog = $('ov-prog-fill');
    if (prog) prog.style.width = stats.pct + '%';
    set('ov-session-status', p1.statusLabel);

    updatePeriodBar(stats.simMinutes);
    drawMinimap();

    // Active View Update
    if (activeView === 'student-app') {
      updateStudentApp();
    } else if (activeView === 'admin-dashboard') {
      updateAdminDashboard();
    } else if (activeView === 'library') {
      updateLibraryMonitoring();
    } else if (activeTab === 'classroom') {
      updateClassroomRoster(activeClassId);
    }
  }

  function updateAllViews() {
    update();
    if (activeView === 'student-app') updateStudentApp();
    if (activeView === 'admin-dashboard') updateAdminDashboard();
    if (activeView === 'library') updateLibraryMonitoring();
  }

  /* ── Beacon Grid UI ─────────────────────────────────────────────────────── */
  function renderBeaconPanel() {
    var grid = $('db-beacon-grid');
    if (!grid) return;
    grid.innerHTML = SCHOOL_BEACONS.map(function(b) {
      return '<div class="beacon-card" style="--bc:#' + b.color.toString(16).padStart(6, '0') + '">' +
        '<div class="bc-header">' +
          '<span class="bc-led" style="background:#' + b.color.toString(16).padStart(6, '0') + '"></span>' +
          '<span class="bc-id">' + b.id + '</span>' +
        '</div>' +
        '<div class="bc-room">' + b.name + '</div>' +
        '<div class="bc-props">' +
          '<div><span class="k">TxPower</span><span class="v mono">' + b.txPower + ' dBm</span></div>' +
          '<div><span class="k">Major/Minor</span><span class="v mono">' + b.major + '/' + b.minor + '</span></div>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  /* ── Public Interface ───────────────────────────────────────────────────── */
  return {
    init: init,
    update: update,
    setStatus: setStatus,
    showToast: showToast,
    switchView: switchView,
    jumpSimTime: jumpSimTime,
    handlePunchInFlow: handlePunchInFlow,
    handleStudentSelect: handleStudentSelect,
    renderStudentList: renderStudentList,
    filterByClass: filterByClass,
    jumpToRoom3D: jumpToRoom3D,
    endLibSession: endLibSession
  };
})();

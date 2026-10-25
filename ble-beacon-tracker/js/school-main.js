/* =============================================================================
 * school-main.js  –  Orchestrator: wires Scene + Engine + Dashboard
 * ========================================================================== */
'use strict';

(function() {

  if (!window.THREE || !THREE.OrbitControls) {
    document.getElementById('canvas-host').innerHTML =
      '<p style="padding:24px;color:#fca5a5;font-size:14px">⚠ Three.js failed to load. ' +
      'Please check that <code>js/lib/three.min.js</code> and <code>js/lib/OrbitControls.js</code> ' +
      'exist, or ensure you have an internet connection for CDN fallback.</p>';
    return;
  }

  var simStatus = 'idle';

  /* ── Dashboard handler callbacks ─────────────────────────────────────── */
  var handlers = {
    onStart: function() {
      simStatus = 'running';
      SchoolEngine.setRunning(true);
      SchoolDashboard.setStatus('running');
    },
    onPause: function() {
      simStatus = 'paused';
      SchoolEngine.setRunning(false);
      SchoolDashboard.setStatus('paused');
    },
    onReset: function() {
      simStatus = 'idle';
      SchoolEngine.init();
      SchoolDashboard.setStatus('idle');
      SchoolDashboard.showToast('Simulation reset to 09:00','info');
      var cl = document.getElementById('db-clock');
      if(cl) cl.textContent='09:00';
    },
    onSpeed: function(v) {
      SchoolEngine.setSimSpeed(v);
    },
    onNextPeriod: function() {
      SchoolEngine.advancePeriod();
      var p=SchoolEngine.activePeriod();
      SchoolDashboard.showToast(p?'Advanced to '+p.name+' – '+p.subject:'Break time','info');
    },
    onEnterRoom: function(roomId) {
      SchoolScene.enterFPS(roomId);
    },
    onToggleFPS: function() {
      if(SchoolScene.getMode()==='fps') SchoolScene.enterOverview();
      else SchoolScene.enterFPS('CORR');
    },
    onPunchIn: function(studentId, classId) {
      SchoolDashboard.handlePunchInFlow(studentId, classId);
    }
  };

  /* ── Scene callbacks ─────────────────────────────────────────────────── */
  SchoolScene.onRoomChange = function(roomId, room) {
    var el = document.getElementById('db-current-room');
    if(el) el.textContent = room ? room.name : roomId;
    var caption = document.getElementById('db-caption');
    if(caption && room) caption.textContent = room.name + (room.type==='classroom'?' – '+room.beaconId:'');
    // Auto-switch dashboard to relevant class
    if(room && room.type==='classroom') {
      SchoolDashboard.renderStudentList(roomId);
    }
  };

  SchoolScene.onStudentClick = function(sid) {
    // Find which class this student belongs to
    var cls = null;
    Object.keys(SCHOOL_STUDENTS).forEach(function(c){
      if(!cls && SCHOOL_STUDENTS[c].find(function(s){return s.id===sid;})) cls=c;
    });
    SchoolDashboard.handleStudentSelect(sid, cls);
    SchoolDashboard.showToast('Selected: '+sid,'info');
  };

  SchoolScene.onModeChange = function(newMode) {
    var enterBtn = document.getElementById('enter-fps-btn');
    if(enterBtn) enterBtn.textContent = newMode==='fps'?'🗺 Overview':'▶ Enter School (FPS)';
    var hint = document.getElementById('view-hint');
    if(hint) hint.textContent = newMode==='fps'
      ? 'WASD to move · Mouse to look · E to interact · Esc / F to exit'
      : 'Drag to orbit · Scroll to zoom · Click room or press F to enter FPS';
  };

  /* ── Engine callbacks ─────────────────────────────────────────────────── */
  SchoolEngine.setClockCb(function(mins) {
    var h=Math.floor(mins/60)%24, m=Math.floor(mins%60);
    var str=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
    var cl=document.getElementById('db-clock'); if(cl) cl.textContent=str;
    var ov=document.getElementById('ov-simtime'); if(ov) ov.textContent=str;
  });

  SchoolEngine.setPeriodCb(function(period) {
    var msg=period?'Period '+period.id+' started – '+period.subject:'Break time – no active period';
    SchoolDashboard.showToast(msg,'info');
    // Update signal ring colors for all students by period status
    if(period) {
      ['10A','10B','10C','9A','9B','9C'].forEach(function(cls){
        (SCHOOL_STUDENTS[cls]||[]).forEach(function(s){
          SchoolScene.setStudentSignalColor(s.id, 0x22c55e, 0.75);
        });
      });
    }
  });

  /* ── Update student signal ring colors based on Attendance & Presence ── */
  function updateSignalRings() {
    ['10A', '10B', '10C', '9A', '9B', '9C'].forEach(function(cls) {
      (SCHOOL_STUDENTS[cls] || []).forEach(function(s) {
        var att = SchoolEngine.getStudentAttendance(s.id, cls, 'P1');
        var ps  = SchoolEngine.getPresence(s.id);

        if (att.status === 'PRESENT') {
          // Punched in & verified -> Emerald Green
          SchoolScene.setStudentSignalColor(s.id, 0x10b981, 0.95);
        } else if (att.status === 'ABSENT') {
          // Finalized Absent -> Red
          SchoolScene.setStudentSignalColor(s.id, 0xef4444, 0.7);
        } else {
          // NOT MARKED yet (pending)
          if (!ps || ps.status === 'Signal Lost') {
            SchoolScene.setStudentSignalColor(s.id, 0xef4444, 0.5);
          } else if (ps.status === 'Strong Signal') {
            SchoolScene.setStudentSignalColor(s.id, 0x38bdf8, 0.75); // Cyan active
          } else if (ps.status === 'Moderate Signal') {
            SchoolScene.setStudentSignalColor(s.id, 0xfacc15, 0.7);  // Yellow
          } else {
            SchoolScene.setStudentSignalColor(s.id, 0xf97316, 0.6);  // Orange
          }
        }
      });
    });
  }

  /* ── Frame loop ──────────────────────────────────────────────────────── */
  var lastTime = performance.now();
  var engineAccum = 0;
  var dashAccum   = 0;
  var fpsEl = document.getElementById('db-fps');

  function frame(now) {
    var dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Engine tick (high frequency)
    engineAccum += dt;
    if(engineAccum >= 0.1) {
      SchoolEngine.tick(engineAccum, now/1000);
      updateSignalRings();
      engineAccum = 0;
    }

    // 3D scene render (every frame)
    SchoolScene.render(dt, now/1000);

    // Dashboard update (lower frequency)
    dashAccum += dt;
    if(dashAccum >= 0.35) {
      SchoolDashboard.update();
      if(fpsEl) fpsEl.textContent=Math.round(SchoolScene.getFps())+'fps';
      dashAccum = 0;
    }

    requestAnimationFrame(frame);
  }

  /* ── Boot ────────────────────────────────────────────────────────────── */
  SchoolEngine.init();
  SchoolScene.init(document.getElementById('canvas-host'));
  SchoolDashboard.init(handlers);
  SchoolDashboard.setStatus('idle');
  SchoolDashboard.showToast('🏫 3D Smart School loaded — click ▶ Start or press F to explore!','success');

  requestAnimationFrame(frame);

})();

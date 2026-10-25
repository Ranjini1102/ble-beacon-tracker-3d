/* =============================================================================
 * attendance-engine.js
 * -----------------------------------------------------------------------------
 * Period-based attendance + presence monitoring engine.
 * All data is simulated - no real BLE hardware.
 * ========================================================================== */

const AttendanceEngine = (function () {
  'use strict';

  /* Simulated clock (minutes since midnight). Starts at 9:00 AM. */
  let simMinutes = 9 * 60;
  let simSpeed = 30; // sim minutes per real second (when running)
  let running = false;
  let clockCallback = null;

  /* Student attendance records */
  /* { studentId -> { periodId -> { status, punchTime, presenceStatus, lastSeen, confidence, faceVerified } } } */
  const records = {};

  /* Student presence state (live, updated each scan) */
  const presenceState = {};
  /* { studentId -> { roomId, rssi, confidence, lastSeen, hysteresisCount, prevRoomId, status } } */

  /* Hysteresis buffer per student (rolling window of room candidates) */
  const hysBuf = {};

  function init() {
    DEMO_STUDENTS.forEach(function (s) {
      records[s.id] = {};
      presenceState[s.id] = {
        roomId: null, rssi: -100, confidence: 0,
        lastSeen: 0, hysteresisCount: 0, prevRoomId: null,
        status: 'Unknown', graceTimer: 0
      };
      hysBuf[s.id] = [];
      TIMETABLE.forEach(function (p) {
        records[s.id][p.periodId] = {
          status: 'not_started',   // not_started | active | punched | absent | ended
          punchTime: null,
          presenceStatus: 'Unknown',  // Present | Signal Weak | Temporarily Lost | Outside | Session Ended
          lastSeen: null,
          confidence: 0,
          faceVerified: false,
          faceScore: 0,
          signalHistory: []
        };
      });
    });
  }

  /* Returns the active period for simulated time, or null */
  function activePeriod() {
    for (let i = 0; i < TIMETABLE.length; i++) {
      const p = TIMETABLE[i];
      const start = p.startHour * 60 + p.startMin;
      const end   = p.endHour * 60 + p.endMin;
      if (simMinutes >= start && simMinutes < end) return p;
    }
    return null;
  }

  /* Returns minutes remaining in the active period (or 0) */
  function minutesRemaining() {
    const p = activePeriod();
    if (!p) return 0;
    return (p.endHour * 60 + p.endMin) - simMinutes;
  }

  /* Advance simulated clock */
  function tickClock(dtSec) {
    if (!running) return;
    simMinutes += dtSec * simSpeed / 60;
    if (simMinutes >= 24 * 60) simMinutes = 8 * 60;
    if (clockCallback) clockCallback(simMinutes);
  }

  /* Determine beacon the student "sees" based on position (called by campus-main) */
  function updateStudentPresence(studentId, px, pz, nowSec) {
    const ps = presenceState[studentId];
    if (!ps) return;

    const heightDiff = CAMPUS_SIM.beaconHeight - CAMPUS_SIM.receiverHeight;

    // Find strongest visible beacon for this student
    let bestRssi = -200, bestBeacon = null;
    CAMPUS_BEACONS.forEach(function (b) {
      const dx = px - b.x, dz = pz - b.z;
      const d2 = Math.hypot(dx, dz);
      const d3 = Math.sqrt(d2 * d2 + heightDiff * heightDiff);
      const walls = wallsBetween(px, pz, b.x, b.z);
      const rawRssi = b.txPower - 10 * (b.pathLoss || campusParams.pathLossExp) * Math.log10(Math.max(d3, 0.1))
                    + (Math.random() - 0.5) * 2 * campusParams.noiseStd
                    - walls * campusParams.wallAttenuation;
      const rssi = Math.round(clamp(rawRssi, -100, -30));
      if (rssi > bestRssi && rssi > campusParams.detectionThreshold) {
        bestRssi = rssi;
        bestBeacon = b;
      }
    });

    // Hysteresis: accumulate candidates
    const buf = hysBuf[studentId];
    buf.push(bestBeacon ? bestBeacon.roomId : null);
    if (buf.length > campusParams.hysteresisDwell) buf.shift();

    // Commit room only if majority agrees
    const counts = {};
    buf.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
    let topRoom = null, topCount = 0;
    Object.keys(counts).forEach(function (r) {
      if (counts[r] > topCount) { topCount = counts[r]; topRoom = r; }
    });

    if (topCount >= Math.ceil(buf.length * 0.6)) {
      ps.prevRoomId = ps.roomId;
      ps.roomId = topRoom;
    }

    ps.rssi = bestRssi;
    ps.confidence = bestBeacon ? Math.round(clamp((bestRssi + 100) / 70 * 100, 5, 99)) : 0;
    ps.lastSeen = nowSec;

    // Presence status
    const period = activePeriod();
    if (!period) {
      ps.status = 'No Active Session';
      return;
    }
    const schedule = CLASS_SCHEDULE[period.periodId];
    const assignedRoom = schedule ? schedule.roomId : null;

    if (!bestBeacon || bestRssi < campusParams.detectionThreshold) {
      ps.graceTimer = (ps.graceTimer || 0) + campusParams.scanInterval;
      if (ps.graceTimer > campusParams.gracePeriodSec) {
        ps.status = 'Temporarily Lost';
      } else {
        ps.status = 'Signal Weak';
      }
    } else {
      ps.graceTimer = 0;
      if (ps.roomId === assignedRoom) {
        ps.status = bestRssi > -70 ? 'Present' : 'Signal Weak';
      } else {
        ps.status = 'Outside Assigned Room';
      }
    }

    // Update per-period record
    const rec = records[studentId][period.periodId];
    if (rec) {
      rec.presenceStatus = ps.status;
      rec.lastSeen = new Date().toLocaleTimeString();
      rec.confidence = ps.confidence;
      rec.signalHistory.push(bestRssi);
      if (rec.signalHistory.length > 60) rec.signalHistory.shift();
      if (rec.status === 'not_started') rec.status = 'active';
    }
  }

  /* Student attempts punch-in */
  function punchIn(studentId, nowSec) {
    const period = activePeriod();
    if (!period) return { ok: false, msg: 'No active class period.' };

    const schedule = CLASS_SCHEDULE[period.periodId];
    if (!schedule) return { ok: false, msg: 'No class scheduled.' };

    const rec = records[studentId][period.periodId];
    if (!rec) return { ok: false, msg: 'Student record not found.' };
    if (rec.status === 'punched') return { ok: false, msg: 'Already punched in for this period.' };
    if (rec.status === 'ended')   return { ok: false, msg: 'Period has ended.' };

    const ps = presenceState[studentId];
    if (!ps) return { ok: false, msg: 'Presence state unavailable.' };

    // Check BLE signal
    if (ps.roomId !== schedule.roomId) {
      return { ok: false, msg: 'Not detected in assigned classroom. Current location: ' + (ps.roomId || 'Unknown') };
    }
    if (ps.confidence < 30) {
      return { ok: false, msg: 'Signal too weak. Confidence: ' + ps.confidence + '%. Move closer to the beacon.' };
    }

    // Punch-in window check (within first punchInWindow seconds)
    const periodStart = TIMETABLE.find(function (p) { return p.periodId === period.periodId; });
    if (periodStart) {
      const startMin = periodStart.startHour * 60 + periodStart.startMin;
      const elapsedMin = simMinutes - startMin;
      if (elapsedMin > campusParams.punchInWindow / 60) {
        return { ok: false, msg: 'Punch-in window expired. Contact faculty.' };
      }
    }

    rec.status = 'punched';
    rec.punchTime = formatSimTime();
    return { ok: true, msg: 'Attendance recorded at ' + rec.punchTime };
  }

  /* Simulate face verification */
  function runFaceVerification(studentId) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        // Simulate biometric match with realistic variability
        const score = 75 + Math.random() * 22;
        const matched = score > 80;
        const rec = getStudentPeriodRecord(studentId);
        if (rec && matched) {
          rec.faceVerified = true;
          rec.faceScore = Math.round(score);
        }
        resolve({
          matched: matched,
          score: Math.round(score),
          status: matched ? 'Face verified (simulated)' : 'Face match failed – manual fallback required',
          simulated: true
        });
      }, 1200 + Math.random() * 800);
    });
  }

  function getStudentPeriodRecord(studentId) {
    const period = activePeriod();
    if (!period) return null;
    return records[studentId] && records[studentId][period.periodId] || null;
  }

  function formatSimTime() {
    const h = Math.floor(simMinutes / 60) % 24;
    const m = Math.floor(simMinutes % 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  /* Stats for the admin dashboard */
  function getOverviewStats() {
    const period = activePeriod();
    let totalPresent = 0, totalAbsent = 0, totalPunched = 0;
    DEMO_STUDENTS.forEach(function (s) {
      const ps = presenceState[s.id];
      if (ps && ps.status === 'Present') totalPresent++;
      if (ps && ps.status === 'Outside Assigned Room') totalAbsent++;
      if (period) {
        const rec = records[s.id][period.periodId];
        if (rec && rec.status === 'punched') totalPunched++;
      }
    });
    return {
      totalStudents: DEMO_STUDENTS.length,
      present: totalPresent,
      absent: totalAbsent,
      punched: totalPunched,
      activePeriod: period,
      simTime: formatSimTime(),
      simMinutes: simMinutes
    };
  }

  function getStudentReport(studentId) {
    return {
      student: DEMO_STUDENTS.find(function (s) { return s.id === studentId; }),
      periods: records[studentId],
      presence: presenceState[studentId]
    };
  }

  function advancePeriod() {
    const p = activePeriod();
    if (p) {
      simMinutes = p.endHour * 60 + p.endMin + 1;
    } else {
      // Jump to next period start
      for (let i = 0; i < TIMETABLE.length; i++) {
        const t = TIMETABLE[i];
        const start = t.startHour * 60 + t.startMin;
        if (start > simMinutes) { simMinutes = start; break; }
      }
    }
  }

  function setClockCallback(fn) { clockCallback = fn; }
  function setRunning(v) { running = v; }
  function resetClock() {
    simMinutes = 9 * 60;
    DEMO_STUDENTS.forEach(function (s) { init(); });
  }

  return {
    init: init,
    activePeriod: activePeriod,
    minutesRemaining: minutesRemaining,
    tickClock: tickClock,
    updateStudentPresence: updateStudentPresence,
    punchIn: punchIn,
    runFaceVerification: runFaceVerification,
    getOverviewStats: getOverviewStats,
    getStudentReport: getStudentReport,
    getPresence: function (id) { return presenceState[id]; },
    getAllPresence: function () { return presenceState; },
    getAllRecords: function () { return records; },
    advancePeriod: advancePeriod,
    formatSimTime: formatSimTime,
    setClockCallback: setClockCallback,
    setRunning: setRunning,
    resetClock: resetClock
  };
})();

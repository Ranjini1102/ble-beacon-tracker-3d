// test_engine.js - Verification of SchoolEngine state machine and data structures
var fs = require('fs');

var vm = require('vm');

// Mock browser globals needed by config & engine
global.window = global;
global.clamp = function(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

// Load config and engine into global context
vm.runInThisContext(fs.readFileSync('js/school-config.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('js/school-engine.js', 'utf8'));

console.log('--- TEST 1: Students & Classrooms ---');
var total = 0;
['10A', '10B', '10C', '9A', '9B', '9C'].forEach(function(cls) {
  var count = SCHOOL_STUDENTS[cls].length;
  total += count;
  console.log('Class ' + cls + ': ' + count + ' students, Beacon: BCN-' + cls);
});
console.log('Total students enrolled:', total);
if (total !== 120) throw new Error('Expected 120 students, got ' + total);

console.log('\n--- TEST 2: Student Attributes (Faces, Hair, Uniforms) ---');
var s1 = SCHOOL_STUDENTS['10A'][0];
console.log('Student 1:', s1.name, 'Gender:', s1.gender, 'Skin:', s1.skinTone, 'Hair:', s1.hairStyle, 'Eye:', s1.eyeColor);
if (!s1.skinTone || !s1.hairStyle || !s1.gender) throw new Error('Missing rich student styling attributes');

console.log('\n--- TEST 3: Period 1 Lifecycle & Attendance Rules ---');
SchoolEngine.init();

// Before 09:00 AM (e.g. 08:50 AM)
SchoolEngine.setSimTime(8, 50);
var pStatusBefore = SchoolEngine.getPeriod1Status();
console.log('At 08:50 AM:', pStatusBefore.state, '| canPunchIn:', pStatusBefore.canPunchIn, '|', pStatusBefore.statusLabel);
if (pStatusBefore.state !== 'NOT_STARTED' || pStatusBefore.canPunchIn !== false) {
  throw new Error('Failed: 08:50 AM should be NOT_STARTED and punch-in disabled');
}
var attBefore = SchoolEngine.getStudentAttendance(s1.id, s1.classId, 'P1');
console.log('Student attendance status at 08:50 AM:', attBefore.status, '(' + attBefore.label + ')');
if (attBefore.status !== 'NOT_MARKED') throw new Error('Student status before period should be NOT_MARKED');

// Try punch-in at 08:50 AM -> should be rejected
var punchResBefore = SchoolEngine.punchIn(s1.id, s1.classId);
console.log('Attempt punch-in at 08:50 AM:', punchResBefore.ok, punchResBefore.msg);
if (punchResBefore.ok !== false) throw new Error('Punch-in before 09:00 AM must be rejected');

// Advance to 09:15 AM (Active Session)
SchoolEngine.setSimTime(9, 15);
SchoolEngine.tick(0.1, 100);
var pStatusActive = SchoolEngine.getPeriod1Status();
console.log('\nAt 09:15 AM:', pStatusActive.state, '| canPunchIn:', pStatusActive.canPunchIn, '|', pStatusActive.statusLabel);
if (pStatusActive.state !== 'ACTIVE' || pStatusActive.canPunchIn !== true) {
  throw new Error('Failed: 09:15 AM should be ACTIVE and punch-in enabled');
}

// Complete punch-in for Student 1
var punchRes = SchoolEngine.completePunchIn(s1.id, s1.classId, { matched: true, score: 97.2 });
console.log('Punch-in result at 09:15 AM:', punchRes.ok, punchRes.msg);
if (!punchRes.ok) throw new Error('Punch-in during active period failed: ' + punchRes.msg);

var attActive1 = SchoolEngine.getStudentAttendance(s1.id, s1.classId, 'P1');
console.log('Student 1 status after punch-in:', attActive1.status, 'Time:', attActive1.punchTime, 'Score:', attActive1.faceScore);
if (attActive1.status !== 'PRESENT') throw new Error('Student 1 should be PRESENT');

var s2 = SCHOOL_STUDENTS['10A'][1];
var attActive2 = SchoolEngine.getStudentAttendance(s2.id, s2.classId, 'P1');
console.log('Student 2 (unpunched) status at 09:15 AM:', attActive2.status);
if (attActive2.status !== 'NOT_MARKED') throw new Error('Unpunched student at 09:15 AM should be NOT_MARKED');

// Advance to 10:05 AM (Session Closed)
SchoolEngine.setSimTime(10, 5);
var pStatusClosed = SchoolEngine.getPeriod1Status();
console.log('\nAt 10:05 AM:', pStatusClosed.state, '| canPunchIn:', pStatusClosed.canPunchIn, '|', pStatusClosed.statusLabel);
if (pStatusClosed.state !== 'CLOSED' || pStatusClosed.canPunchIn !== false) {
  throw new Error('Failed: 10:05 AM should be CLOSED and punch-in disabled');
}

var attClosed1 = SchoolEngine.getStudentAttendance(s1.id, s1.classId, 'P1');
console.log('Student 1 (punched in earlier) at 10:05 AM:', attClosed1.status);
if (attClosed1.status !== 'PRESENT') throw new Error('Student 1 should remain PRESENT after session closes');

var attClosed2 = SchoolEngine.getStudentAttendance(s2.id, s2.classId, 'P1');
console.log('Student 2 (unpunched) at 10:05 AM:', attClosed2.status);
if (attClosed2.status !== 'ABSENT') throw new Error('Unpunched student at 10:05 AM should be finalized as ABSENT');

console.log('\n--- TEST 4: Central Library Tracking & Session IDs ---');
// s1 had a default active session from init, let's end it and start a new one
SchoolEngine.endLibrarySession(s1.id);
var libRes = SchoolEngine.startLibrarySession(s1);
console.log('Library session start:', libRes.ok, 'Session ID:', libRes.sessionId);
if (!libRes.ok || !libRes.sessionId || libRes.sessionId.indexOf('LIB-SESSION') === -1) {
  throw new Error('Failed to create library session ID');
}
var sess = SchoolEngine.getLibSession(s1.id);
console.log('Library session permanent ID:', sess.permanentId, '| Session ID:', sess.sessionId, '| Status:', sess.status);
if (sess.permanentId !== s1.id) throw new Error('Permanent student ID was not preserved');

console.log('\n--- TEST 5: Overview Stats Summary ---');
var overview = SchoolEngine.getOverviewStats();
console.log('Total:', overview.total, 'Present:', overview.present, 'Absent:', overview.absent, 'Not Marked:', overview.notMarked, 'Pct:', overview.pct + '%');
console.log('Active Beacons:', overview.activeBeacons, 'Active Library Sessions:', overview.activeLibSessions);

console.log('\n✅ ALL 5 ENGINE TESTS PASSED PERFECTLY!');

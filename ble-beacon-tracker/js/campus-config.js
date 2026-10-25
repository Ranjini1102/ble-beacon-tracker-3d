/* =============================================================================
 * campus-config.js
 * -----------------------------------------------------------------------------
 * All static data for the Smart Campus Attendance & Indoor Tracking System.
 *
 * Coordinate system (metres):
 *   X -> right (east)    0..40
 *   Z -> south (viewer)  0..28
 *   Y -> up (height)
 * ========================================================================== */

/* ---------- Building dimensions ---------- */
const CAMPUS = {
  width: 40,
  depth: 28,
  wallHeight: 3.0,
  wallThickness: 0.22,
  doorWidth: 1.6,
  doorHeight: 2.2,
  floorCount: 1
};

/* ---------- Rooms ---------- */
const CAMPUS_ROOMS = [
  // Top row – classrooms
  { id: 'A101', name: 'Classroom A101', x1: 0,  z1: 0,  x2: 9,  z2: 10, color: 0xbfdbfe, type: 'classroom', capacity: 35 },
  { id: 'A102', name: 'Classroom A102', x1: 9,  z1: 0,  x2: 18, z2: 10, color: 0xfde9a9, type: 'classroom', capacity: 35 },
  { id: 'A103', name: 'Classroom A103', x1: 18, z1: 0,  x2: 27, z2: 10, color: 0xbbf7d0, type: 'classroom', capacity: 35 },
  { id: 'A104', name: 'Classroom A104', x1: 27, z1: 0,  x2: 40, z2: 10, color: 0xfbcfe8, type: 'classroom', capacity: 35 },
  // Corridor
  { id: 'CORR', name: 'Main Corridor',  x1: 0,  z1: 10, x2: 40, z2: 13, color: 0xe2e8f0, type: 'corridor',  capacity: 0  },
  // Bottom row – library zones + faculty
  { id: 'LIB-A', name: 'Library – Reading Area',     x1: 0,  z1: 13, x2: 10, z2: 28, color: 0xddd6fe, type: 'library',  capacity: 30 },
  { id: 'LIB-B', name: 'Library – Reference Section', x1: 10, z1: 13, x2: 20, z2: 28, color: 0xe0f2fe, type: 'library',  capacity: 20 },
  { id: 'LIB-C', name: 'Library – Quiet Study Area',  x1: 20, z1: 13, x2: 30, z2: 28, color: 0xfef9c3, type: 'library',  capacity: 20 },
  { id: 'FACULTY', name: 'Faculty Room',             x1: 30, z1: 13, x2: 40, z2: 21, color: 0xfed7aa, type: 'faculty',  capacity: 10 },
  { id: 'LIB-D', name: 'Library – Entrance',        x1: 30, z1: 21, x2: 40, z2: 28, color: 0xd1fae5, type: 'library',  capacity: 5  }
];

/* ---------- Wall layout ---------- */
const CAMPUS_WALL_SPECS = [
  // Outer walls
  { orient: 'h', pos: 0,  from: 0,  to: 40, doors: [] },
  { orient: 'h', pos: 28, from: 0,  to: 40, doors: [] },
  { orient: 'v', pos: 0,  from: 0,  to: 28, doors: [] },
  { orient: 'v', pos: 40, from: 0,  to: 28, doors: [] },
  // Corridor walls
  { orient: 'h', pos: 10, from: 0,  to: 40, doors: [4.5, 13.5, 22.5, 33.5] },
  { orient: 'h', pos: 13, from: 0,  to: 40, doors: [5,   14,   23,   35  ] },
  // Vertical dividers – classrooms
  { orient: 'v', pos: 9,  from: 0,  to: 10, doors: [] },
  { orient: 'v', pos: 18, from: 0,  to: 10, doors: [] },
  { orient: 'v', pos: 27, from: 0,  to: 10, doors: [] },
  // Vertical dividers – library / faculty
  { orient: 'v', pos: 10, from: 13, to: 28, doors: [] },
  { orient: 'v', pos: 20, from: 13, to: 28, doors: [] },
  { orient: 'v', pos: 30, from: 13, to: 28, doors: [] },
  // Faculty / library-D divider
  { orient: 'h', pos: 21, from: 30, to: 40, doors: [35] }
];

/* Build CAMPUS_WALL_PIECES and CAMPUS_DOORS */
const CAMPUS_WALL_PIECES = [];
const CAMPUS_DOORS = [];
(function buildCampusWalls() {
  const half = CAMPUS.wallThickness / 2;
  const halfDoor = CAMPUS.doorWidth / 2;
  CAMPUS_WALL_SPECS.forEach(function (spec) {
    const doors = spec.doors.slice().sort(function (a, b) { return a - b; });
    const intervals = [];
    let cursor = spec.from;
    doors.forEach(function (centre) {
      if (centre - halfDoor > cursor) intervals.push([cursor, centre - halfDoor]);
      cursor = centre + halfDoor;
      if (spec.orient === 'h') {
        CAMPUS_DOORS.push({ x1: centre - halfDoor, x2: centre + halfDoor, z1: spec.pos - half, z2: spec.pos + half });
      } else {
        CAMPUS_DOORS.push({ x1: spec.pos - half, x2: spec.pos + half, z1: centre - halfDoor, z2: centre + halfDoor });
      }
    });
    if (spec.to > cursor) intervals.push([cursor, spec.to]);
    intervals.forEach(function (iv) {
      const a = (iv[0] === spec.from) ? iv[0] - half : iv[0];
      const b = (iv[1] === spec.to)   ? iv[1] + half : iv[1];
      if (spec.orient === 'h') {
        CAMPUS_WALL_PIECES.push({ x1: a, x2: b, z1: spec.pos - half, z2: spec.pos + half });
      } else {
        CAMPUS_WALL_PIECES.push({ x1: spec.pos - half, x2: spec.pos + half, z1: a, z2: b });
      }
    });
  });
})();

/* ---------- BLE Beacons (one per room) ---------- */
const CAMPUS_BEACONS = [
  // Classroom beacons
  { id: 'BC-A101', roomId: 'A101', name: 'Beacon A101', x: 4.5,  z: 5,   color: 0xff6b4a, txPower: -59, pathLoss: 2.8, wallAtten: 12 },
  { id: 'BC-A102', roomId: 'A102', name: 'Beacon A102', x: 13.5, z: 5,   color: 0x34d399, txPower: -59, pathLoss: 2.8, wallAtten: 12 },
  { id: 'BC-A103', roomId: 'A103', name: 'Beacon A103', x: 22.5, z: 5,   color: 0x60a5fa, txPower: -59, pathLoss: 2.8, wallAtten: 12 },
  { id: 'BC-A104', roomId: 'A104', name: 'Beacon A104', x: 33.5, z: 5,   color: 0xfbbf24, txPower: -59, pathLoss: 2.8, wallAtten: 12 },
  // Library beacons
  { id: 'BC-LIB-A', roomId: 'LIB-A', name: 'Library Reading', x: 5,  z: 20, color: 0xa78bfa, txPower: -62, pathLoss: 2.5, wallAtten: 10 },
  { id: 'BC-LIB-B', roomId: 'LIB-B', name: 'Library Reference', x: 15, z: 20, color: 0x38bdf8, txPower: -62, pathLoss: 2.5, wallAtten: 10 },
  { id: 'BC-LIB-C', roomId: 'LIB-C', name: 'Library Quiet',   x: 25, z: 20, color: 0xfacc15, txPower: -62, pathLoss: 2.5, wallAtten: 10 },
  { id: 'BC-LIB-D', roomId: 'LIB-D', name: 'Library Entrance', x: 35, z: 25, color: 0x86efac, txPower: -65, pathLoss: 2.3, wallAtten: 8  }
];

/* Helper: return beacon object by id */
function findBeaconById(id) {
  return CAMPUS_BEACONS.find(function (b) { return b.id === id; }) || null;
}

/* ---------- Timetable / periods ---------- */
const TIMETABLE = [
  { periodId: 'P1', name: 'Period 1', startHour: 9,  startMin: 0,  endHour: 10, endMin: 0  },
  { periodId: 'P2', name: 'Period 2', startHour: 10, startMin: 0,  endHour: 11, endMin: 0  },
  { periodId: 'P3', name: 'Period 3', startHour: 11, startMin: 15, endHour: 12, endMin: 15 },
  { periodId: 'P4', name: 'Period 4', startHour: 13, startMin: 0,  endHour: 14, endMin: 0  },
  { periodId: 'P5', name: 'Period 5', startHour: 14, startMin: 0,  endHour: 15, endMin: 0  }
];

/* Per-student class schedule: studentId -> [{periodId, roomId}] */
const CLASS_SCHEDULE = {
  // Demo students (S001-S010) are all in A101 for Period 1
  // and spread across rooms for other periods
  'P1': { roomId: 'A101', subject: 'Mathematics', faculty: 'Dr. Sharma' },
  'P2': { roomId: 'A102', subject: 'Physics',     faculty: 'Prof. Verma' },
  'P3': { roomId: 'A103', subject: 'Chemistry',   faculty: 'Dr. Patel'  },
  'P4': { roomId: 'LIB-A', subject: 'Self Study', faculty: '(Library)'  },
  'P5': { roomId: 'A104', subject: 'Biology',     faculty: 'Dr. Nair'   }
};

/* ---------- Demo Students (10 students) ---------- */
const DEMO_STUDENTS = [
  { id: 'S001', name: 'Arjun Mehta',     roll: '21CS001', dept: 'CSE', photo: null, seatX: 2.5,  seatZ: 3.5 },
  { id: 'S002', name: 'Priya Sharma',    roll: '21CS002', dept: 'CSE', photo: null, seatX: 2.5,  seatZ: 5.5 },
  { id: 'S003', name: 'Rahul Kumar',     roll: '21CS003', dept: 'CSE', photo: null, seatX: 2.5,  seatZ: 7.5 },
  { id: 'S004', name: 'Ananya Singh',    roll: '21CS004', dept: 'CSE', photo: null, seatX: 4.5,  seatZ: 3.5 },
  { id: 'S005', name: 'Vivek Nair',      roll: '21CS005', dept: 'CSE', photo: null, seatX: 4.5,  seatZ: 5.5 },
  { id: 'S006', name: 'Divya Iyer',      roll: '21CS006', dept: 'CSE', photo: null, seatX: 4.5,  seatZ: 7.5 },
  { id: 'S007', name: 'Karthik Raj',     roll: '21CS007', dept: 'CSE', photo: null, seatX: 6.5,  seatZ: 3.5 },
  { id: 'S008', name: 'Sneha Pillai',    roll: '21CS008', dept: 'CSE', photo: null, seatX: 6.5,  seatZ: 5.5 },
  { id: 'S009', name: 'Aditya Verma',    roll: '21CS009', dept: 'CSE', photo: null, seatX: 6.5,  seatZ: 7.5 },
  { id: 'S010', name: 'Meera Krishnan',  roll: '21CS010', dept: 'CSE', photo: null, seatX: 2.5,  seatZ: 9.0 }
];

/* Additional background students for A101 */
const BG_STUDENTS_A101 = (function () {
  const list = [];
  const cols = [2.5, 4.5, 6.5];
  const rows = [3.5, 5.0, 6.5, 8.0];
  let id = 11;
  cols.forEach(function (x) {
    rows.forEach(function (z) {
      // Skip seats occupied by demo students
      const occupied = DEMO_STUDENTS.some(function (s) {
        return Math.abs(s.seatX - x) < 0.5 && Math.abs(s.seatZ - z) < 0.5;
      });
      if (!occupied && id <= 35) {
        list.push({ id: 'S0' + id, name: 'Student ' + id, roll: '21CS0' + id, dept: 'CSE', seatX: x, seatZ: z });
        id++;
      }
    });
  });
  return list;
})();

/* ---------- Simulation parameters ---------- */
const campusParams = {
  txPower: -59,
  pathLossExp: 2.8,
  noiseStd: 2.5,
  smoothing: 0.3,
  speed: 1.4,
  algorithm: 'gauss-newton',
  wallAttenuation: 12.0,   // dB lost per wall crossed
  detectionThreshold: -85, // dBm: minimum RSSI to count a detection
  hysteresisDwell: 3,      // number of consistent scans before room assignment changes
  gracePeriodSec: 8,       // seconds before "temporarily lost" becomes "outside room"
  punchInWindow: 300,      // seconds after period start within which punch-in is accepted
  scanInterval: 0.2        // seconds between simulated scans (5 Hz)
};

/* ---------- Simulation constants ---------- */
const CAMPUS_SIM = {
  sampleRateHz: 5,
  receiverHeight: 1.2,
  beaconHeight: 2.5,
  sensitivity: -100,
  maxRssi: -30,
  minDistance: 0.1,
  maxTrailPoints: 800,
  personRadius: 0.3
};

/* ---------- Helpers ---------- */
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function findCampusRoom(x, z) {
  for (let i = 0; i < CAMPUS_ROOMS.length; i++) {
    const r = CAMPUS_ROOMS[i];
    if (x >= r.x1 && x < r.x2 && z >= r.z1 && z < r.z2) return r;
  }
  return { id: 'outside', name: 'Outside', color: 0x000000, type: 'outside' };
}

/* Returns true if the straight line (ax,az)→(bx,bz) crosses at least one wall piece */
function linesCrossWall(ax, az, bx, bz) {
  const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.3));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const mx = ax + (bx - ax) * t;
    const mz = az + (bz - az) * t;
    for (let j = 0; j < CAMPUS_WALL_PIECES.length; j++) {
      const w = CAMPUS_WALL_PIECES[j];
      if (mx >= w.x1 && mx <= w.x2 && mz >= w.z1 && mz <= w.z2) return true;
    }
  }
  return false;
}

/* Count walls between receiver and beacon (used for attenuation) */
function wallsBetween(ax, az, bx, bz) {
  let count = 0;
  const steps = Math.max(4, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2));
  let prevIn = false;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mx = ax + (bx - ax) * t;
    const mz = az + (bz - az) * t;
    let inWall = false;
    for (let j = 0; j < CAMPUS_WALL_PIECES.length; j++) {
      const w = CAMPUS_WALL_PIECES[j];
      if (mx >= w.x1 && mx <= w.x2 && mz >= w.z1 && mz <= w.z2) { inWall = true; break; }
    }
    if (inWall && !prevIn) count++;
    prevIn = inWall;
  }
  return count;
}

/* Beacons array (legacy name kept for ble-model.js compatibility) */
const BEACONS = CAMPUS_BEACONS;
const BUILDING = CAMPUS;
const SIM = CAMPUS_SIM;
const params = campusParams;

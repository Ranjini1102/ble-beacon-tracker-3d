/* =============================================================================
 * config.js
 * -----------------------------------------------------------------------------
 * All static data and tunable parameters of the simulation live here:
 *   - the building layout (rooms, walls, doors)
 *   - the three BLE beacons and their fixed positions
 *   - the patrol route used by the automatic walker
 *   - the adjustable simulation parameters (bound to the dashboard sliders)
 *
 * Coordinate system (metres):
 *   X  -> to the right (east)       0 .. 24
 *   Z  -> towards the viewer (south) 0 .. 16
 *   Y  -> up (height)
 * The origin (0, 0) is the top-left corner of the floor plan as seen from above.
 * ========================================================================== */

/* ---------- Building dimensions ---------- */
const BUILDING = {
  width: 24,          // size along X in metres
  depth: 16,          // size along Z in metres
  wallHeight: 2.5,    // height of the walls
  wallThickness: 0.2, // thickness of the walls
  doorWidth: 1.6,     // width of every door opening
  doorHeight: 2.0     // height of the door opening (a lintel sits above it)
};

/* ---------- Rooms (axis-aligned rectangles on the floor plan) ---------- */
const ROOMS = [
  { id: 'lab',    name: 'Lab 101',       x1: 0,  z1: 0,   x2: 8,  z2: 6.5, color: 0xbfdbfe, row: 'top' },
  { id: 'class',  name: 'Classroom 102', x1: 8,  z1: 0,   x2: 16, z2: 6.5, color: 0xfde9a9, row: 'top' },
  { id: 'office', name: 'Office 103',    x1: 16, z1: 0,   x2: 24, z2: 6.5, color: 0xbbf7d0, row: 'top' },
  { id: 'corr',   name: 'Main Corridor', x1: 0,  z1: 6.5, x2: 24, z2: 9.5, color: 0xe2e8f0, row: 'mid' },
  { id: 'lib',    name: 'Library',       x1: 0,  z1: 9.5, x2: 10, z2: 16,  color: 0xfbcfe8, row: 'bottom' },
  { id: 'server', name: 'Server Room',   x1: 10, z1: 9.5, x2: 17, z2: 16,  color: 0xddd6fe, row: 'bottom' },
  { id: 'cafe',   name: 'Cafeteria',     x1: 17, z1: 9.5, x2: 24, z2: 16,  color: 0xfed7aa, row: 'bottom' }
];

/* ---------- Wall layout ----------
 * orient 'h' = wall running along X at z = pos;  'v' = wall running along Z at x = pos.
 * from/to  = extent of the wall along its own axis.
 * doors    = centre positions (along the wall axis) of door openings. */
const WALL_SPECS = [
  // Outer walls
  { orient: 'h', pos: 0,   from: 0,   to: 24,  doors: [] },
  { orient: 'h', pos: 16,  from: 0,   to: 24,  doors: [] },
  { orient: 'v', pos: 0,   from: 0,   to: 16,  doors: [] },
  { orient: 'v', pos: 24,  from: 0,   to: 16,  doors: [] },
  // Walls between the corridor and the room rows (with doors)
  { orient: 'h', pos: 6.5, from: 0,   to: 24,  doors: [4, 12, 20] },
  { orient: 'h', pos: 9.5, from: 0,   to: 24,  doors: [5, 13.5, 20.5] },
  // Dividers between rooms in the top row
  { orient: 'v', pos: 8,   from: 0,   to: 6.5, doors: [] },
  { orient: 'v', pos: 16,  from: 0,   to: 6.5, doors: [] },
  // Dividers between rooms in the bottom row
  { orient: 'v', pos: 10,  from: 9.5, to: 16,  doors: [] },
  { orient: 'v', pos: 17,  from: 9.5, to: 16,  doors: [] }
];

/* WALL_PIECES : solid wall boxes {x1,z1,x2,z2} (used for drawing AND collisions)
 * DOORS       : door openings {x1,z1,x2,z2} (used to draw the lintel above a door) */
const WALL_PIECES = [];
const DOORS = [];

/* Splits every wall specification into solid pieces, leaving gaps for doors. */
(function buildWallGeometry() {
  const half = BUILDING.wallThickness / 2;
  const halfDoor = BUILDING.doorWidth / 2;

  WALL_SPECS.forEach(function (spec) {
    const doors = spec.doors.slice().sort(function (a, b) { return a - b; });
    const intervals = [];          // solid parts along the wall axis: [start, end]
    let cursor = spec.from;

    doors.forEach(function (centre) {
      if (centre - halfDoor > cursor) intervals.push([cursor, centre - halfDoor]);
      cursor = centre + halfDoor;
      // Remember the door opening (lintel is drawn above it)
      if (spec.orient === 'h') {
        DOORS.push({ x1: centre - halfDoor, x2: centre + halfDoor, z1: spec.pos - half, z2: spec.pos + half });
      } else {
        DOORS.push({ x1: spec.pos - half, x2: spec.pos + half, z1: centre - halfDoor, z2: centre + halfDoor });
      }
    });
    if (spec.to > cursor) intervals.push([cursor, spec.to]);

    intervals.forEach(function (iv) {
      // Extend the free ends of a wall by half a thickness so that corners close properly.
      const a = (iv[0] === spec.from) ? iv[0] - half : iv[0];
      const b = (iv[1] === spec.to)   ? iv[1] + half : iv[1];
      if (spec.orient === 'h') {
        WALL_PIECES.push({ x1: a, x2: b, z1: spec.pos - half, z2: spec.pos + half });
      } else {
        WALL_PIECES.push({ x1: spec.pos - half, x2: spec.pos + half, z1: a, z2: b });
      }
    });
  });
})();

/* ---------- BLE beacons (fixed, ceiling mounted) ----------
 * The three beacons are NOT on one straight line, which is required for
 * trilateration to give a unique 2-D position. */
const BEACONS = [
  { id: 'B1', name: 'Beacon 1', x: 4,  z: 3,  color: 0xff6b4a },  // inside Lab 101
  { id: 'B2', name: 'Beacon 2', x: 20, z: 3,  color: 0x34d399 },  // inside Office 103
  { id: 'B3', name: 'Beacon 3', x: 12, z: 13, color: 0x60a5fa }   // inside Server Room
];

/* ---------- Patrol route of the automatic walker ----------
 * Each entry is [x, z] or [x, z, dwellSeconds]. The walker pauses for
 * `dwellSeconds` at a point, which makes the RSSI curves easier to read.
 * All legs pass through door openings, so the walker never crosses a wall. */
const WAYPOINTS = [
  [1.5, 8],
  [4, 8], [4, 5], [6, 2.5, 2], [4, 5], [4, 8],             // visit Lab 101
  [12, 8], [12, 5], [13.5, 2, 2], [12, 5], [12, 8],        // visit Classroom 102
  [20, 8], [20, 5], [21.5, 2.5, 2], [20, 5], [20, 8],      // visit Office 103
  [20.5, 8], [20.5, 12], [21, 14, 2], [20.5, 12], [20.5, 8], // visit Cafeteria
  [13.5, 8], [13.5, 12], [13, 14.5, 2], [13.5, 12], [13.5, 8], // visit Server Room
  [5, 8], [5, 12], [4, 14, 2], [5, 12], [5, 8]             // visit Library, then loop
];

/* ---------- Test paths (selectable in the dashboard) ----------
 * Every path is a list of [x, z] or [x, z, dwellSeconds] points. The walker loops
 * the list: after the last point it walks straight back to the first one, so the
 * first and last point of each path must be joined by a wall-free line.
 * All legs pass through door openings (checked by the verification script). */
const PATHS = {
  patrol:   { name: 'Full patrol (all rooms)',        points: WAYPOINTS },
  corridor: { name: 'Corridor sweep',                 points: [[1.5, 8], [22.5, 8, 1.5]] },
  north:    { name: 'North wing (Lab, Class, Office)', points: [
    [1.5, 8], [4, 8], [4, 5], [6, 2.5, 2], [4, 5], [4, 8],
    [12, 8], [12, 5], [13.5, 2, 2], [12, 5], [12, 8],
    [20, 8], [20, 5], [21.5, 2.5, 2], [20, 5], [20, 8]
  ] },
  south:    { name: 'South wing (Library, Server, Cafe)', points: [
    [1.5, 8], [5, 8], [5, 12], [4, 14, 2], [5, 12], [5, 8],
    [13.5, 8], [13.5, 12], [13, 14.5, 2], [13.5, 12], [13.5, 8],
    [20.5, 8], [20.5, 12], [21, 14, 2], [20.5, 12], [20.5, 8]
  ] },
  handoff:  { name: 'Beacon handoff test (under B1, B3, B2)', points: [
    [1.5, 8], [4, 8], [4, 3.6, 2.5], [4, 8],
    [13.5, 8], [13.5, 12.5, 2.5], [13.5, 8],
    [20, 8], [20, 4.2, 2.5], [20, 8]
  ] }
};
const DEFAULT_PATH = 'patrol';

/* ---------- Furniture (visual only, except `solid` items which also block manual movement) ----------
 * t     : type drawn by scene.js  (bench, desk, sdesk, shelf, rack, rtable, counter, vending, seat, cooler, board, plant)
 * x, z  : centre on the floor plan (m)       w, d : size along local X / Z (m)
 * rot   : yaw in radians. The "front" of the item looks towards (sin rot, cos rot); 0 = towards +Z (south).
 * pc    : number of computer monitors on top    chairs : local X offsets of chairs placed on the front side */
const FURNITURE = [];
(function buildFurniture() {
  const PI = Math.PI;
  const add = function (o) { FURNITURE.push(o); };

  // Lab 101
  add({ t: 'bench', x: 4,   z: 0.8, w: 7.2, d: 0.8, rot: 0, pc: 5, chairs: [-2.6, -1.3, 0, 1.3, 2.6] });
  add({ t: 'bench', x: 1.7, z: 3.0, w: 2.6, d: 0.9, rot: 0, pc: 2, chairs: [-0.6, 0.6] });
  add({ t: 'bench', x: 1.7, z: 5.0, w: 2.6, d: 0.9, rot: 0, pc: 2, chairs: [-0.6, 0.6] });
  add({ t: 'bench', x: 7.5, z: 3.6, w: 3.6, d: 0.8, rot: -PI / 2, pc: 3, chairs: [-1, 1] });
  add({ t: 'plant', x: 7.4, z: 6.0 });

  // Classroom 102
  add({ t: 'board', x: 12, z: 0.12, w: 5, rot: 0 });
  add({ t: 'desk', x: 9.4, z: 0.95, w: 1.8, d: 0.7, rot: 0, pc: 1, chairs: [0] });
  [2.4, 3.6, 4.8].forEach(function (z) {
    [9.1, 10.6].forEach(function (x) { add({ t: 'sdesk', x: x, z: z, w: 1.1, d: 0.55, rot: 0, chairs: [0] }); });
  });
  [1.8, 3.0, 4.2, 5.4].forEach(function (z) { add({ t: 'sdesk', x: 15.0, z: z, w: 1.1, d: 0.55, rot: 0, chairs: [0] }); });
  add({ t: 'plant', x: 15.5, z: 6.0 });

  // Office 103
  add({ t: 'desk', x: 17.4, z: 0.95, w: 2.0, d: 0.8, rot: 0, pc: 1, chairs: [0] });
  add({ t: 'desk', x: 17.4, z: 3.9,  w: 2.0, d: 0.8, rot: 0, pc: 1, chairs: [0] });
  add({ t: 'desk', x: 22.9, z: 0.95, w: 1.8, d: 0.8, rot: 0, pc: 1, chairs: [0] });
  add({ t: 'desk', x: 22.9, z: 5.4,  w: 1.8, d: 0.8, rot: PI, pc: 1, chairs: [0] });
  add({ t: 'shelf', x: 23.75, z: 3.4, w: 2.2, d: 0.35, rot: -PI / 2 });
  add({ t: 'plant', x: 16.7, z: 6.0 });

  // Library
  add({ t: 'shelf', x: 1.85, z: 10.75, w: 2.7, d: 0.45, rot: 0 });
  add({ t: 'shelf', x: 8.15, z: 10.75, w: 2.7, d: 0.45, rot: 0 });
  add({ t: 'shelf', x: 1.85, z: 12.75, w: 2.7, d: 0.45, rot: 0 });
  add({ t: 'shelf', x: 8.15, z: 12.75, w: 2.7, d: 0.45, rot: 0 });
  add({ t: 'shelf', x: 5,    z: 15.7,  w: 8.6, d: 0.45, rot: PI });
  add({ t: 'desk',  x: 8.2,  z: 14.3,  w: 2.0, d: 1.0,  rot: 0, pc: 0, chairs: [-0.5, 0.5] });
  add({ t: 'plant', x: 9.4,  z: 10.0 });

  // Server Room
  [10.6, 11.7, 12.8, 13.9, 15.0].forEach(function (z) {
    add({ t: 'rack', x: 10.6, z: z, w: 1.0, d: 0.7, rot: PI / 2 });
    add({ t: 'rack', x: 16.4, z: z, w: 1.0, d: 0.7, rot: -PI / 2 });
  });
  add({ t: 'desk', x: 15.2, z: 10.4, w: 1.4, d: 0.7, rot: 0, pc: 1, chairs: [0] });

  // Cafeteria
  add({ t: 'rtable', x: 18.6, z: 11.6, r: 0.55 });
  add({ t: 'rtable', x: 18.6, z: 14.4, r: 0.55 });
  add({ t: 'rtable', x: 22.6, z: 11.2, r: 0.55 });
  add({ t: 'rtable', x: 22.6, z: 13.4, r: 0.55 });
  add({ t: 'counter', x: 20.9, z: 15.5, w: 3.8, d: 0.8, rot: PI });
  add({ t: 'vending', x: 23.5, z: 15.3, w: 0.8, d: 0.8, rot: -PI / 2 });
  add({ t: 'plant', x: 17.6, z: 9.9 });

  // Main corridor
  add({ t: 'seat', x: 8.5, z: 9.1, w: 2.0, d: 0.5, rot: PI });
  add({ t: 'seat', x: 17,  z: 9.1, w: 2.0, d: 0.5, rot: PI });
  add({ t: 'cooler', x: 23.4, z: 7.0 });
  add({ t: 'plant', x: 0.6, z: 7.0 });
  add({ t: 'plant', x: 0.6, z: 9.0 });
})();

/* Axis-aligned collision rectangles of the solid furniture (used by manual movement). */
const FURNITURE_BLOCKS = [];
FURNITURE.forEach(function (f) {
  if (f.t === 'plant' || f.t === 'board') return;
  let w = f.w, d = f.d;
  if (f.t === 'rtable') { w = d = f.r * 2; }
  if (Math.abs(Math.sin(f.rot || 0)) > 0.5) { const tmp = w; w = d; d = tmp; }
  FURNITURE_BLOCKS.push({ x1: f.x - w / 2, x2: f.x + w / 2, z1: f.z - d / 2, z2: f.z + d / 2 });
});

/* ---------- Adjustable simulation parameters (bound to the sliders) ---------- */
const params = {
  txPower: -59,       // dBm  : calibrated RSSI measured at 1 m from a beacon (P0)
  pathLossExp: 2.2,   //      : path-loss exponent n (2 = free space, 2-4 indoors)
  noiseStd: 2.0,      // dB   : standard deviation of the Gaussian measurement noise
  smoothing: 0.3,     //      : EMA factor alpha (1 = no smoothing, small = heavy smoothing)
  speed: 1.4,         // m/s  : walking speed of the receiver
  algorithm: 'gauss-newton' //  : 'linear' | 'centroid' | 'gauss-newton'
};

/* ---------- Fixed simulation constants ---------- */
const SIM = {
  sampleRateHz: 5,        // BLE advertisement reports processed per second
  receiverHeight: 1.2,    // m : height of the phone in the person's hand
  beaconHeight: 2.3,      // m : mounting height of the beacons
  sensitivity: -100,      // dBm : weakest RSSI a receiver can report
  maxRssi: -30,           // dBm : strongest RSSI a receiver can report
  minDistance: 0.1,       // m : avoids log10(0) when the receiver is right below a beacon
  maxTrailPoints: 1500,   // number of points kept in the history trails
  personRadius: 0.3       // m : collision radius used in manual mode
};

/* ---------- Small shared helpers ---------- */
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* Returns the room that contains the point (x, z), or an 'Outside' entry. */
function findRoom(x, z) {
  for (let i = 0; i < ROOMS.length; i++) {
    const r = ROOMS[i];
    if (x >= r.x1 && x < r.x2 && z >= r.z1 && z < r.z2) return r;
  }
  return { id: 'outside', name: 'Outside', color: 0x000000 };
}

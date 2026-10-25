/* =============================================================================
 * school-config.js  –  All static data for the 3D Smart School Simulation
 * Building: 48 m wide (X) × 30 m deep (Z)  · Y = up
 * North classrooms: z = 0..10   Corridor: z = 10..14   South: z = 14..30
 * ========================================================================== */
'use strict';

const SCHOOL = { width:48, depth:30, wallH:3.0, wallT:0.2 };
const PLAYER_RADIUS = 0.4; // metres
const EYE_HEIGHT    = 1.65;

/* ── Rooms ─────────────────────────────────────────────────────────────── */
const SCHOOL_ROOMS = [
  { id:'10A', name:'Class 10-A', x1: 0, z1: 0, x2: 8, z2:10, type:'classroom', beaconId:'BCN-10A', color:0xbfdbfe },
  { id:'10B', name:'Class 10-B', x1: 8, z1: 0, x2:16, z2:10, type:'classroom', beaconId:'BCN-10B', color:0xfde9a9 },
  { id:'10C', name:'Class 10-C', x1:16, z1: 0, x2:24, z2:10, type:'classroom', beaconId:'BCN-10C', color:0xbbf7d0 },
  { id:'9A',  name:'Class 9-A',  x1:24, z1: 0, x2:32, z2:10, type:'classroom', beaconId:'BCN-9A',  color:0xfbcfe8 },
  { id:'9B',  name:'Class 9-B',  x1:32, z1: 0, x2:40, z2:10, type:'classroom', beaconId:'BCN-9B',  color:0xddd6fe },
  { id:'9C',  name:'Class 9-C',  x1:40, z1: 0, x2:48, z2:10, type:'classroom', beaconId:'BCN-9C',  color:0xfed7aa },
  { id:'CORR',name:'Corridor',   x1: 0, z1:10, x2:48, z2:14, type:'corridor',  beaconId:null,       color:0xe2e8f0 },
  { id:'LIB', name:'Library',    x1: 0, z1:14, x2:22, z2:30, type:'library',   beaconId:'BCN-LIB',  color:0xe0f2fe },
  { id:'REC', name:'Reception',  x1:22, z1:14, x2:30, z2:24, type:'office',    beaconId:'BCN-REC',  color:0xfef9c3 },
  { id:'STAF',name:'Staffroom',  x1:30, z1:14, x2:40, z2:30, type:'office',    beaconId:null,       color:0xfed7aa },
  { id:'LAB', name:'Computer Lab',x1:40,z1:14, x2:48, z2:30, type:'classroom', beaconId:'BCN-LAB',  color:0xd1fae5 }
];

/* ── Beacons ────────────────────────────────────────────────────────────── */
const SCHOOL_BEACONS = [
  { id:'BCN-10A', roomId:'10A', name:'Beacon 10-A',  x: 4,  z: 5,  color:0xff6b4a, txPower:-59, pathLoss:2.8, uuid:'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major:1, minor:1 },
  { id:'BCN-10B', roomId:'10B', name:'Beacon 10-B',  x:12,  z: 5,  color:0x34d399, txPower:-59, pathLoss:2.8, uuid:'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major:1, minor:2 },
  { id:'BCN-10C', roomId:'10C', name:'Beacon 10-C',  x:20,  z: 5,  color:0x60a5fa, txPower:-59, pathLoss:2.8, uuid:'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major:1, minor:3 },
  { id:'BCN-9A',  roomId:'9A',  name:'Beacon 9-A',   x:28,  z: 5,  color:0xfbbf24, txPower:-59, pathLoss:2.8, uuid:'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major:2, minor:1 },
  { id:'BCN-9B',  roomId:'9B',  name:'Beacon 9-B',   x:36,  z: 5,  color:0xa78bfa, txPower:-59, pathLoss:2.8, uuid:'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major:2, minor:2 },
  { id:'BCN-9C',  roomId:'9C',  name:'Beacon 9-C',   x:44,  z: 5,  color:0xf472b6, txPower:-59, pathLoss:2.8, uuid:'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major:2, minor:3 },
  { id:'BCN-LIB', roomId:'LIB', name:'Library Beacon',x:11, z:22,  color:0x38bdf8, txPower:-62, pathLoss:2.5, uuid:'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major:3, minor:1 },
  { id:'BCN-REC', roomId:'REC', name:'Reception',    x:26,  z:19,  color:0x86efac, txPower:-65, pathLoss:2.3, uuid:'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major:3, minor:2 },
  { id:'BCN-LAB', roomId:'LAB', name:'Computer Lab', x:44,  z:22,  color:0xfacc15, txPower:-59, pathLoss:2.8, uuid:'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major:3, minor:3 }
];

/* ── Wall specifications (orient, position, from, to, doors[{c:center, w:width}]) ── */
const SCHOOL_WALL_SPECS = [
  // Outer boundary
  { orient:'h', pos: 0, from: 0, to:48, doors:[] },
  { orient:'h', pos:30, from: 0, to:48, doors:[{c:24,w:3.5}] }, // main entrance
  { orient:'v', pos: 0, from: 0, to:30, doors:[] },
  { orient:'v', pos:48, from: 0, to:30, doors:[] },
  // Corridor north wall (classrooms ↔ corridor)
  { orient:'h', pos:10, from: 0, to:48, doors:[
    {c:4,w:2.6},{c:12,w:2.6},{c:20,w:2.6},{c:28,w:2.6},{c:36,w:2.6},{c:44,w:2.6}
  ]},
  // Corridor south wall (corridor ↔ south spaces)
  { orient:'h', pos:14, from: 0, to:48, doors:[
    {c:8,w:2.6},{c:26,w:2.6},{c:35,w:2.6},{c:44,w:2.6}
  ]},
  // North classroom dividers
  { orient:'v', pos: 8, from: 0, to:10, doors:[] },
  { orient:'v', pos:16, from: 0, to:10, doors:[] },
  { orient:'v', pos:24, from: 0, to:10, doors:[] },
  { orient:'v', pos:32, from: 0, to:10, doors:[] },
  { orient:'v', pos:40, from: 0, to:10, doors:[] },
  // South room dividers
  { orient:'v', pos:22, from:14, to:30, doors:[] },
  { orient:'v', pos:30, from:14, to:30, doors:[] },
  { orient:'v', pos:40, from:14, to:30, doors:[] },
  // Reception back wall
  { orient:'h', pos:24, from:22, to:30, doors:[{c:26,w:2.0}] }
];

/* Build SCHOOL_WALLS and SCHOOL_DOOR_OPENINGS from specs */
const SCHOOL_WALLS = [];
const SCHOOL_DOOR_OPENINGS = [];
(function buildWalls() {
  const half = SCHOOL.wallT / 2;
  SCHOOL_WALL_SPECS.forEach(function(spec) {
    const doors = spec.doors
      .map(function(d){ return { lo: d.c - d.w/2, hi: d.c + d.w/2 }; })
      .sort(function(a,b){ return a.lo - b.lo; });
    let cur = spec.from;
    doors.forEach(function(door) {
      if (door.lo > cur + 0.001) {
        const x1 = spec.orient==='h' ? cur              : spec.pos-half;
        const x2 = spec.orient==='h' ? door.lo          : spec.pos+half;
        const z1 = spec.orient==='h' ? spec.pos-half    : cur;
        const z2 = spec.orient==='h' ? spec.pos+half    : door.lo;
        SCHOOL_WALLS.push({ x1:x1, x2:x2, z1:z1, z2:z2 });
      }
      // record door opening centre for Three.js lintel etc.
      const dc = (door.lo + door.hi) / 2;
      if (spec.orient==='h') {
        SCHOOL_DOOR_OPENINGS.push({ x1:door.lo, x2:door.hi, z1:spec.pos-half, z2:spec.pos+half });
      } else {
        SCHOOL_DOOR_OPENINGS.push({ x1:spec.pos-half, x2:spec.pos+half, z1:door.lo, z2:door.hi });
      }
      cur = door.hi;
    });
    if (cur < spec.to - 0.001) {
      const x1 = spec.orient==='h' ? cur              : spec.pos-half;
      const x2 = spec.orient==='h' ? spec.to          : spec.pos+half;
      const z1 = spec.orient==='h' ? spec.pos-half    : cur;
      const z2 = spec.orient==='h' ? spec.pos+half    : spec.to;
      SCHOOL_WALLS.push({ x1:x1, x2:x2, z1:z1, z2:z2 });
    }
  });
})();

/* ── Students ───────────────────────────────────────────────────────────── */
const _NAMES = {
  '10A':['Aarav Sharma','Priya Patel','Rohan Kumar','Ananya Singh','Vikram Mehta',
         'Diya Iyer','Karthik Raj','Sneha Pillai','Arjun Nair','Meera Krishnan',
         'Aditya Verma','Pooja Reddy','Siddharth Roy','Kavya Menon','Riya Gupta',
         'Nikhil Joshi','Tanvi Desai','Aman Kapoor','Shreya Chatterjee','Rahul Bose'],
  '10B':['Deepak Mishra','Simran Kaur','Abhishek Tiwari','Nisha Yadav','Gaurav Chandra',
         'Pallavi Dubey','Harsh Srivastava','Ritika Shah','Amit Pandey','Divya Agarwal',
         'Shivam Tripathi','Ankita Rao','Yash Jain','Pooja Saxena','Varun Khanna',
         'Swati Bansal','Mohit Garg','Priyanka Malhotra','Rohit Oberoi','Anjali Soni'],
  '10C':['Sameer Qureshi','Tanisha Ahuja','Rajesh Nanda','Sunita Bhatt','Pankaj Arora',
         'Geeta Thakur','Sumit Batra','Rashmi Tyagi','Vivek Ghosh','Manjari Bhat',
         'Suresh Kumar','Neha Jha','Pradeep Narayan','Usha Pillai','Manish Sinha',
         'Sunita Das','Kishore Venkatesh','Lakshmi Iyer','Mahesh Patel','Vasantha Reddy'],
  '9A': ['Aisha Raza','Aryan Malhotra','Divyanka Singh','Harsh Raj','Ishaan Verma',
         'Kajal Yadav','Lakshay Gupta','Nandini Roy','Ojas Mehta','Pranay Sharma',
         'Qasim Ali','Roshni Kapoor','Samarth Joshi','Tanya Dubey','Uday Agarwal',
         'Vaishnavi Nair','Wamiq Rauf','Yuvraj Patel','Zara Khan','Akshay Soni'],
  '9B': ['Aakash Tiwari','Bindu Reddy','Chirag Mishra','Deepika Shah','Ekansh Pandey',
         'Falak Siddiqui','Gaurangi Puri','Harish Nair','Indrani Das','Jai Saxena',
         'Kriti Jain','Lavanya Menon','Mihir Bhatt','Naina Chatterjee','Omkar Kulkarni',
         'Payal Soni','Raghav Arora','Shilpa Gupta','Tejas Rao','Uma Krishnamurthy'],
  '9C': ['Ayesha Fatima','Bhuvan Shukla','Chandan Kumar','Dipali Joshi','Eshaan Mehta',
         'Farida Begum','Girish Nambiar','Hira Malhotra','Ira Singh','Junaid Khan',
         'Kritika Verma','Lokesh Patel','Mohan Yadav','Nimrat Kaur','Onkar Gupta',
         'Padmaja Iyer','Ritesh Pandey','Sunaina Roy','Tarun Bose','Vinita Sharma']
};

const SKIN_TONES = ['#f8d7bc', '#edd1b8', '#e8bc96', '#dfa882', '#c98a63', '#b87850', '#945b36'];
const HAIR_COLORS = [0x191512, 0x2b1e15, 0x3d2b1b, 0x111111, 0x422f22];
const EYE_COLORS = ['#33241b', '#261912', '#1b2631', '#403026'];

// Helper to determine gender from popular names
const _GIRL_NAMES = ['Priya','Ananya','Diya','Sneha','Meera','Pooja','Kavya','Riya','Tanvi','Shreya',
  'Simran','Nisha','Pallavi','Ritika','Divya','Ankita','Swati','Priyanka','Anjali','Tanisha','Sunita',
  'Geeta','Rashmi','Manjari','Neha','Usha','Lakshmi','Vasantha','Aisha','Divyanka','Kajal','Nandini',
  'Roshni','Tanya','Vaishnavi','Zara','Bindu','Deepika','Falak','Gaurangi','Indrani','Kriti','Lavanya',
  'Naina','Payal','Shilpa','Uma','Ayesha','Dipali','Farida','Hira','Ira','Kritika','Nimrat','Padmaja','Sunaina','Vinita'];

function _makeStudents(classId) {
  return (_NAMES[classId] || []).map(function(name, i) {
    const firstName = name.split(' ')[0];
    const isGirl = _GIRL_NAMES.indexOf(firstName) !== -1;
    const gender = isGirl ? 'f' : 'm';
    const skinTone = SKIN_TONES[(i * 3 + classId.charCodeAt(classId.length-1)) % SKIN_TONES.length];
    const hairColor = HAIR_COLORS[(i * 2 + 1) % HAIR_COLORS.length];
    const eyeColor = EYE_COLORS[i % EYE_COLORS.length];
    const hairStyle = isGirl
      ? (i % 3 === 0 ? 'ponytail' : i % 3 === 1 ? 'bob' : 'shoulder_length')
      : (i % 3 === 0 ? 'parted' : i % 3 === 1 ? 'crew' : 'curly');
    const hasGlasses = (i % 5 === 2);

    return {
      id:          classId + '-S' + String(i+1).padStart(3,'0'),
      name:        name,
      roll:        '2024' + classId.replace(/\W/g,'') + String(i+1).padStart(3,'0'),
      classId:     classId,
      gender:      gender,
      skinTone:    skinTone,
      hairStyle:   hairStyle,
      hairColor:   hairColor,
      eyeColor:    eyeColor,
      glasses:     hasGlasses,
      row:         Math.floor(i/4),
      col:         i % 4,
      beaconId:    'BCN-' + classId,
      seatNumber:  'Desk ' + (Math.floor(i/4)+1) + '-' + ((i%4)+1)
    };
  });
}

const SCHOOL_STUDENTS = {};
['10A','10B','10C','9A','9B','9C'].forEach(function(c){ SCHOOL_STUDENTS[c] = _makeStudents(c); });

// Library occupants (subset from each class – retain their permanent IDs)
SCHOOL_STUDENTS['LIB'] = (function() {
  const arr = [];
  ['10A','10B','10C','9A','9B','9C'].forEach(function(cls, ci) {
    for (let k = 0; k < 3; k++) {
      const src = SCHOOL_STUDENTS[cls][k];
      arr.push(Object.assign({}, src, {
        libSessionId: 'LIB-SESSION-' + src.id + '-001',
        libRow: Math.floor((ci*3+k)/4),
        libCol: (ci*3+k) % 4,
        inLibrary: true
      }));
    }
  });
  return arr;
})();

/* ── Timetable ──────────────────────────────────────────────────────────── */
const TIMETABLE = [
  { id:'P1', name:'Period 1', startH: 9, startM: 0, endH:10, endM: 0, subject:'Mathematics' },
  { id:'P2', name:'Period 2', startH:10, startM: 0, endH:11, endM: 0, subject:'Science' },
  { id:'P3', name:'Period 3', startH:11, startM: 0, endH:12, endM: 0, subject:'English' },
  { id:'P4', name:'Period 4', startH:12, startM: 0, endH:13, endM: 0, subject:'History' },
  { id:'P5', name:'Period 5', startH:14, startM: 0, endH:15, endM: 0, subject:'Computer Science' },
  { id:'P6', name:'Period 6', startH:15, startM: 0, endH:16, endM: 0, subject:'Physical Education' }
];

/* ── Room spawn / teleport points ─────────────────────────────────────── */
const ROOM_SPAWN = {
  '10A': { x: 4,  z:11.8, yaw: 0 },
  '10B': { x:12,  z:11.8, yaw: 0 },
  '10C': { x:20,  z:11.8, yaw: 0 },
  '9A':  { x:28,  z:11.8, yaw: 0 },
  '9B':  { x:36,  z:11.8, yaw: 0 },
  '9C':  { x:44,  z:11.8, yaw: 0 },
  'LIB': { x: 8,  z:15.5, yaw: Math.PI },
  'REC': { x:26,  z:15.5, yaw: Math.PI },
  'LAB': { x:44,  z:15.5, yaw: Math.PI },
  'CORR':{ x:24,  z:12,   yaw: 0 }
};

/* ── Simulation parameters ──────────────────────────────────────────────── */
const SIM = {
  txPower:   -59,
  pathLoss:  2.8,
  noiseStd:  2.5,
  smoothing: 0.3,
  wallAtten: 12.0,
  threshold: -85,
  graceSec:  8,
  playerSpeed: 4.0,
  beaconH: 2.8,
  receiverH: 1.2
};

/* ── Helpers ────────────────────────────────────────────────────────────── */
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function findSchoolRoom(x, z) {
  for (var i = 0; i < SCHOOL_ROOMS.length; i++) {
    var r = SCHOOL_ROOMS[i];
    if (x >= r.x1 && x < r.x2 && z >= r.z1 && z < r.z2) return r;
  }
  return { id:'outside', name:'Outside', type:'outside' };
}

// Circle-AABB collision: true if point (px,pz) with radius r overlaps box [x1..x2,z1..z2]
function circleBoxOverlap(px, pz, r, x1, z1, x2, z2) {
  var nearX = Math.max(x1, Math.min(px, x2));
  var nearZ = Math.max(z1, Math.min(pz, z2));
  return (px-nearX)*(px-nearX) + (pz-nearZ)*(pz-nearZ) < r*r;
}

function playerCollides(x, z) {
  var r = PLAYER_RADIUS;
  if (x - r < 0 || x + r > SCHOOL.width || z - r < 0 || z + r > SCHOOL.depth) return true;
  for (var i = 0; i < SCHOOL_WALLS.length; i++) {
    var w = SCHOOL_WALLS[i];
    if (circleBoxOverlap(x, z, r, w.x1, w.z1, w.x2, w.z2)) return true;
  }
  return false;
}

function movePlayer(player, dx, dz) {
  var nx = player.x + dx, nz = player.z + dz;
  if (!playerCollides(nx, nz))       { player.x = nx; player.z = nz; }
  else if (!playerCollides(nx, player.z)) { player.x = nx; }
  else if (!playerCollides(player.x, nz)) { player.z = nz; }
}

function wallsBetween(ax, az, bx, bz) {
  var n = Math.max(6, Math.ceil(Math.hypot(bx-ax, bz-az) / 0.3));
  var count = 0, prevIn = false;
  for (var i = 0; i <= n; i++) {
    var t = i/n, mx = ax+(bx-ax)*t, mz = az+(bz-az)*t;
    var inW = false;
    for (var j = 0; j < SCHOOL_WALLS.length; j++) {
      var w = SCHOOL_WALLS[j];
      if (mx>=w.x1 && mx<=w.x2 && mz>=w.z1 && mz<=w.z2) { inW=true; break; }
    }
    if (inW && !prevIn) count++;
    prevIn = inW;
  }
  return count;
}

function simRSSI(px, pz, beacon) {
  var dh = SIM.beaconH - SIM.receiverH;
  var d2 = Math.hypot(px - beacon.x, pz - beacon.z);
  var d3 = Math.sqrt(d2*d2 + dh*dh);
  var walls = wallsBetween(px, pz, beacon.x, beacon.z);
  var noise = (Math.random()-0.5)*2*SIM.noiseStd;
  var rssi = beacon.txPower - 10*(beacon.pathLoss||SIM.pathLoss)*Math.log10(Math.max(d3,0.1))
           - walls*SIM.wallAtten + noise;
  return Math.round(clamp(rssi, -100, -30));
}

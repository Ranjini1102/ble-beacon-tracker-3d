/* =============================================================================
 * campus-scene.js  -  3D Smart Campus built on Three.js r147
 * All RSSI/position data comes from ble-model.js / campus-config.js.
 * No Bluetooth hardware is read.
 * ========================================================================== */

const CampusViewer = (function () {
  'use strict';

  const V3 = THREE.Vector3;
  const CX = CAMPUS.width / 2, CZ = CAMPUS.depth / 2;
  const WALL_H = CAMPUS.wallHeight;

  /* -------- module state -------- */
  let host, renderer, scene, camera, controls;
  let dirLight, ambLight;
  let maxAniso = 4;
  const beaconViews = [];    // per-beacon animated meshes
  const studentAvatars = {}; // id -> { group, label, signalRing }
  const shockwaves = [];
  let estMarker = null;
  let trueTrailLine = null, estTrailLine = null;
  const trueTrailPts = [], estTrailPts = [];
  const TRAIL_MAX = 600;
  let lastReading = null;
  let clock = 0;
  let fpsFrames = 0, fpsAccum = 0, fpsVal = 30;
  let tourRunning = false;
  let shotName = 'overview';
  let camTarget = new V3(CX, 0, CZ);
  let camPos = new V3(CX, 28, CZ + 30);
  let camTransTime = 0, CAM_TRANS_DUR = 1.8;
  let camFrom = null, camTo = null, camLookFrom = null, camLookTo = null;

  const options = {
    showRings: true, showCircles: true, showTrail: true, showLines: false,
    showLabels: true, showEffects: true, showCoverage: true,
    showStudents: true, lowWalls: false
  };

  const api = { onShot: null, onHandoff: null };

  /* ========================================================================
   * Canvas textures (no image files)
   * ====================================================================== */
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }
  function rng(seed) { let s = seed; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

  function makeTileFloor() {
    return canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = '#f5f7fb'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(180,190,210,0.6)'; g.lineWidth = 2;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        g.strokeRect(i * 64, j * 64, 64, 64);
      }
    });
  }
  function makeWoodFloor() {
    return canvasTex(512, 128, function (g, w, h) {
      const r = rng(7);
      for (let row = 0; row < 4; row++) {
        let x = -r() * 100;
        while (x < w) {
          const len = 90 + r() * 80, v = 210 + Math.floor(r() * 35);
          g.fillStyle = 'rgb(' + v + ',' + (v - 15) + ',' + (v - 30) + ')';
          g.fillRect(x, row * 32, len, 32);
          g.strokeStyle = 'rgba(80,50,20,0.3)'; g.lineWidth = 1;
          g.strokeRect(x, row * 32, len, 32);
          x += len;
        }
      }
    });
  }
  function makeCarpetFloor() {
    return canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = '#b8c4d8'; g.fillRect(0, 0, w, h);
      const r = rng(11);
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = 'rgba(' + (r() < 0.5 ? '255,255,255' : '70,85,110') + ',' + (0.03 + r() * 0.08) + ')';
        g.fillRect(r() * w, r() * h, 2, 2);
      }
    });
  }
  function makeStoneFloor() {
    return canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = '#edf0f6'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(140,150,170,0.5)'; g.lineWidth = 2.5;
      const rows = [0, 128, 256, 384, 512];
      const offsets = [0, 64, 0, 64];
      for (let r = 0; r < 4; r++) {
        let x = offsets[r % 2] - 128;
        while (x < w) { g.strokeRect(x, rows[r], 128, 128); x += 128; }
      }
    });
  }
  function makeWallTex() {
    return canvasTex(16, 256, function (g, w, h) {
      g.fillStyle = '#f3f6fb'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#dde3ef'; g.fillRect(0, 0, w, 8);   // cornice
      g.fillStyle = '#c8d2e3'; g.fillRect(0, h - 10, w, 10); // skirting
      // subtle horizontal lines
      g.strokeStyle = 'rgba(200,210,230,0.25)'; g.lineWidth = 1;
      for (let y = 20; y < h - 10; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    });
  }
  function makeGlowTex() {
    return canvasTex(128, 128, function (g, w, h) {
      const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.4, 'rgba(255,255,255,0.3)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }
  function makeTextTex(text, bw, bh, fpx, color) {
    const t = canvasTex(bw, bh, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.font = '700 ' + fpx + 'px "Segoe UI",system-ui,sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = color; g.fillText(text, w / 2, h / 2);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  /* ========================================================================
   * Materials cache
   * ====================================================================== */
  let matWall, matFloorTile, matFloorWood, matFloorCarpet, matFloorStone;
  let matCeiling, matGlass, matDesk, matChair, matShelf, matBeaconBody;

  function initMaterials() {
    const wallTex = makeWallTex();
    wallTex.repeat.set(1, 1);
    matWall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, metalness: 0.0 });

    const tileTex = makeTileFloor(); tileTex.repeat.set(8, 8);
    matFloorTile = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.3, metalness: 0.05 });

    const woodTex = makeWoodFloor(); woodTex.repeat.set(4, 4);
    matFloorWood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.6 });

    const carpetTex = makeCarpetFloor(); carpetTex.repeat.set(4, 4);
    matFloorCarpet = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.95 });

    const stoneTex = makeStoneFloor(); stoneTex.repeat.set(3, 3);
    matFloorStone = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.4, metalness: 0.02 });

    matCeiling = new THREE.MeshStandardMaterial({ color: 0xf8faff, roughness: 0.9 });
    matGlass = new THREE.MeshStandardMaterial({ color: 0x88bbff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide });
    matDesk = new THREE.MeshStandardMaterial({ color: 0xc9a96e, roughness: 0.7 });
    matChair = new THREE.MeshStandardMaterial({ color: 0x2d4a8a, roughness: 0.8 });
    matShelf = new THREE.MeshStandardMaterial({ color: 0xa07040, roughness: 0.7 });
    matBeaconBody = new THREE.MeshStandardMaterial({ color: 0x1a2b4a, roughness: 0.3, metalness: 0.6 });
  }

  function floorMat(roomType) {
    if (roomType === 'classroom') return matFloorTile;
    if (roomType === 'library')   return matFloorWood;
    if (roomType === 'corridor')  return matFloorStone;
    if (roomType === 'faculty')   return matFloorCarpet;
    return matFloorTile;
  }

  /* ========================================================================
   * Building geometry
   * ====================================================================== */
  function buildCampus() {
    const group = new THREE.Group();

    /* Floor slab */
    const slabGeo = new THREE.BoxGeometry(CAMPUS.width, 0.15, CAMPUS.depth);
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xe0e5f0, roughness: 0.5 });
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(CX, -0.075, CZ);
    slab.receiveShadow = true;
    group.add(slab);

    /* Room floors */
    CAMPUS_ROOMS.forEach(function (room) {
      const rw = room.x2 - room.x1, rd = room.z2 - room.z1;
      const geo = new THREE.BoxGeometry(rw, 0.05, rd);
      const mat = floorMat(room.type).clone();
      // tint by room color
      const r = ((room.color >> 16) & 255) / 255;
      const gv = ((room.color >> 8) & 255) / 255;
      const b = (room.color & 255) / 255;
      mat.color.multiply(new THREE.Color(0.88 + r * 0.12, 0.88 + gv * 0.12, 0.88 + b * 0.12));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(room.x1 + rw / 2, 0.025, room.z1 + rd / 2);
      mesh.receiveShadow = true;
      group.add(mesh);

      /* Room name plate (on ceiling height plane) */
      const nameTex = makeTextTex(room.name, 512, 128, 36, '#1a2b4a');
      const nameMat = new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
      const nameGeo = new THREE.PlaneGeometry(Math.min(rw - 0.4, 4), 0.8);
      const namePlane = new THREE.Mesh(nameGeo, nameMat);
      namePlane.rotation.x = -Math.PI / 2;
      namePlane.position.set(room.x1 + rw / 2, 0.06, room.z1 + rd / 2);
      group.add(namePlane);
    });

    /* Ceiling panels */
    CAMPUS_ROOMS.forEach(function (room) {
      if (room.type === 'corridor') return;
      const rw = room.x2 - room.x1, rd = room.z2 - room.z1;
      const geo = new THREE.BoxGeometry(rw - CAMPUS.wallThickness * 0.5, 0.08, rd - CAMPUS.wallThickness * 0.5);
      const mesh = new THREE.Mesh(geo, matCeiling);
      mesh.position.set(room.x1 + rw / 2, WALL_H - 0.04, room.z1 + rd / 2);
      group.add(mesh);
    });

    /* Walls */
    CAMPUS_WALL_PIECES.forEach(function (wp) {
      const w = wp.x2 - wp.x1, d = wp.z2 - wp.z1;
      const geo = new THREE.BoxGeometry(w, WALL_H, d);
      const mat = matWall.clone();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((wp.x1 + wp.x2) / 2, WALL_H / 2, (wp.z1 + wp.z2) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });

    /* Door lintels */
    CAMPUS_DOORS.forEach(function (d) {
      const w = d.x2 - d.x1, dz = d.z2 - d.z1;
      const lintelH = WALL_H - CAMPUS.doorHeight;
      const geo = new THREE.BoxGeometry(Math.max(w, dz) + 0.01, lintelH, Math.min(w, dz) + CAMPUS.wallThickness);
      const mesh = new THREE.Mesh(geo, matWall.clone());
      mesh.position.set((d.x1 + d.x2) / 2, CAMPUS.doorHeight + lintelH / 2, (d.z1 + d.z2) / 2);
      group.add(mesh);

      /* Glass door pane */
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, dz) - 0.1, CAMPUS.doorHeight - 0.1), matGlass);
      pane.position.set((d.x1 + d.x2) / 2, CAMPUS.doorHeight / 2, (d.z1 + d.z2) / 2);
      if (dz > w) pane.rotation.y = Math.PI / 2;
      group.add(pane);
    });

    /* Exterior windows (north wall for classrooms) */
    CAMPUS_ROOMS.forEach(function (room) {
      if (room.type !== 'classroom') return;
      const rw = room.x2 - room.x1;
      // Window on north wall (z=0)
      const winW = rw - 1.5, winH = 1.2;
      const winGeo = new THREE.PlaneGeometry(winW, winH);
      const winMesh = new THREE.Mesh(winGeo, matGlass);
      winMesh.position.set(room.x1 + rw / 2, 1.6, 0.12);
      group.add(winMesh);
      // Window frame
      const fmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
      [[winW + 0.1, 0.08], [0.08, winH + 0.1]].forEach(function (dim, k) {
        const fg = new THREE.BoxGeometry(dim[0], dim[1], 0.06);
        const fm = new THREE.Mesh(fg, fmat);
        fm.position.set(room.x1 + rw / 2, 1.6, 0.08);
        if (k === 0) fm.position.y = 1.6 + winH / 2;
        group.add(fm);
      });
    });

    /* Diorama base plinth */
    const plinthGeo = new THREE.BoxGeometry(CAMPUS.width + 2, 0.3, CAMPUS.depth + 2);
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x1a2540, roughness: 0.6 });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.set(CX, -0.25, CZ);
    group.add(plinth);

    scene.add(group);
  }

  /* ========================================================================
   * Classroom furniture
   * ====================================================================== */
  function buildFurniture() {
    const grp = new THREE.Group();

    function addBox(x, y, z, w, h, d, mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      grp.add(m);
      return m;
    }

    /* --- Classroom desks & chairs --- */
    ['A101', 'A102', 'A103', 'A104'].forEach(function (rid) {
      const room = CAMPUS_ROOMS.find(function (r) { return r.id === rid; });
      if (!room) return;
      const cx = room.x1;
      // Whiteboard on north wall
      const bw = room.x2 - room.x1 - 1.5;
      const boardGeo = new THREE.BoxGeometry(bw, 1.1, 0.04);
      const boardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.position.set(room.x1 + (room.x2 - room.x1) / 2, 1.8, room.z1 + 0.06);
      grp.add(board);
      // Green board surface
      const greenGeo = new THREE.PlaneGeometry(bw - 0.1, 1.0);
      const greenMat = new THREE.MeshStandardMaterial({ color: 0x1a7c4a, roughness: 0.9 });
      const green = new THREE.Mesh(greenGeo, greenMat);
      green.position.set(room.x1 + (room.x2 - room.x1) / 2, 1.8, room.z1 + 0.09);
      grp.add(green);

      // Teacher desk front
      addBox(room.x1 + (room.x2 - room.x1) / 2, 0.38, room.z1 + 1.2, 2.0, 0.75, 0.6, matDesk);

      // Student desks: 5 columns x 4 rows
      const cols = 4, rows = 4;
      const startX = room.x1 + 1.0;
      const startZ = room.z1 + 2.2;
      const stepX = (room.x2 - room.x1 - 2.0) / (cols - 1);
      const stepZ = (room.z2 - room.z1 - 3.0) / (rows - 1);
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          const dx = startX + col * stepX;
          const dz = startZ + row * stepZ;
          // Desk
          addBox(dx, 0.38, dz, 1.0, 0.05, 0.6, matDesk);
          addBox(dx - 0.4, 0.19, dz, 0.06, 0.38, 0.06, matDesk);
          addBox(dx + 0.4, 0.19, dz, 0.06, 0.38, 0.06, matDesk);
          // Chair behind desk
          const cz = dz + 0.55;
          addBox(dx, 0.22, cz, 0.5, 0.04, 0.5, matChair);  // seat
          addBox(dx, 0.55, cz + 0.2, 0.5, 0.6, 0.04, matChair); // back
          // Chair legs
          [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(function (off) {
            addBox(dx + off[0], 0.11, cz + off[1], 0.04, 0.22, 0.04, matChair);
          });
        }
      }
    });

    /* --- Library furniture --- */
    // Reading tables in LIB-A
    const libA = CAMPUS_ROOMS.find(function (r) { return r.id === 'LIB-A'; });
    if (libA) {
      for (let t = 0; t < 3; t++) {
        const tx = libA.x1 + 3 + t * 2.5;
        const tz = libA.z1 + 5;
        addBox(tx, 0.38, tz, 1.8, 0.05, 1.0, matDesk);
        for (let s = 0; s < 2; s++) {
          addBox(tx - 0.4 + s * 0.8, 0.22, tz + 0.7, 0.5, 0.04, 0.5, matChair);
          addBox(tx - 0.4 + s * 0.8, 0.55, tz + 0.9, 0.5, 0.6, 0.04, matChair);
        }
      }
      // Bookshelves
      for (let sh = 0; sh < 3; sh++) {
        addBox(libA.x1 + 1.5, 0.75, libA.z1 + 9 + sh * 3, 2.2, 1.5, 0.35, matShelf);
        // Shelf boards
        for (let b = 0; b < 4; b++) {
          addBox(libA.x1 + 1.5, 0.15 + b * 0.36, libA.z1 + 9 + sh * 3, 2.2, 0.04, 0.35, matShelf);
        }
      }
    }

    // Tables in LIB-B
    const libB = CAMPUS_ROOMS.find(function (r) { return r.id === 'LIB-B'; });
    if (libB) {
      for (let t = 0; t < 2; t++) {
        const tx = libB.x1 + 3 + t * 4;
        addBox(tx, 0.38, libB.z1 + 4, 3.0, 0.05, 1.0, matDesk);
        for (let s = 0; s < 3; s++) {
          addBox(tx - 0.8 + s * 0.8, 0.22, libB.z1 + 4.8, 0.5, 0.04, 0.5, matChair);
        }
      }
      // Reference shelves
      for (let sh = 0; sh < 4; sh++) {
        addBox(libB.x1 + 5, 0.75, libB.z1 + 8 + sh * 4, 8, 1.5, 0.4, matShelf);
        for (let b = 0; b < 4; b++) {
          addBox(libB.x1 + 5, 0.15 + b * 0.36, libB.z1 + 8 + sh * 4, 8, 0.04, 0.4, matShelf);
        }
      }
    }

    // Quiet study pods in LIB-C
    const libC = CAMPUS_ROOMS.find(function (r) { return r.id === 'LIB-C'; });
    if (libC) {
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          const tx = libC.x1 + 2 + col * 4;
          const tz = libC.z1 + 3 + row * 4;
          addBox(tx, 0.38, tz, 1.5, 0.05, 0.8, matDesk);
          addBox(tx, 0.22, tz + 0.6, 0.5, 0.04, 0.5, matChair);
          addBox(tx, 0.55, tz + 0.8, 0.5, 0.6, 0.04, matChair);
        }
      }
    }

    /* Faculty room */
    const fac = CAMPUS_ROOMS.find(function (r) { return r.id === 'FACULTY'; });
    if (fac) {
      addBox(fac.x1 + 3, 0.38, fac.z1 + 3, 2.5, 0.05, 1.2, matDesk);
      addBox(fac.x1 + 3, 0.22, fac.z1 + 4.5, 0.5, 0.04, 0.5, matChair);
      addBox(fac.x1 + 7, 0.38, fac.z1 + 3, 2.0, 0.05, 1.0, matDesk);
    }

    scene.add(grp);
  }

  /* ========================================================================
   * Beacon 3D models
   * ====================================================================== */
  function buildBeacons() {
    CAMPUS_BEACONS.forEach(function (b, i) {
      const grp = new THREE.Group();
      grp.position.set(b.x, WALL_H - 0.15, b.z);

      // Body – small disc
      const bodyGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.06, 16);
      const bodyMesh = new THREE.Mesh(bodyGeo, matBeaconBody.clone());
      bodyMesh.castShadow = true;
      grp.add(bodyMesh);

      // LED dot
      const ledMat = new THREE.MeshStandardMaterial({ color: b.color, emissive: b.color, emissiveIntensity: 2 });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), ledMat);
      led.position.y = -0.04;
      grp.add(led);

      // Mounting stud
      const studMat = new THREE.MeshStandardMaterial({ color: 0x8899bb, roughness: 0.4, metalness: 0.8 });
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8), studMat);
      stud.position.y = 0.1;
      grp.add(stud);

      // Animated signal rings (3D, flat cylinders)
      const rings = [];
      for (let r = 0; r < 4; r++) {
        const ringGeo = new THREE.RingGeometry(0.2, 0.28, 32);
        const col = new THREE.Color(b.color);
        const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.08;
        ring._phase = r / 4;
        grp.add(ring);
        rings.push(ring);
      }

      // Floor coverage glow
      const glowGeo = new THREE.CircleGeometry(3.5, 32);
      const col2 = new THREE.Color(b.color);
      const glowMat = new THREE.MeshBasicMaterial({ color: col2, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(b.x, 0.02, b.z);
      scene.add(glow);

      // RSSI label
      const labelTex = makeTextTex(b.id, 256, 64, 20, '#' + b.color.toString(16).padStart(6, '0'));
      const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), labelMat);
      label.position.set(b.x, WALL_H - 0.5, b.z);
      scene.add(label);

      // Point light
      const ptLight = new THREE.PointLight(b.color, 0.6, 5);
      ptLight.position.y = -0.12;
      grp.add(ptLight);

      scene.add(grp);
      beaconViews.push({ grp, rings, led, ledMat, ptLight, glow, glowMat, label, beacon: b, rssi: -100, active: true });
    });
  }

  /* ========================================================================
   * Student avatars
   * ====================================================================== */
  function buildStudentAvatars() {
    function makeAvatar(student, isDemo) {
      const grp = new THREE.Group();
      grp.position.set(student.seatX, 0, student.seatZ);

      // Body
      const bodyCol = isDemo ? 0x2563eb : 0x4b5563;
      const bodyMat = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 0.8 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.55, 8), bodyMat);
      body.position.y = 0.55;
      grp.add(body);

      // Head
      const headMat = new THREE.MeshStandardMaterial({ color: 0xfdbcb4, roughness: 0.9 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), headMat);
      head.position.y = 0.95;
      grp.add(head);

      // Smartphone (demo students only)
      if (isDemo) {
        const phoneMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.3, metalness: 0.7 });
        const phone = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.01), phoneMat);
        phone.position.set(0.18, 0.6, 0.1);
        phone.rotation.z = -0.3;
        grp.add(phone);
        // Phone screen
        const screenMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1d4ed8, emissiveIntensity: 0.5 });
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.1), screenMat);
        screen.position.set(0.18, 0.6, 0.115);
        screen.rotation.z = -0.3;
        grp.add(screen);
      }

      // Signal ring around head (demo students)
      let signalRing = null;
      if (isDemo) {
        const sringGeo = new THREE.RingGeometry(0.18, 0.24, 24);
        const sringMat = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
        signalRing = new THREE.Mesh(sringGeo, sringMat);
        signalRing.rotation.x = -Math.PI / 2;
        signalRing.position.y = 1.05;
        grp.add(signalRing);
      }

      // Name label
      let label = null;
      if (isDemo) {
        const nameTex = makeTextTex(student.name.split(' ')[0], 256, 64, 22, '#ffffff');
        const nameMat2 = new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
        label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), nameMat2);
        label.position.y = 1.25;
        grp.add(label);
      }

      scene.add(grp);
      return { grp, signalRing, label, student };
    }

    DEMO_STUDENTS.forEach(function (s) {
      studentAvatars[s.id] = makeAvatar(s, true);
    });
    BG_STUDENTS_A101.forEach(function (s) {
      makeAvatar(s, false);
    });
  }

  /* ========================================================================
   * Lights
   * ====================================================================== */
  function buildLights() {
    ambLight = new THREE.AmbientLight(0xd0daf0, 0.65);
    scene.add(ambLight);

    dirLight = new THREE.DirectionalLight(0xfff5e0, 1.1);
    dirLight.position.set(CX + 10, 25, CZ - 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 80;
    dirLight.shadow.camera.left = -CX - 5;
    dirLight.shadow.camera.right = CX + 5;
    dirLight.shadow.camera.top = CZ + 5;
    dirLight.shadow.camera.bottom = -CZ - 5;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    // Room-fill lights
    CAMPUS_ROOMS.forEach(function (room) {
      if (room.type === 'corridor') return;
      const pl = new THREE.PointLight(0xfff8ee, 0.4, 15);
      pl.position.set(room.x1 + (room.x2 - room.x1) / 2, WALL_H - 0.3, room.z1 + (room.z2 - room.z1) / 2);
      scene.add(pl);
    });
  }

  /* ========================================================================
   * Trails
   * ====================================================================== */
  function makeTrailLine(color) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    const mat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.7, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    return line;
  }

  function initTrails() {
    trueTrailLine = makeTrailLine(0xfacc15);
    estTrailLine  = makeTrailLine(0xe879f9);
  }

  function updateTrailLine(line, pts) {
    const pos = line.geometry.attributes.position;
    const count = Math.min(pts.length, TRAIL_MAX);
    for (let i = 0; i < count; i++) {
      pos.setXYZ(i, pts[i].x, 0.08, pts[i].z);
    }
    for (let i = count; i < TRAIL_MAX; i++) pos.setXYZ(i, pts[count > 0 ? count - 1 : 0].x || 0, 0.08, pts[count > 0 ? count - 1 : 0].z || 0);
    pos.needsUpdate = true;
    line.geometry.setDrawRange(0, count);
  }

  /* ========================================================================
   * Camera system
   * ====================================================================== */
  const SHOTS = {
    overview: function () {
      return { pos: new V3(CX, 28, CZ + 24), look: new V3(CX, 0, CZ), label: 'Campus Overview', sub: 'Smart Campus – BLE Beacon Attendance System' };
    },
    top: function () {
      return { pos: new V3(CX, 38, CZ + 0.01), look: new V3(CX, 0, CZ), label: 'Floor Plan', sub: 'Bird\'s-eye view' };
    },
    classA101: function () {
      const r = CAMPUS_ROOMS[0];
      return { pos: new V3(r.x1 + 4, 6, r.z2 + 5), look: new V3(r.x1 + 4, 1, r.z1 + 5), label: 'Classroom A101', sub: 'Demo group – 10 students' };
    },
    library: function () {
      return { pos: new V3(15, 9, 28 + 10), look: new V3(15, 1, 20), label: 'Library', sub: 'Reading & reference zones' };
    },
    beacons: function () {
      return { pos: new V3(CX, 4, CZ - 2), look: new V3(CX, WALL_H - 0.2, CZ), label: 'Beacon Array', sub: 'Per-room BLE beacons' };
    },
    corridor: function () {
      return { pos: new V3(2, 2.8, 11.5), look: new V3(40, 2.8, 11.5), label: 'Main Corridor', sub: 'Eye-level corridor view' };
    },
    orbit: function () { return null; }
  };

  let orbitAngle = 0;

  function applyShot(name) {
    shotName = name;
    const s = SHOTS[name] ? SHOTS[name]() : null;
    if (!s) return;
    camFrom = camera.position.clone();
    camLookFrom = controls.target.clone();
    camTo = s.pos;
    camLookTo = s.look;
    camTransTime = 0;
    if (api.onShot) api.onShot(name, { label: s.label, sub: s.sub }, false);
  }

  function lerp3(a, b, t) {
    return new V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

  function updateCamera(dt) {
    if (shotName === 'orbit') {
      orbitAngle += dt * 0.18;
      camera.position.set(CX + Math.cos(orbitAngle) * 32, 18, CZ + Math.sin(orbitAngle) * 32);
      controls.target.set(CX, 2, CZ);
      controls.update();
      return;
    }
    if (camTo && camTransTime < CAM_TRANS_DUR) {
      camTransTime += dt;
      const t = easeInOut(Math.min(camTransTime / CAM_TRANS_DUR, 1));
      camera.position.copy(lerp3(camFrom, camTo, t));
      controls.target.copy(lerp3(camLookFrom, camLookTo, t));
      controls.update();
    }
  }

  /* ========================================================================
   * Public reading update
   * ====================================================================== */
  function setReading(reading) {
    lastReading = reading;
    // Update beacon ring intensities based on RSSI
    if (reading.beacons) {
      reading.beacons.forEach(function (b, i) {
        if (beaconViews[i]) {
          beaconViews[i].rssi = b.filtered;
        }
      });
    }
    // Update trail arrays
    if (reading.committed) {
      trueTrailPts.push({ x: reading.truth.x, z: reading.truth.z });
      estTrailPts.push({ x: reading.est.x, z: reading.est.z });
      if (trueTrailPts.length > TRAIL_MAX) trueTrailPts.shift();
      if (estTrailPts.length > TRAIL_MAX) estTrailPts.shift();
    }
  }

  function setPerson(x, z, heading, moving) {
    // (person avatar optional for campus mode – handled via student avatars)
  }

  function pushTrail(kind, x, z) { /* handled in setReading */ }
  function clearTrails() { trueTrailPts.length = 0; estTrailPts.length = 0; }
  function resetFx() { }
  function isTouring() { return tourRunning; }
  function startTour() { tourRunning = true; applyShot('overview'); }
  function stopTour() { tourRunning = false; }

  /* ========================================================================
   * Animate student signal rings
   * ====================================================================== */
  function updateStudentSignals(t) {
    const presence = AttendanceEngine.getAllPresence();
    Object.keys(studentAvatars).forEach(function (id) {
      const av = studentAvatars[id];
      const ps = presence[id];
      if (!av.signalRing) return;
      let col = 0x6b7280; // grey = unknown
      let opacity = 0.4;
      if (ps) {
        if (ps.status === 'Present')               { col = 0x22c55e; opacity = 0.85; }
        else if (ps.status === 'Signal Weak')       { col = 0xf59e0b; opacity = 0.6; }
        else if (ps.status === 'Temporarily Lost')  { col = 0xef4444; opacity = 0.5; }
        else if (ps.status === 'Outside Assigned Room') { col = 0xff6b4a; opacity = 0.5; }
      }
      av.signalRing.material.color.setHex(col);
      av.signalRing.material.opacity = opacity;
      // Pulse
      const scale = 1 + 0.15 * Math.sin(t * 3 + DEMO_STUDENTS.findIndex(function (s) { return s.id === id; }));
      av.signalRing.scale.set(scale, scale, scale);
      // Billboard label
      if (av.label) { av.label.lookAt(camera.position); }
    });
  }

  /* ========================================================================
   * Animate beacons
   * ====================================================================== */
  function updateBeacons(t) {
    beaconViews.forEach(function (bv) {
      bv.rings.forEach(function (ring) {
        const phase = ((t / 3.0) + ring._phase) % 1;
        const scale = 0.3 + phase * 6;
        ring.scale.set(scale, scale, scale);
        ring.material.opacity = options.showRings ? (1 - phase) * 0.55 : 0;
      });
      // Coverage glow pulse
      if (bv.glow) {
        bv.glow.material.opacity = options.showCoverage ? 0.04 + 0.03 * Math.sin(t * 1.5) : 0;
        bv.glow.visible = options.showCoverage;
      }
      // LED pulse
      bv.ledMat.emissiveIntensity = 1.5 + 0.8 * Math.sin(t * 4);
      // Point light intensity
      bv.ptLight.intensity = 0.5 + 0.3 * Math.sin(t * 2.5);
    });
  }

  /* ========================================================================
   * Render loop
   * ====================================================================== */
  function render(dt, t) {
    clock = t;
    fpsFrames++;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) { fpsVal = fpsFrames / fpsAccum; fpsFrames = 0; fpsAccum = 0; }

    updateCamera(dt);
    updateBeacons(t);
    updateStudentSignals(t);

    if (options.showTrail && trueTrailPts.length > 1) updateTrailLine(trueTrailLine, trueTrailPts);
    if (options.showTrail && estTrailPts.length > 1)  updateTrailLine(estTrailLine, estTrailPts);

    renderer.render(scene, camera);
  }

  /* ========================================================================
   * Init
   * ====================================================================== */
  function init(h) {
    host = h;
    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(h.clientWidth, h.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace || THREE.LinearEncoding;
    h.appendChild(renderer.domElement);
    maxAniso = renderer.capabilities.getMaxAnisotropy();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1422);
    scene.fog = new THREE.Fog(0x0a1422, 60, 120);

    camera = new THREE.PerspectiveCamera(45, h.clientWidth / h.clientHeight, 0.1, 200);
    camera.position.set(CX, 28, CZ + 24);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(CX, 0, CZ);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 80;
    controls.minDistance = 1;
    controls.update();

    initMaterials();
    buildCampus();
    buildFurniture();
    buildBeacons();
    buildStudentAvatars();
    buildLights();
    initTrails();

    window.addEventListener('resize', function () {
      camera.aspect = h.clientWidth / h.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(h.clientWidth, h.clientHeight);
    });
  }

  function setShot(name) { applyShot(name); }
  function resetView() { applyShot(shotName); }
  function setQuality(q) {
    if (q === 'low') { renderer.shadowMap.enabled = false; dirLight.castShadow = false; }
    else { renderer.shadowMap.enabled = true; dirLight.castShadow = true; }
  }
  function setOption(name, val) { options[name] = val; }
  function getFps() { return fpsVal; }

  return {
    init, render, setShot, resetView, startTour, stopTour, isTouring,
    setPerson, setReading, pushTrail, clearTrails, resetFx,
    setOption, setQuality, getFps,
    onShot: null, onHandoff: null
  };
})();

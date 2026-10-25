/* =============================================================================
 * scene.js  -  cinematic 3D digital twin (Three.js r147, classic build)
 * -----------------------------------------------------------------------------
 * Everything that is drawn:
 *   - building shell: textured floors, walls with skirting, door frames and leaves,
 *     exterior windows, room name plates, a plinth ("diorama base") and soft lighting
 *   - furniture, merged into two meshes (solid + glowing parts) for speed
 *   - three ceiling-mounted BLE beacons with animated coverage rings, floor glow,
 *     live RSSI labels, estimated-distance circles and link lines
 *   - an articulated walking avatar (true position) and a holographic ghost
 *     (estimated position), ribbon trails, a raw-estimate "noise cloud"
 *   - handoff effects when the strongest beacon changes
 *   - a camera director: overview, plan, orbit, indoor, follow, corridor, beacon
 *     close-ups and an automatic cinematic tour, with eased transitions
 *
 * All RSSI values and positions shown by the scene come from the simulation
 * model (ble-model.js). Nothing here reads Bluetooth hardware.
 *
 * Public API (object `Viewer`):
 *   init(host), render(dt, t), setShot(name), resetView(), startTour(), stopTour(),
 *   setPerson(x, z, heading, moving), setReading(reading, snap), pushTrail(kind, x, z),
 *   clearTrails(), setOption(name, value), setQuality(q), resetFx(),
 *   getFps(), onShot, onHandoff   (callbacks you can assign)
 * ========================================================================== */

const Viewer = (function () {
  'use strict';

  const V3 = THREE.Vector3;
  const CX = BUILDING.width / 2, CZ = BUILDING.depth / 2;
  const WALL_H = BUILDING.wallHeight;

  /* ----- module state ----- */
  let host, renderer, scene, camera, controls, dirLight, maxAniso = 4;
  let person, avatar, estMarker, estPin, estRing, ghost, errLine, trueTag, estTag;
  let trueTrail, estTrail, cloud;
  const wallMeshes = [], lintelMeshes = [];
  const beaconViews = [];
  const shockwaves = [];
  const estTarget = new V3();
  const options = {
    showCircles: true, showTrail: true, showRings: true, showLines: true,
    lowWalls: false, showLabels: true, showEffects: true, showCoverage: true, showScatter: true
  };
  const RING_COUNT = 4, RING_PERIOD = 3.0;
  const api = { onShot: null, onHandoff: null };

  /* ===========================================================================
   * Textures drawn on <canvas> (no image files needed)
   * ========================================================================= */
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }
  function rnd(seed) { let s = seed; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

  /* Floor patterns (grey-scale; the room colour tints them). size = metres covered by one texture. */
  const FLOOR_KINDS = {
    tile: { size: 1, make: function () { return canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = '#f4f6fa'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(90,105,130,0.5)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
    }); } },
    wood: { size: 2, make: function () { return canvasTex(256, 256, function (g, w, h) {
      const r = rnd(7);
      for (let row = 0; row < 8; row++) {
        let x = -r() * 120;
        while (x < w) {
          const len = 110 + r() * 90, v = 205 + Math.floor(r() * 40);
          g.fillStyle = 'rgb(' + v + ',' + v + ',' + (v - 6) + ')';
          g.fillRect(x, row * 32, len, 32);
          g.strokeStyle = 'rgba(60,60,60,0.35)'; g.lineWidth = 1.5; g.strokeRect(x, row * 32, len, 32);
          g.strokeStyle = 'rgba(80,80,80,0.12)';
          for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x, row * 32 + 6 + k * 9); g.lineTo(x + len, row * 32 + 8 + k * 9); g.stroke(); }
          x += len;
        }
      }
    }); } },
    carpet: { size: 2, make: function () { return canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = '#d3d9e3'; g.fillRect(0, 0, w, h);
      const r = rnd(11);
      for (let i = 0; i < 2600; i++) { g.fillStyle = 'rgba(' + (r() < 0.5 ? '255,255,255' : '90,100,120') + ',' + (0.05 + r() * 0.12) + ')'; g.fillRect(r() * w, r() * h, 2, 2); }
    }); } },
    stone: { size: 3, make: function () { return canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = '#eef1f6'; g.fillRect(0, 0, w, h);
      const r = rnd(5);
      g.strokeStyle = 'rgba(120,130,150,0.18)'; g.lineWidth = 1;
      for (let i = 0; i < 26; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.3) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
      g.strokeStyle = 'rgba(90,105,130,0.55)'; g.lineWidth = 3;
      g.strokeRect(0, 0, w, h); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    }); } },
    metal: { size: 0.6, make: function () { return canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = '#aab3c2'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(30,40,60,0.7)'; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
      g.fillStyle = 'rgba(30,40,60,0.45)';
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { g.beginPath(); g.arc(20 + i * 17.5, 20 + j * 17.5, 3, 0, 6.3); g.fill(); }
    }); } },
    checker: { size: 1, make: function () { return canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c9d1de'; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
    }); } }
  };
  const ROOM_FLOOR = { lab: 'tile', class: 'wood', office: 'carpet', corr: 'stone', lib: 'wood', server: 'metal', cafe: 'checker' };

  function makeWallTexture() {
    return canvasTex(8, 128, function (g, w, h) {
      g.fillStyle = '#f3f6fb'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c3ccdb'; g.fillRect(0, h - 7, w, 7);          // skirting board
      g.fillStyle = '#dfe5ee'; g.fillRect(0, 0, w, 6);              // cornice
    });
  }
  function makeGlowTexture() {
    return canvasTex(128, 128, function (g, w, h) {
      const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }
  function makeTextTexture(text, width, height, fontPx, color) {
    const t = canvasTex(width, height, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.font = '600 ' + fontPx + 'px "Segoe UI", system-ui, -apple-system, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
      g.fillText(text, w / 2, h / 2);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }
  function makeRackTexture() {
    return canvasTex(128, 256, function (g, w, h) {
      g.fillStyle = '#10151f'; g.fillRect(0, 0, w, h);
      const r = rnd(23);
      for (let u = 0; u < 14; u++) {
        const y = 8 + u * 17;
        g.fillStyle = '#1f2837'; g.fillRect(8, y, w - 16, 14);
        g.fillStyle = '#0b0f17'; for (let k = 0; k < 6; k++) g.fillRect(14 + k * 8, y + 3, 5, 8);
        for (let k = 0; k < 4; k++) { g.fillStyle = r() < 0.7 ? '#34d399' : (r() < 0.5 ? '#38bdf8' : '#fbbf24'); g.fillRect(w - 46 + k * 9, y + 5, 4, 4); }
      }
    });
  }
  /* Soft environment used for reflections on glossy floors and glass. */
  function makeEnvironment() {
    const tex = canvasTex(512, 256, function (g, w, h) {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#cfe0ff'); gr.addColorStop(0.45, '#f4f8ff'); gr.addColorStop(0.5, '#d6deec');
      gr.addColorStop(0.56, '#46526c'); gr.addColorStop(1, '#10172a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      for (let i = 0; i < 6; i++) g.fillRect(i * 85 + 10, 72, 46, 34);
    });
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromEquirectangular(tex).texture;
    pm.dispose(); tex.dispose();
    return env;
  }

  /* ===========================================================================
   * Geometry merging helper (furniture = a few draw calls instead of hundreds)
   * ========================================================================= */
  function Merger() {
    const pos = [], nor = [], col = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0), one = new V3(1, 1, 1);
    const c = new THREE.Color();
    function add(geo, x, y, z, ry, color) {
      let g = geo.index ? geo.toNonIndexed() : geo.clone();
      m4.compose(new V3(x, y, z), q.setFromAxisAngle(up, ry || 0), one);
      g.applyMatrix4(m4);
      c.set(color);
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        col.push(c.r, c.g, c.b);
      }
      g.dispose();
    }
    return {
      box: function (w, h, d, x, y, z, ry, color) { add(new THREE.BoxGeometry(w, h, d), x, y, z, ry, color); },
      cyl: function (rt, rb, h, x, y, z, color, seg) { add(new THREE.CylinderGeometry(rt, rb, h, seg || 16), x, y, z, 0, color); },
      sph: function (r, x, y, z, color) { add(new THREE.SphereGeometry(r, 12, 10), x, y, z, 0, color); },
      build: function (material) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        const mesh = new THREE.Mesh(geo, material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        return mesh;
      }
    };
  }

  /* ===========================================================================
   * Building shell
   * ========================================================================= */
  function buildLights() {
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a3350, 0.75));
    dirLight = new THREE.DirectionalLight(0xfff4e0, 0.85);
    dirLight.position.set(CX - 13, 30, CZ + 12);
    dirLight.target.position.set(CX, 0, CZ);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    const sc = dirLight.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 20; sc.bottom = -20; sc.near = 5; sc.far = 80;
    dirLight.shadow.bias = -0.0004; dirLight.shadow.normalBias = 0.03;
    scene.add(dirLight, dirLight.target);
  }

  function buildBaseAndFloors() {
    // Dark ground, glowing plinth (the "diorama base" of a digital twin) and a faint grid
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 220), new THREE.MeshStandardMaterial({ color: 0x050914, roughness: 1, metalness: 0, envMapIntensity: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(CX, -0.62, CZ); ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(120, 60, 0x1a2542, 0x101828);
    grid.position.set(CX, -0.6, CZ); scene.add(grid);

    const pw = BUILDING.width + 2.4, pd = BUILDING.depth + 2.4;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.6, pd),
      new THREE.MeshStandardMaterial({ color: 0x131c30, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.15 }));
    plinth.position.set(CX, -0.32, CZ); plinth.receiveShadow = true; plinth.castShadow = true;
    scene.add(plinth);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(pw, 0.6, pd)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55, toneMapped: false }));
    edge.position.copy(plinth.position); scene.add(edge);

    // Rooms: patterned floors; the corridor is polished and reflective
    const white = new THREE.Color(0xffffff);
    const cache = {};
    ROOMS.forEach(function (room) {
      const w = room.x2 - room.x1, d = room.z2 - room.z1;
      const kind = FLOOR_KINDS[ROOM_FLOOR[room.id] || 'tile'];
      const key = ROOM_FLOOR[room.id];
      const base = cache[key] || (cache[key] = kind.make());
      const map = base.clone(); map.needsUpdate = true;
      map.repeat.set(w / kind.size, d / kind.size);
      const glossy = room.id === 'corr';
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(room.color).lerp(white, 0.12), map: map,
        roughness: glossy ? 0.28 : 0.72, metalness: glossy ? 0.15 : 0.02, envMapIntensity: glossy ? 0.9 : 0.35
      });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      floor.rotation.x = -Math.PI / 2; floor.position.set(room.x1 + w / 2, 0, room.z1 + d / 2);
      floor.receiveShadow = true; scene.add(floor);

      let labelZ = room.z1 + d / 2;
      if (room.row === 'top') labelZ = room.z1 + 0.9;
      if (room.row === 'bottom') labelZ = room.z2 - 0.9;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1),
        new THREE.MeshBasicMaterial({ map: makeTextTexture(room.name, 512, 128, 60, 'rgba(15,23,42,0.5)'), transparent: true, depthWrite: false }));
      label.rotation.x = -Math.PI / 2; label.position.set(room.x1 + w / 2, 0.02, labelZ);
      scene.add(label);
    });
  }

  function buildWalls() {
    const wallTex = makeWallTexture();
    const sideProto = new THREE.MeshStandardMaterial({ color: 0xffffff, map: wallTex, roughness: 0.9, envMapIntensity: 0.2 });
    const topProto = new THREE.MeshStandardMaterial({ color: 0x5b6b86, roughness: 0.8 });
    function mats() { const s = sideProto.clone(), t = topProto.clone(); return [s, s, t, s, s, s]; }

    WALL_PIECES.forEach(function (p) {
      const geo = new THREE.BoxGeometry(p.x2 - p.x1, WALL_H, p.z2 - p.z1);
      geo.translate(0, WALL_H / 2, 0);
      const mesh = new THREE.Mesh(geo, mats());
      mesh.position.set((p.x1 + p.x2) / 2, 0, (p.z1 + p.z2) / 2);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.rect = p; mesh.userData.fade = 1;
      scene.add(mesh); wallMeshes.push(mesh);
    });

    const lintelH = WALL_H - BUILDING.doorHeight;
    const lm = mats();
    DOORS.forEach(function (p) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.x2 - p.x1, lintelH, p.z2 - p.z1), lm);
      mesh.position.set((p.x1 + p.x2) / 2, BUILDING.doorHeight + lintelH / 2, (p.z1 + p.z2) / 2);
      mesh.castShadow = true; scene.add(mesh); lintelMeshes.push(mesh);
    });

    // Door frames, ajar door leaves and name plates
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b4a66, roughness: 0.6 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xb08968, roughness: 0.55, envMapIntensity: 0.3 });
    DOORS.forEach(function (p) {
      const horizontal = (p.x2 - p.x1) > (p.z2 - p.z1);
      const w = BUILDING.doorWidth, h = BUILDING.doorHeight;
      const cxm = (p.x1 + p.x2) / 2, czm = (p.z1 + p.z2) / 2;
      const thick = BUILDING.wallThickness + 0.04;
      [-1, 1].forEach(function (s) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 0.06 : thick, h, horizontal ? thick : 0.06), frameMat);
        jamb.position.set(cxm + (horizontal ? s * (w / 2 + 0.03) : 0), h / 2, czm + (horizontal ? 0 : s * (w / 2 + 0.03)));
        jamb.castShadow = true; scene.add(jamb);
      });
      if (!horizontal) return;
      // Leaf hangs on the west jamb and swings into the room (the room is on the side of the wall away from the corridor)
      const roomSide = czm < CZ ? -1 : 1;
      const geo = new THREE.BoxGeometry(w - 0.04, h - 0.06, 0.05); geo.translate((w - 0.04) / 2, (h - 0.06) / 2, 0);
      const leaf = new THREE.Mesh(geo, leafMat);
      leaf.position.set(p.x1 + 0.02, 0, czm + roomSide * 0.12);
      leaf.rotation.y = -roomSide * (Math.PI * 150 / 180);
      leaf.castShadow = true; scene.add(leaf);

      // Name plate above the door, on the corridor side
      const probe = findRoom(cxm, czm + roomSide * 0.6);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.3),
        new THREE.MeshBasicMaterial({ map: makeTextTexture(probe.name, 512, 100, 52, '#e8eef9'), transparent: true, toneMapped: false }));
      const corrSide = -roomSide;
      plate.position.set(cxm, BUILDING.doorHeight + lintelH / 2, czm + corrSide * (BUILDING.wallThickness / 2 + 0.012));
      if (corrSide < 0) plate.rotation.y = Math.PI;
      scene.add(plate);
    });

    // Exterior windows (decals on the outer faces)
    const glass = new THREE.MeshStandardMaterial({ color: 0x7fb4e8, roughness: 0.05, metalness: 0.85, transparent: true, opacity: 0.6, envMapIntensity: 1.2 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x1f2a44, roughness: 0.6 });
    const half = BUILDING.wallThickness / 2;
    function window_(x, z, ry, w) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.14, 1.24), frame);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.1), glass);
      [f, g].forEach(function (m, i) {
        const off = half + 0.006 + i * 0.006;
        m.position.set(x + Math.sin(ry) * off, 1.45, z + Math.cos(ry) * off);
        m.rotation.y = ry; scene.add(m);
      });
    }
    [4, 12, 20].forEach(function (x) { window_(x, 0, Math.PI, 3.2); });
    [5, 13.5, 20.5].forEach(function (x) { window_(x, BUILDING.depth, 0, 3.0); });
    [3.25].forEach(function (z) { window_(0, z, -Math.PI / 2, 3.0); window_(BUILDING.width, z, Math.PI / 2, 3.0); });
    [12.75].forEach(function (z) { window_(0, z, -Math.PI / 2, 3.0); window_(BUILDING.width, z, Math.PI / 2, 3.0); });
  }

  /* ===========================================================================
   * Furniture
   * ========================================================================= */
  function buildFurniture() {
    const solid = Merger(), glow = Merger();
    const rng = rnd(99);
    const BOOKS = [0xb91c1c, 0x1d4ed8, 0x15803d, 0xca8a04, 0x7c3aed, 0x0f766e, 0xc2410c, 0x475569];
    const rackTex = makeRackTexture();
    const rackMat = new THREE.MeshBasicMaterial({ map: rackTex });
    const rackGeo = new THREE.PlaneGeometry(0.62, 1.78);

    // local (lx, lz) of an item -> world coordinates
    function wp(f, lx, lz) {
      const s = Math.sin(f.rot || 0), c = Math.cos(f.rot || 0);
      return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c };
    }
    function chair(x, z, yaw, color) {
      color = color || 0x334155;
      const s = Math.sin(yaw), c = Math.cos(yaw);
      const loc = function (lx, lz) { return [x + lx * c + lz * s, z - lx * s + lz * c]; };
      let p = loc(0, 0); solid.box(0.4, 0.05, 0.4, p[0], 0.46, p[1], yaw, color);
      p = loc(0, -0.19); solid.box(0.4, 0.42, 0.04, p[0], 0.72, p[1], yaw, color);
      [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]].forEach(function (l) {
        const q = loc(l[0], l[1]); solid.box(0.03, 0.44, 0.03, q[0], 0.22, q[1], yaw, 0x1e293b);
      });
    }
    function monitor(f, lx, lz, topY) {
      const p = wp(f, lx, lz), yaw = f.rot || 0;
      solid.box(0.12, 0.2, 0.1, p.x, topY + 0.1, p.z, yaw, 0x111827);
      solid.box(0.56, 0.34, 0.03, p.x, topY + 0.38, p.z, yaw, 0x0f172a);
      const s = wp(f, lx, lz + 0.02);
      glow.box(0.5, 0.28, 0.004, s.x, topY + 0.38, s.z, yaw, 0x38bdf8);
      const k = wp(f, lx, lz + 0.3);
      solid.box(0.42, 0.015, 0.14, k.x, topY + 0.01, k.z, yaw, 0x1e293b);
    }
    function chairsFor(f, offsetZ) {
      (f.chairs || []).forEach(function (lx) {
        const p = wp(f, lx, f.d / 2 + offsetZ);
        chair(p.x, p.z, (f.rot || 0) + Math.PI);
      });
    }
    function plant(x, z) {
      solid.cyl(0.2, 0.15, 0.4, x, 0.2, z, 0xe2e8f0);
      solid.cyl(0.03, 0.03, 0.45, x, 0.6, z, 0x6b4f2a, 6);
      [[0, 1.0, 0, 0.3], [0.14, 0.85, 0.08, 0.22], [-0.12, 0.9, -0.1, 0.24], [0.04, 1.2, -0.05, 0.2]].forEach(function (b) { solid.sph(b[3], x + b[0], b[1], z + b[2], 0x2f9e58); });
    }

    FURNITURE.forEach(function (f) {
      const yaw = f.rot || 0;
      switch (f.t) {
        case 'bench': {                                    // lab workbench with monitors
          solid.box(f.w, 0.04, f.d, f.x, 0.8, f.z, yaw, 0xe5e9f0);
          solid.box(f.w - 0.1, 0.7, f.d - 0.1, f.x, 0.43, f.z, yaw, 0x64748b);
          for (let i = 0; i < (f.pc || 0); i++) {
            const lx = (f.pc === 1 ? 0 : -f.w / 2 + 0.6 + i * ((f.w - 1.2) / (f.pc - 1)));
            monitor(f, lx, -f.d * 0.2, 0.82);
          }
          chairsFor(f, 0.35); break;
        }
        case 'desk': {
          solid.box(f.w, 0.04, f.d, f.x, 0.74, f.z, yaw, 0xc9a27e);
          [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
            const p = wp(f, s[0] * (f.w / 2 - 0.05), s[1] * (f.d / 2 - 0.05)); solid.box(0.05, 0.72, 0.05, p.x, 0.36, p.z, yaw, 0x475569);
          });
          if (f.pc) monitor(f, 0, -f.d * 0.2, 0.76);
          chairsFor(f, 0.35); break;
        }
        case 'sdesk': {
          solid.box(f.w, 0.03, f.d, f.x, 0.72, f.z, yaw, 0xd9b48f);
          [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
            const p = wp(f, s[0] * (f.w / 2 - 0.05), s[1] * (f.d / 2 - 0.05)); solid.box(0.03, 0.7, 0.03, p.x, 0.35, p.z, yaw, 0x64748b);
          });
          chairsFor(f, 0.3); break;
        }
        case 'shelf': {
          const H = 2.0;
          solid.box(f.w, H, f.d * 0.25, wp(f, 0, -f.d * 0.375).x, H / 2, wp(f, 0, -f.d * 0.375).z, yaw, 0x7c5a3a);
          [-1, 1].forEach(function (s) { const p = wp(f, s * (f.w / 2 - 0.02), 0); solid.box(0.04, H, f.d, p.x, H / 2, p.z, yaw, 0x6b4c30); });
          for (let lvl = 0; lvl <= 5; lvl++) { solid.box(f.w, 0.03, f.d, f.x, 0.05 + lvl * 0.38, f.z, yaw, 0x6b4c30); }
          for (let lvl = 0; lvl < 5; lvl++) {
            let lx = -f.w / 2 + 0.08;
            while (lx < f.w / 2 - 0.12) {
              const bw = 0.04 + rng() * 0.05, bh = 0.22 + rng() * 0.12;
              const p = wp(f, lx + bw / 2, f.d * 0.05);
              solid.box(bw, bh, f.d * 0.6, p.x, 0.065 + lvl * 0.38 + bh / 2, p.z, yaw, BOOKS[Math.floor(rng() * BOOKS.length)]);
              lx += bw + 0.005;
            }
          }
          break;
        }
        case 'rack': {
          solid.box(f.w, 1.9, f.d, f.x, 0.95, f.z, yaw, 0x1e2433);
          const p = wp(f, 0, f.d / 2 + 0.006);
          const m = new THREE.Mesh(rackGeo, rackMat);
          m.position.set(p.x, 0.98, p.z); m.rotation.y = yaw; m.scale.x = f.w / 0.7 * 0.97; scene.add(m);
          break;
        }
        case 'rtable': {
          solid.cyl(f.r, f.r, 0.04, f.x, 0.74, f.z, 0xf1f5f9, 24);
          solid.cyl(0.05, 0.05, 0.72, f.x, 0.37, f.z, 0x64748b, 8);
          solid.cyl(0.28, 0.28, 0.03, f.x, 0.015, f.z, 0x475569, 16);
          for (let k = 0; k < 4; k++) {
            const a = k * Math.PI / 2 + 0.4;
            chair(f.x + Math.sin(a) * (f.r + 0.38), f.z + Math.cos(a) * (f.r + 0.38), a + Math.PI, 0xea580c);
          }
          break;
        }
        case 'counter': {
          solid.box(f.w, 0.95, f.d, f.x, 0.475, f.z, yaw, 0x5b4636);
          solid.box(f.w + 0.1, 0.05, f.d + 0.14, f.x, 0.975, f.z, yaw, 0xe2e8f0);
          const m1 = wp(f, -f.w * 0.25, 0), m2 = wp(f, f.w * 0.15, 0);
          solid.box(0.4, 0.4, 0.35, m1.x, 1.2, m1.z, yaw, 0x1f2937);
          solid.box(0.35, 0.3, 0.3, m2.x, 1.15, m2.z, yaw, 0xb91c1c);
          const sh = wp(f, 0, -f.d * 0.2); solid.box(f.w, 0.04, 0.3, sh.x, 1.5, sh.z, yaw, 0x7c5a3a);
          break;
        }
        case 'vending': {
          solid.box(f.w, 1.85, f.d, f.x, 0.925, f.z, yaw, 0xb91c1c);
          const p = wp(f, 0, f.d / 2 + 0.003);
          glow.box(f.w * 0.75, 1.2, 0.006, p.x, 1.1, p.z, yaw, 0xfde68a);
          break;
        }
        case 'seat': {
          solid.box(f.w, 0.08, f.d, f.x, 0.45, f.z, yaw, 0x334155);
          const p = wp(f, 0, -f.d / 2 + 0.03); solid.box(f.w, 0.4, 0.06, p.x, 0.7, p.z, yaw, 0x334155);
          [-1, 1].forEach(function (s) { const q = wp(f, s * (f.w / 2 - 0.1), 0); solid.box(0.05, 0.42, f.d - 0.1, q.x, 0.21, q.z, yaw, 0x1e293b); });
          break;
        }
        case 'cooler': {
          solid.box(0.35, 0.95, 0.35, f.x, 0.475, f.z, 0, 0xe2e8f0);
          solid.cyl(0.14, 0.14, 0.4, f.x, 1.15, f.z, 0x7dd3fc, 14);
          break;
        }
        case 'board': {
          solid.box(f.w + 0.1, 1.15, 0.03, f.x, 1.55, f.z, 0, 0x94a3b8);
          glow.box(f.w, 1.05, 0.006, f.x, 1.55, f.z + 0.02, 0, 0xf1f5f9);
          break;
        }
        case 'plant': plant(f.x, f.z); break;
      }
    });

    const solidMesh = solid.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05, envMapIntensity: 0.35 }));
    scene.add(solidMesh);
    const glowMesh = glow.build(new THREE.MeshBasicMaterial({ vertexColors: true }));
    glowMesh.castShadow = false; glowMesh.receiveShadow = false;
    scene.add(glowMesh);
  }

  /* ===========================================================================
   * Beacons
   * ========================================================================= */
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function cssColor(n) { return '#' + n.toString(16).padStart(6, '0'); }

  function makeLabel(w, h) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
    sprite.renderOrder = 10;
    return { canvas: canvas, tex: tex, sprite: sprite };
  }

  function drawBeaconLabel(view, d) {
    const g = view.label.canvas.getContext('2d'), w = view.label.canvas.width, h = view.label.canvas.height;
    const col = cssColor(view.beacon.color);
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(10,17,32,0.82)'; roundRect(g, 3, 3, w - 6, h - 6, 16); g.fill();
    g.lineWidth = 3; g.strokeStyle = col; g.stroke();
    g.textBaseline = 'middle';
    g.font = '700 34px "Segoe UI", system-ui, sans-serif'; g.fillStyle = col; g.textAlign = 'left';
    g.fillText(view.beacon.id, 18, 34);
    g.font = '600 34px ui-monospace, Consolas, monospace'; g.fillStyle = '#ffffff'; g.textAlign = 'right';
    g.fillText(d ? d.raw + ' dBm' : '-- dBm', w - 18, 34);
    g.font = '500 24px "Segoe UI", system-ui, sans-serif'; g.fillStyle = '#c3d0e6'; g.textAlign = 'left';
    g.fillText(d ? 'est ' + d.estD2.toFixed(1) + ' m   noise ' + (d.noise >= 0 ? '+' : '') + d.noise.toFixed(1) + ' dB' : 'waiting for scan', 18, 72);
    g.font = '700 19px "Segoe UI", system-ui, sans-serif'; g.fillStyle = '#fde68a';
    g.fillText('SIMULATED SIGNAL', 18, 104);
    view.label.tex.needsUpdate = true;
  }

  function buildBeacons() {
    const glowTex = makeGlowTexture();
    const ringGeo = new THREE.RingGeometry(0.985, 1, 96); ringGeo.rotateX(-Math.PI / 2);
    const pts = [];
    for (let i = 0; i < 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(new V3(Math.cos(a), 0, Math.sin(a))); }
    const circleGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const bh = SIM.beaconHeight;

    BEACONS.forEach(function (b, bi) {
      const group = new THREE.Group(); group.position.set(b.x, 0, b.z); scene.add(group);

      // Hardware: ceiling canopy, hanger rod, white casing, glowing LED ring, status dome
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 }));
      canopy.position.y = WALL_H - 0.015; group.add(canopy);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, WALL_H - bh, 6), new THREE.MeshStandardMaterial({ color: 0x9aa7bb, metalness: 0.7, roughness: 0.3 }));
      rod.position.y = (WALL_H + bh) / 2; group.add(rod);
      const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 32), new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.45, envMapIntensity: 0.6 }));
      casing.position.y = bh; casing.castShadow = true; group.add(casing);
      const ledMat = new THREE.MeshStandardMaterial({ color: b.color, emissive: b.color, emissiveIntensity: 1.2, roughness: 0.4 });
      const led = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 8, 40), ledMat);
      led.rotation.x = Math.PI / 2; led.position.y = bh - 0.032; group.add(led);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), ledMat);
      dome.position.y = bh - 0.03; group.add(dome);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: b.color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      glow.scale.set(0.9, 0.9, 1); glow.position.y = bh - 0.03; group.add(glow);

      const light = new THREE.PointLight(b.color, 0.7, 8, 2);
      light.position.y = bh - 0.2; group.add(light);

      // Drop line and floor marker
      group.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new V3(0, 0.03, 0), new V3(0, bh - 0.05, 0)]),
        new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.4, toneMapped: false })));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.26, 32), new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.75, toneMapped: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03; group.add(disc);

      // Floor glow = coverage area (scaled with the transmission-power / path-loss settings)
      const cover = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: glowTex, color: b.color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      cover.rotation.x = -Math.PI / 2; cover.position.y = 0.012; group.add(cover);

      // Animated wireless rings on the floor
      const rings = [];
      for (let k = 0; k < RING_COUNT; k++) {
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
        ring.position.y = 0.045; group.add(ring); rings.push(ring);
      }

      // Circle whose radius = distance ESTIMATED from the RSSI (trilateration circles)
      const circle = new THREE.LineLoop(circleGeo, new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.7, toneMapped: false }));
      circle.position.y = 0.07; circle.frustumCulled = false; group.add(circle);

      // Receiver -> beacon link
      const linkGeo = new THREE.BufferGeometry();
      linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const link = new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.5, toneMapped: false }));
      link.frustumCulled = false; scene.add(link);

      // Live RSSI label (billboard)
      const label = makeLabel(384, 128);
      label.sprite.scale.set(2.1, 0.7, 1); label.sprite.position.y = bh + 0.62; group.add(label.sprite);

      const view = { beacon: b, group: group, glow: glow, light: light, ledMat: ledMat, rings: rings, circle: circle, link: link, cover: cover, label: label, flash: 0 };
      drawBeaconLabel(view, null);
      beaconViews.push(view);
    });
  }

  /* ===========================================================================
   * People: walking avatar (true position) and hologram (estimate)
   * ========================================================================= */
  function buildAvatar() {
    person = new THREE.Group();
    const A = { };
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b08a, roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.6 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75 });
    const shoes = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 0.8 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x0b0f17 });
    function m(geo, mat, x, y, z) { const o = new THREE.Mesh(geo, mat); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; return o; }

    A.root = new THREE.Group(); person.add(A.root);
    A.hips = new THREE.Group(); A.hips.position.y = 0.92; A.root.add(A.hips);
    A.torso = new THREE.Group(); A.hips.add(A.torso);
    A.torso.add(m(new THREE.CapsuleGeometry(0.16, 0.3, 4, 12), shirt, 0, 0.33, 0));
    const head = new THREE.Group(); head.position.y = 0.72; A.torso.add(head);
    head.add(m(new THREE.SphereGeometry(0.115, 20, 16), skin));
    const cap = m(new THREE.SphereGeometry(0.122, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.012, -0.012); head.add(cap);
    head.add(m(new THREE.SphereGeometry(0.014, 8, 6), dark, -0.04, 0.015, 0.108), m(new THREE.SphereGeometry(0.014, 8, 6), dark, 0.04, 0.015, 0.108));
    A.torso.add(m(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), skin, 0, 0.66, 0));
    // Arms (pivot at shoulder). The right hand holds the phone (the BLE receiver)
    function arm(side) {
      const sh = new THREE.Group(); sh.position.set(side * 0.215, 0.58, 0); A.torso.add(sh);
      sh.add(m(new THREE.CapsuleGeometry(0.048, 0.2, 4, 8), shirt, 0, -0.15, 0));
      const el = new THREE.Group(); el.position.y = -0.31; sh.add(el);
      el.add(m(new THREE.CapsuleGeometry(0.042, 0.19, 4, 8), skin, 0, -0.14, 0));
      el.add(m(new THREE.SphereGeometry(0.045, 10, 8), skin, 0, -0.27, 0));
      return { sh: sh, el: el };
    }
    A.armL = arm(-1); A.armR = arm(1);
    A.armR.sh.rotation.x = -0.75; A.armR.el.rotation.x = -1.05;
    A.phone = m(new THREE.BoxGeometry(0.075, 0.14, 0.012), new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x38bdf8, emissiveIntensity: 0.9 }), 0, -0.3, 0.035);
    A.phone.rotation.x = 0.4; A.armR.el.add(A.phone);
    // Legs (pivot at hip)
    function leg(side) {
      const hp = new THREE.Group(); hp.position.set(side * 0.09, 0, 0); A.hips.add(hp);
      hp.add(m(new THREE.CapsuleGeometry(0.075, 0.26, 4, 8), pants, 0, -0.22, 0));
      const kn = new THREE.Group(); kn.position.y = -0.44; hp.add(kn);
      kn.add(m(new THREE.CapsuleGeometry(0.065, 0.28, 4, 8), pants, 0, -0.19, 0));
      kn.add(m(new THREE.BoxGeometry(0.1, 0.07, 0.25), shoes, 0, -0.4, 0.05));
      return { hp: hp, kn: kn };
    }
    A.legL = leg(-1); A.legR = leg(1);
    avatar = A; A.phase = 0; A.amt = 0; A.heading = 0;
    // Soft blob shadow plus the TRUE-position ring on the floor
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 40), new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.95, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.075; person.add(ring);
    A.ring = ring;
    trueTag = makeLabel(256, 64);
    const g = trueTag.canvas.getContext('2d');
    g.fillStyle = 'rgba(10,17,32,0.82)'; roundRect(g, 2, 2, 252, 60, 14); g.fill(); g.lineWidth = 3; g.strokeStyle = '#facc15'; g.stroke();
    g.font = '700 26px "Segoe UI", system-ui, sans-serif'; g.fillStyle = '#facc15'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TRUE (simulated)', 128, 33);
    trueTag.tex.needsUpdate = true; trueTag.sprite.scale.set(1.2, 0.3, 1); trueTag.sprite.position.y = 2.05;
    person.add(trueTag.sprite);
    scene.add(person);
  }

  function buildEstimateMarker() {
    estMarker = new THREE.Group();
    estRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 40), new THREE.MeshBasicMaterial({ color: 0xe879f9, side: THREE.DoubleSide, transparent: true, opacity: 0.95, toneMapped: false }));
    estRing.rotation.x = -Math.PI / 2; estRing.position.y = 0.09;
    estPin = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 20), new THREE.MeshStandardMaterial({ color: 0xe879f9, emissive: 0xe879f9, emissiveIntensity: 0.7 }));
    estPin.rotation.x = Math.PI; estPin.position.y = 2.05;
    ghost = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.1, 4, 14),
      new THREE.MeshBasicMaterial({ color: 0xe879f9, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    ghost.position.y = 0.9;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 6),
      new THREE.MeshBasicMaterial({ color: 0xe879f9, transparent: true, opacity: 0.5, toneMapped: false }));
    beam.position.y = 0.95;
    estTag = makeLabel(320, 64);
    const g = estTag.canvas.getContext('2d');
    g.fillStyle = 'rgba(10,17,32,0.82)'; roundRect(g, 2, 2, 316, 60, 14); g.fill(); g.lineWidth = 3; g.strokeStyle = '#e879f9'; g.stroke();
    g.font = '700 25px "Segoe UI", system-ui, sans-serif'; g.fillStyle = '#e879f9'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ESTIMATED (simulated)', 160, 33);
    estTag.tex.needsUpdate = true; estTag.sprite.scale.set(1.5, 0.3, 1); estTag.sprite.position.y = 2.55;
    estMarker.add(estRing, estPin, ghost, beam, estTag.sprite);
    scene.add(estMarker);

    // Error vector between true and estimated position
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    errLine = new THREE.Line(eg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, toneMapped: false }));
    errLine.frustumCulled = false; scene.add(errLine);

    // Noise cloud: the last raw (unfiltered) position estimates
    const N = 24;
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    cg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    cloud = { pts: new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.2, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })), n: N, head: 0, count: 0 };
    cloud.pts.frustumCulled = false; scene.add(cloud.pts);
  }

  /* ===========================================================================
   * Trails as flat ribbons (visible in perspective, unlike 1 px lines)
   * ========================================================================= */
  function makeRibbon(color, y, halfW) {
    const max = SIM.maxTrailPoints;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(max * 6);
    const index = new Uint16Array((max - 1) * 6);
    for (let i = 0; i < max - 1; i++) { const a = i * 2; index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1)); geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    mesh.frustumCulled = false; scene.add(mesh);
    return { mesh: mesh, positions: positions, count: 0, y: y, hw: halfW, lx: 0, lz: 0 };
  }
  function setPair(t, i, x, z, px, pz) {
    const o = i * 6;
    t.positions[o] = x + px; t.positions[o + 1] = t.y; t.positions[o + 2] = z + pz;
    t.positions[o + 3] = x - px; t.positions[o + 4] = t.y; t.positions[o + 5] = z - pz;
  }
  function addRibbonPoint(t, x, z) {
    const max = SIM.maxTrailPoints;
    if (t.count === 0) { t.lx = x; t.lz = z; setPair(t, 0, x, z, 0, t.hw); t.count = 1; return; }
    const dx = x - t.lx, dz = z - t.lz, len = Math.hypot(dx, dz);
    if (len < 0.02) return;
    if (t.count >= max) { t.positions.copyWithin(0, 6); t.count = max - 1; }
    const px = -dz / len * t.hw, pz = dx / len * t.hw;
    if (t.count === 1) setPair(t, 0, t.lx, t.lz, px, pz);
    setPair(t, t.count, x, z, px, pz);
    t.count++; t.lx = x; t.lz = z;
    t.mesh.geometry.setDrawRange(0, (t.count - 1) * 6);
    t.mesh.geometry.attributes.position.needsUpdate = true;
  }

  /* ===========================================================================
   * Effects: handoff shockwaves and beacon flashes
   * ========================================================================= */
  function buildFx() {
    const g = new THREE.RingGeometry(0.9, 1, 64); g.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      m.visible = false; m.position.y = 0.1; scene.add(m);
      shockwaves.push({ mesh: m, t: 99 });
    }
  }
  const handoff = { current: -1, cand: -1, streak: 0 };
  function triggerHandoff(from, to) {
    if (options.showEffects) {
      const sw = shockwaves.find(function (s) { return s.t >= 1.4; }) || shockwaves[0];
      sw.t = 0; sw.mesh.material.color.setHex(BEACONS[to].color); sw.mesh.position.x = person.position.x; sw.mesh.position.z = person.position.z; sw.mesh.visible = true;
      beaconViews[to].flash = 1;
    }
    if (api.onHandoff) api.onHandoff(from, to);
  }
  function trackHandoff(near) {
    if (handoff.current < 0) { handoff.current = near; return; }
    if (near === handoff.current) { handoff.cand = -1; handoff.streak = 0; return; }
    if (near === handoff.cand) handoff.streak++; else { handoff.cand = near; handoff.streak = 1; }
    if (handoff.streak >= 3) { const from = handoff.current; handoff.current = near; handoff.cand = -1; handoff.streak = 0; triggerHandoff(from, near); }
  }

  /* ===========================================================================
   * Camera director
   * ========================================================================= */
  const SHOT_INFO = {
    overview: { label: 'Aerial overview',    sub: 'Architectural digital twin', mode: 'controlled', fov: 46 },
    top:      { label: 'Plan view',          sub: 'Top-down floor plan',        mode: 'controlled', fov: 38 },
    orbit:    { label: 'Orbit',              sub: 'Slow aerial orbit around the building', mode: 'controlled', fov: 44 },
    indoor:   { label: 'Indoor detail',      sub: 'Cutaway view of the current room', mode: 'controlled', fov: 46 },
    follow:   { label: 'Follow camera',      sub: 'Tracking the moving person', mode: 'controlled', fov: 55 },
    corridor: { label: 'Corridor level',     sub: 'Eye-level dolly along the main corridor', mode: 'scripted', fov: 72 },
    beacon0:  { label: 'Beacon B1',          sub: 'Ceiling-mounted BLE beacon (simulated signal)', mode: 'scripted', fov: 52 },
    beacon1:  { label: 'Beacon B2',          sub: 'Ceiling-mounted BLE beacon (simulated signal)', mode: 'scripted', fov: 52 },
    beacon2:  { label: 'Beacon B3',          sub: 'Ceiling-mounted BLE beacon (simulated signal)', mode: 'scripted', fov: 52 },
    free:     { label: 'Free camera',        sub: '', mode: 'controlled', fov: 46 }
  };
  const TOUR = [
    { shot: 'overview', dur: 6 }, { shot: 'orbit', dur: 10 }, { shot: 'indoor', dur: 7 },
    { shot: 'corridor', dur: 9 }, { shot: 'beacon0', dur: 4.5 }, { shot: 'beacon1', dur: 4.5 }, { shot: 'beacon2', dur: 4.5 },
    { shot: 'follow', dur: 11 }, { shot: 'top', dur: 5 }
  ];
  const D = {
    shot: 'overview', time: 0, trans: null, cycle: false, tour: null, tourIdx: 0, tourT: 0,
    cur: new V3(CX, 0.5, CZ), indoorT: new V3(CX, 0.5, CZ), orbitA0: 0,
    heading: 0, pointerDown: false, userUntil: 0, now: 0, fov: 46
  };
  const ease = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

  function topPose() {
    const aspect = camera ? camera.aspect : 1.6, fov = SHOT_INFO.top.fov * Math.PI / 180;
    const needH = (BUILDING.depth + 5) / 2 / Math.tan(fov / 2);
    const needW = ((BUILDING.width + 5) / aspect) / 2 / Math.tan(fov / 2);
    return { pos: new V3(CX, Math.max(needH, needW), CZ + 0.5), target: new V3(CX, 0, CZ) };
  }
  function indoorWant() {
    const r = findRoom(person.position.x, person.position.z);
    if (r.id === 'corr') return new V3(clamp(person.position.x, 4, 20), 0.5, CZ);
    if (r.id === 'outside') return new V3(CX, 0.5, CZ);
    return new V3((r.x1 + r.x2) / 2, 0.5, (r.z1 + r.z2) / 2);
  }
  function pose(name, t) {
    switch (name) {
      case 'overview': return { pos: new V3(CX - 5.5, 25, CZ + 26), target: new V3(CX, 0.5, CZ) };
      case 'top': return topPose();
      case 'orbit': return { pos: new V3(CX + Math.cos(D.orbitA0) * 31, 17, CZ + Math.sin(D.orbitA0) * 31), target: new V3(CX, 0.5, CZ) };
      case 'indoor': return { pos: indoorWant().add(new V3(0, 8.5, 8)), target: indoorWant() };
      case 'follow': {
        const h = D.heading, p = person.position;
        return { pos: new V3(clamp(p.x - Math.sin(h) * 3.4, 0.6, BUILDING.width - 0.6), 2.3, clamp(p.z - Math.cos(h) * 3.4, 0.6, BUILDING.depth - 0.6)), target: new V3(p.x + Math.sin(h) * 0.8, 1.1, p.z + Math.cos(h) * 0.8) };
      }
      case 'corridor': {
        const p = Math.PI / 2 + t * (Math.PI * 2 / 30);
        const x = 12 - 10.5 * Math.cos(p), dir = Math.tanh(4 * Math.sin(p));
        const y = 1.55 + 0.02 * Math.sin(t * 6), z = CZ + 0.2 * Math.sin(t * 0.5);
        return { pos: new V3(x, y, z), target: new V3(x + dir * 9, 1.45, z - (1 - Math.abs(dir)) * 3.5) };
      }
      case 'beacon0': case 'beacon1': case 'beacon2': {
        const b = BEACONS[parseInt(name.slice(6), 10)], a = 0.8 + 0.6 * Math.sin(t * 0.35);
        return { pos: new V3(b.x + Math.cos(a) * 3.0, SIM.beaconHeight + 0.2 + 0.12 * Math.sin(t * 0.5), b.z + Math.sin(a) * 3.0), target: new V3(b.x, 2.3, b.z) };
      }
      default: return { pos: camera.position.clone(), target: D.cur.clone() };
    }
  }
  function configureControls(name) {
    const top = name === 'top';
    controls.enableRotate = !top;
    controls.screenSpacePanning = true;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI * (name === 'follow' || name === 'indoor' ? 0.49 : 0.47);
    controls.minDistance = name === 'follow' ? 1.6 : (name === 'indoor' ? 3 : 2);
    controls.maxDistance = name === 'follow' ? 14 : (name === 'indoor' ? 40 : 90);
    if (top) controls.maxPolarAngle = Math.PI / 2;
  }
  function notify(name) {
    if (api.onShot) api.onShot(name, SHOT_INFO[name] || SHOT_INFO.free, !!D.tour);
  }

  function goTo(name, dur, silent) {
    const prevFov = camera.fov;
    D.shot = name; D.time = 0;
    if (name === 'orbit') D.orbitA0 = Math.atan2(camera.position.z - CZ, camera.position.x - CX);
    D.indoorT.copy(indoorWant());
    const info = SHOT_INFO[name];
    const des = pose(name, 0);
    const dist = camera.position.distanceTo(des.pos);
    D.trans = {
      t0: D.now, dur: dur || (dist > 30 ? 2.8 : 2.0), fromPos: camera.position.clone(), fromTarget: D.cur.clone(), fromFov: prevFov,
      arc: dist > 12 ? Math.min(6, dist * 0.12) : 0
    };
    controls.enabled = false;
    if (!silent) notify(name);
    void info;
  }

  function finishTransition() {
    const info = SHOT_INFO[D.shot], des = pose(D.shot, D.time);
    D.trans = null;
    camera.position.copy(des.pos); D.cur.copy(des.target);
    camera.lookAt(D.cur);
    if (info.mode === 'controlled') {
      controls.target.copy(D.cur); configureControls(D.shot); controls.enabled = true; controls.update();
    }
  }

  function updateDirector(dt) {
    D.time += dt;
    // Smooth the heading used by follow camera
    // (avatar heading is smoothed in updateAvatar; D.heading mirrors it)
    // --- tour sequencing ---
    if (D.tour) {
      D.tourT += dt;
      if (D.tourT >= TOUR[D.tourIdx].dur) {
        D.tourIdx = (D.tourIdx + 1) % TOUR.length; D.tourT = 0;
        goTo(TOUR[D.tourIdx].shot, 2.2);
      }
    } else if (D.cycle && D.shot.indexOf('beacon') === 0 && !D.trans && D.time > 5.5) {
      goTo('beacon' + ((parseInt(D.shot.slice(6), 10) + 1) % 3), 1.8);
    }

    if (D.trans) {
      const tr = D.trans, p = Math.min(1, (D.now - tr.t0) / tr.dur), e = ease(p);
      const des = pose(D.shot, D.time), info = SHOT_INFO[D.shot];
      camera.position.lerpVectors(tr.fromPos, des.pos, e);
      camera.position.y += Math.sin(Math.PI * e) * tr.arc;
      D.cur.lerpVectors(tr.fromTarget, des.target, e);
      camera.fov = tr.fromFov + (info.fov - tr.fromFov) * e; camera.updateProjectionMatrix();
      camera.lookAt(D.cur);
      if (p >= 1) finishTransition();
      return;
    }

    const info = SHOT_INFO[D.shot];
    if (camera.fov !== info.fov) { camera.fov = info.fov; camera.updateProjectionMatrix(); }
    if (info.mode === 'scripted') {
      const des = pose(D.shot, D.time);
      camera.position.copy(des.pos); D.cur.copy(des.target); camera.lookAt(D.cur);
      return;
    }
    // Controlled shots: OrbitControls drives, plus gentle automatic motion
    const userActive = D.pointerDown || D.now < D.userUntil;
    if (D.shot === 'orbit' && !userActive) {
      const off = camera.position.clone().sub(controls.target);
      off.applyAxisAngle(new V3(0, 1, 0), 0.14 * dt);
      camera.position.copy(controls.target).add(off);
    } else if (D.shot === 'follow') {
      const p = person.position, want = new V3(p.x + Math.sin(D.heading) * 0.8, 1.15, p.z + Math.cos(D.heading) * 0.8);
      const delta = want.clone().sub(controls.target);
      camera.position.add(delta); controls.target.add(delta);
      if (!userActive) {
        const off = camera.position.clone().sub(controls.target);
        const cur = Math.atan2(off.x, off.z), goal = D.heading + Math.PI;
        let diff = goal - cur; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        off.applyAxisAngle(new V3(0, 1, 0), diff * (1 - Math.exp(-dt * 1.3)));
        camera.position.copy(controls.target).add(off);
        camera.position.x = clamp(camera.position.x, 0.6, BUILDING.width - 0.6);     // stay inside the building
        camera.position.z = clamp(camera.position.z, 0.6, BUILDING.depth - 0.6);
      }
    } else if (D.shot === 'indoor') {
      D.indoorT.lerp(indoorWant(), 1 - Math.exp(-dt * 1.4));
      const delta = D.indoorT.clone().sub(controls.target);
      camera.position.add(delta); controls.target.add(delta);
    }
    controls.update();
    D.cur.copy(controls.target);
  }

  function interrupt() {
    D.userUntil = D.now + 2500;
    if (D.tour) stopTour(true);
    const info = SHOT_INFO[D.shot];
    if (info.mode === 'scripted' || D.trans) {
      if (D.trans && SHOT_INFO[D.shot].mode === 'controlled') return;   // let a controlled transition finish
      D.trans = null; D.shot = 'free'; D.cycle = false;
      controls.target.copy(D.cur); configureControls('free'); controls.enabled = true; controls.update();
      notify('free');
    }
  }

  function startTour() {
    D.tour = true; D.cycle = false; D.tourIdx = 0; D.tourT = 0;
    goTo(TOUR[0].shot, 2.4);
  }
  function stopTour(silent) {
    if (!D.tour) return;
    D.tour = null;
    if (!silent) notify(D.shot);
  }
  function setShot(name) {
    if (!SHOT_INFO[name] && name !== 'beacons' && name !== 'tour') return;
    if (name === 'tour') { startTour(); return; }
    D.tour = null;
    D.cycle = (name === 'beacons');
    goTo(name === 'beacons' ? 'beacon0' : name);
  }
  function resetView() {
    D.tour = null;
    const same = (D.shot === 'free') ? 'overview' : D.shot;
    goTo(same, 1.6);
  }

  /* ===========================================================================
   * Occlusion fade: walls between the camera and the subject turn transparent
   * ========================================================================= */
  function segHitsRect(ax, az, bx, bz, r, pad) {
    let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
    const lo = [r.x1 - pad, r.z1 - pad], hi = [r.x2 + pad, r.z2 + pad], a = [ax, az], d = [dx, dz];
    for (let i = 0; i < 2; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return -1; }
      else {
        let ta = (lo[i] - a[i]) / d[i], tb = (hi[i] - a[i]) / d[i];
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) return -1;
      }
    }
    return t0;
  }
  function updateWallFade(dt) {
    const fadeShots = D.shot !== 'overview' && D.shot !== 'top' && D.shot !== 'orbit';
    const cp = camera.position, tg = D.cur;
    const active = fadeShots && !options.lowWalls && !(D.shot === 'free' && cp.y > 9);
    const k = 1 - Math.exp(-dt * 8);
    wallMeshes.forEach(function (w) {
      let want = 1;
      if (active) {
        const r = w.userData.rect;
        const t = segHitsRect(cp.x, cp.z, tg.x, tg.z, r, 0.05);
        if (t >= 0 && cp.y + (tg.y - cp.y) * t < WALL_H + 0.1) want = 0.1;
        const cx_ = clamp(cp.x, r.x1, r.x2), cz_ = clamp(cp.z, r.z1, r.z2);
        if (cp.y < WALL_H + 0.3 && Math.hypot(cp.x - cx_, cp.z - cz_) < 0.7) want = 0.1;
      }
      const f = w.userData.fade + (want - w.userData.fade) * k;
      if (Math.abs(f - w.userData.fade) > 0.002) {
        w.userData.fade = f;
        const ms = w.material, tr = f < 0.99;
        [ms[0], ms[2]].forEach(function (mat) { mat.opacity = f; mat.transparent = tr; mat.depthWrite = f > 0.5; });
      }
    });
  }

  /* ===========================================================================
   * Per-frame updates
   * ========================================================================= */
  let walkTarget = { moving: false };
  /* Keeps 3D labels at a readable size: smaller when the camera is close, larger when far away. */
  const _lp = new V3();
  function fitLabel(sprite, baseW, baseH) {
    sprite.getWorldPosition(_lp);
    const k = clamp(camera.position.distanceTo(_lp) / 14, 0.28, 1.6);
    sprite.scale.set(baseW * k, baseH * k, 1);
  }

  function updateAvatar(dt) {
    const A = avatar;
    // Turn smoothly towards the walking direction
    let diff = walkTarget.heading - A.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    A.heading += diff * (1 - Math.exp(-dt * 10));
    D.heading = A.heading;
    A.root.rotation.y = A.heading;
    A.amt += ((walkTarget.moving ? 1 : 0) - A.amt) * (1 - Math.exp(-dt * 8));
    if (walkTarget.moving) A.phase += dt * Math.PI * 2 * params.speed / 1.4;
    const s = Math.sin(A.phase), c = Math.cos(A.phase), a = A.amt;
    A.legL.hp.rotation.x = -0.65 * s * a;
    A.legR.hp.rotation.x = 0.65 * s * a;
    A.legL.kn.rotation.x = 0.95 * Math.max(0, c) * a;
    A.legR.kn.rotation.x = 0.95 * Math.max(0, -c) * a;
    A.armL.sh.rotation.x = 0.55 * s * a; A.armL.el.rotation.x = -0.25 - 0.2 * Math.max(0, -s) * a;
    A.armR.sh.rotation.x = -0.75 + 0.06 * s * a;
    A.hips.position.y = 0.92 + 0.025 * Math.cos(2 * A.phase) * a;
    A.hips.rotation.y = 0.08 * s * a;
    A.torso.rotation.x = 0.06 * a;
    A.torso.rotation.y = -0.1 * s * a;
    A.ring.rotation.z += dt * 0.8;
  }

  function updateBeacons(dt, t) {
    const maxRadius = clamp(BleModel.rangeAtRssi(-85), 3, 14);
    const coverR = clamp(BleModel.rangeAtRssi(-78), 3, 9);
    beaconViews.forEach(function (view, i) {
      view.flash = Math.max(0, view.flash - dt / 1.2);
      const f = view.flash;
      view.glow.scale.setScalar((0.9 + 0.12 * Math.sin(t * 3 + i)) * (1 + f * 1.6));
      view.ledMat.emissiveIntensity = 1.2 + f * 3;
      view.light.intensity = 0.7 + f * 3;
      view.rings.forEach(function (ring, k) {
        const phase = ((t / RING_PERIOD) + k / RING_COUNT) % 1;
        const s = 0.4 + phase * (maxRadius - 0.4);
        ring.scale.set(s, 1, s);
        ring.material.opacity = Math.pow(1 - phase, 1.6) * 0.55;
        ring.visible = options.showRings;
      });
      view.cover.visible = options.showCoverage;
      view.cover.scale.set(coverR, coverR, 1);
      view.cover.material.opacity = 0.26 + 0.08 * Math.sin(t * 2 + i * 2) + f * 0.3;
      view.circle.visible = options.showCircles;
      view.link.visible = options.showLines;
      view.label.sprite.visible = options.showLabels;
      if (options.showLabels) fitLabel(view.label.sprite, 2.1, 0.7);
      const pos = view.link.geometry.attributes.position;
      pos.setXYZ(0, person.position.x, SIM.receiverHeight, person.position.z);
      pos.setXYZ(1, view.beacon.x, SIM.beaconHeight, view.beacon.z);
      pos.needsUpdate = true;
    });
  }

  function updateMarkers(dt, t) {
    const k = 1 - Math.exp(-dt * 7);
    estMarker.position.lerp(estTarget, k);
    estPin.position.y = 2.05 + 0.08 * Math.sin(t * 4);
    const rs = 1 + 0.15 * Math.sin(t * 5);
    estRing.scale.set(rs, rs, 1);
    ghost.material.opacity = 0.16 + 0.06 * Math.sin(t * 3);
    trueTag.sprite.visible = options.showLabels; estTag.sprite.visible = options.showLabels;
    if (options.showLabels) { fitLabel(trueTag.sprite, 1.2, 0.3); fitLabel(estTag.sprite, 1.5, 0.3); }
    const p = errLine.geometry.attributes.position;
    p.setXYZ(0, person.position.x, 0.11, person.position.z); p.setXYZ(1, estMarker.position.x, 0.11, estMarker.position.z); p.needsUpdate = true;
    trueTrail.mesh.visible = options.showTrail; estTrail.mesh.visible = options.showTrail;
    cloud.pts.visible = options.showScatter;
  }

  function updateFx(dt) {
    shockwaves.forEach(function (s) {
      if (s.t >= 1.4) { s.mesh.visible = false; return; }
      s.t += dt;
      const p = Math.min(1, s.t / 1.4);
      s.mesh.scale.setScalar(0.4 + p * 4.5);
      s.mesh.material.opacity = Math.pow(1 - p, 1.5) * 0.9;
    });
  }

  /* Render quality + adaptive resolution */
  const Q = { mode: 'auto', pr: 1, frames: 0, acc: 0, fps: 60, shadows: true, level: 2 };
  function applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    let pr = 1, shadows = true, size = 2048;
    if (Q.mode === 'high') { pr = Math.min(dpr, 2); }
    else if (Q.mode === 'balanced') { pr = Math.min(dpr, 1.5); size = 1024; }
    else if (Q.mode === 'low') { pr = 1; shadows = false; }
    else { pr = Math.min(dpr, Q.level >= 2 ? 1.75 : (Q.level === 1 ? 1.25 : 1)); shadows = Q.level >= 1; size = Q.level >= 2 ? 2048 : 1024; }
    Q.pr = pr; Q.shadows = shadows;
    renderer.setPixelRatio(pr);
    if (dirLight) {
      dirLight.castShadow = shadows;
      if (dirLight.shadow.mapSize.x !== size) { dirLight.shadow.mapSize.set(size, size); if (dirLight.shadow.map) { dirLight.shadow.map.dispose(); dirLight.shadow.map = null; } }
    }
    resize();
  }
  function trackFps(dt) {
    Q.frames++; Q.acc += dt;
    if (Q.acc >= 2.5) {
      Q.fps = Q.frames / Q.acc; Q.frames = 0; Q.acc = 0;
      if (Q.mode === 'auto') {
        if (Q.fps < 28 && Q.level > 0) { Q.level--; applyQuality(); }
        else if (Q.fps > 57 && Q.level < 2 && (window.devicePixelRatio || 1) > 1 && Q.level === 1) { Q.level++; applyQuality(); }
      }
    }
  }

  function resize() {
    if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (D.shot === 'top' && !D.trans) { const p = topPose(); const off = p.pos.clone().sub(camera.position); if (off.length() > 0.5) { camera.position.copy(p.pos); controls.target.copy(p.target); controls.update(); } }
  }

  /* ===========================================================================
   * Public API
   * ========================================================================= */
  function init(hostElement) {
    host = hostElement;
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);
    maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1020);
    scene.fog = new THREE.Fog(0x0a1020, 70, 170);
    scene.environment = makeEnvironment();

    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = 0.7;

    buildLights();
    buildBaseAndFloors();
    buildWalls();
    buildFurniture();
    buildBeacons();
    buildAvatar();
    buildEstimateMarker();
    buildFx();
    trueTrail = makeRibbon(0xfacc15, 0.08, 0.07);
    estTrail = makeRibbon(0xe879f9, 0.1, 0.06);
    walkTarget.heading = Math.PI / 2;

    // Intro: start high and far away, then fly in to the aerial overview
    camera.position.set(CX + 12, 75, CZ + 85); D.cur.set(CX, 0, CZ); camera.lookAt(D.cur);
    controls.target.copy(D.cur); configureControls('overview');
    goTo('overview', 3.8, true);

    const el = renderer.domElement;
    el.addEventListener('pointerdown', function () { D.pointerDown = true; interrupt(); }, true);
    window.addEventListener('pointerup', function () { D.pointerDown = false; D.userUntil = D.now + 2500; });
    el.addEventListener('wheel', interrupt, { capture: true, passive: true });

    if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
    window.addEventListener('resize', resize);
    applyQuality();
  }

  function setPerson(x, z, heading, moving) {
    person.position.set(x, 0, z);
    walkTarget.heading = heading; walkTarget.moving = moving;
  }

  function setReading(reading, snap) {
    estTarget.set(reading.est.x, 0, reading.est.z);
    if (snap) estMarker.position.copy(estTarget);
    beaconViews.forEach(function (view, i) {
      const b = reading.beacons[i];
      const r = Math.max(b.estD2, 0.05);
      view.circle.scale.set(r, 1, r);
      view.link.material.opacity = 0.15 + 0.75 * clamp((b.filtered + 100) / 60, 0, 1);
      drawBeaconLabel(view, b);
    });
    if (reading.committed) {
      trackHandoff(reading.nearest);
      if (reading.estRaw) {                                   // noise cloud
        const p = cloud.pts.geometry.attributes.position, c = cloud.pts.geometry.attributes.color;
        p.setXYZ(cloud.head, reading.estRaw.x, 0.14, reading.estRaw.z);
        cloud.head = (cloud.head + 1) % cloud.n; cloud.count = Math.min(cloud.n, cloud.count + 1);
        for (let k = 0; k < cloud.count; k++) {
          const idx = (cloud.head - 1 - k + cloud.n) % cloud.n, fade = 1 - k / cloud.n;
          c.setXYZ(idx, 1.0 * fade, 0.55 * fade, 1.0 * fade);
        }
        p.needsUpdate = true; c.needsUpdate = true;
      }
    }
  }

  function pushTrail(kind, x, z) { addRibbonPoint(kind === 'true' ? trueTrail : estTrail, x, z); }

  function clearTrails() {
    [trueTrail, estTrail].forEach(function (t) { t.count = 0; t.mesh.geometry.setDrawRange(0, 0); });
    cloud.count = 0; cloud.head = 0;
    const c = cloud.pts.geometry.attributes.color; c.array.fill(0); c.needsUpdate = true;
    const p = cloud.pts.geometry.attributes.position; p.array.fill(0); p.needsUpdate = true;
  }
  function resetFx() { handoff.current = -1; handoff.cand = -1; handoff.streak = 0; }

  function setOption(name, value) {
    options[name] = value;
    if (name === 'lowWalls') {
      wallMeshes.forEach(function (m) { m.scale.y = value ? 0.18 : 1; });
      lintelMeshes.forEach(function (m) { m.visible = !value; });
    }
  }
  function setQuality(q) { Q.mode = q; if (q === 'auto') Q.level = 2; applyQuality(); }

  function render(dt, t) {
    D.now = t;
    trackFps(dt);
    updateAvatar(dt);
    updateBeacons(dt, t);
    updateMarkers(dt, t);
    updateFx(dt);
    updateDirector(dt);
    updateWallFade(dt);
    renderer.render(scene, camera);
  }

  api.init = init; api.render = render; api.setShot = setShot; api.resetView = resetView;
  api.startTour = startTour; api.stopTour = function () { stopTour(false); }; api.setPerson = setPerson;
  api.setReading = setReading; api.pushTrail = pushTrail; api.clearTrails = clearTrails;
  api.setOption = setOption; api.setQuality = setQuality; api.resetFx = resetFx;
  api.getFps = function () { return Q.fps; };
  api.isTouring = function () { return !!D.tour; };
  api.setCamera = function (m) { setShot(m === 'top' ? 'top' : 'overview'); };   // kept for older callers
  return api;
})();

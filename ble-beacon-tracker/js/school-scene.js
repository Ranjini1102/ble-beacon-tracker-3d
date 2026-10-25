/* =============================================================================
 * school-scene.js  –  Realistic 3D Smart School Campus & Detailed Student Avatars
 *
 * Features:
 *   - Colourful modern campus: cream/beige walls, pastel green friezes, landscaped lawn,
 *     3D trees, flowering shrubs, grand entrance portico, and 3D school name board.
 *   - Detailed realistic-looking student avatars with anatomical seated poses, school
 *     uniforms (shirt, collar, tie, trousers/skirts), shoes, and high-res procedural faces
 *     with eyes, pupils, eyebrows, nose, lips, hair, and subtle blinking/idle animations.
 *   - Classroom signboards above every room door.
 *   - Zoom-in camera portrait view on student click/selection.
 *   - Natural daylight lighting, anti-aliased soft shadows, and clean status indicators.
 * ========================================================================== */
'use strict';

var SchoolScene = (function() {

  /* ── Private state ─────────────────────────────────────────────────────── */
  var host, renderer, scene, camera, controls;
  var ambLight, dirLight, hemiLight;
  var maxAniso = 4;
  var fpsAccum = 0, fpsFrames = 0, fpsVal = 60;
  var clock = 0;
  var mode = 'overview';  // 'overview' | 'fps' | 'focus'
  var pointerLocked = false;

  var player = { x: 24, z: 12, yaw: 0, pitch: 0 };
  var keys   = { w: false, s: false, a: false, d: false };

  var beaconViews = {};    // beaconId → {group, rings, led}
  var studentMeshes = {};  // studentId → {group, ring, head, faceCanvas, faceCtx, faceTex, blinkTimer, studentData}
  var treeMeshes = [];
  var selectedStudentId = null;

  var lastRoomId = null;
  var onRoomChange = null;
  var onStudentClick = null;
  var onModeChange = null;

  // Camera transition animation
  var camAnim = null; // {startPos, targetPos, startLook, targetLook, progress, duration, onComplete}

  /* ── Canvas Texture Helpers ────────────────────────────────────────────── */
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }

  // Terrazzo / checkered tiles for classrooms
  function classroomTileTex() {
    return canvasTex(512, 512, function(g, w, h) {
      g.fillStyle = '#f6f7fa'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(180, 190, 210, 0.45)'; g.lineWidth = 3;
      var sz = 64;
      for (var i = 0; i < 8; i++) {
        for (var j = 0; j < 8; j++) {
          if ((i + j) % 2 === 0) {
            g.fillStyle = '#f0f3f8';
            g.fillRect(i * sz, j * sz, sz, sz);
          }
          g.strokeRect(i * sz, j * sz, sz, sz);
        }
      }
    });
  }

  // Parquet wood for library
  function parquetWoodTex() {
    return canvasTex(512, 512, function(g, w, h) {
      g.fillStyle = '#b58855'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#9e7040';
      for (var row = 0; row < 16; row++) {
        for (var col = 0; col < 8; col++) {
          var x = col * 64, y = row * 32;
          var shade = (row * 3 + col * 7) % 5;
          if (shade === 0) g.fillStyle = '#a67746';
          else if (shade === 1) g.fillStyle = '#bd915e';
          else if (shade === 2) g.fillStyle = '#ab7c4a';
          else g.fillStyle = '#9c6f3d';
          g.fillRect(x, y, 64, 32);
          g.strokeStyle = 'rgba(50, 30, 15, 0.25)';
          g.lineWidth = 1;
          g.strokeRect(x, y, 64, 32);
        }
      }
    });
  }

  // Polished granite/stone for corridor and entrance plaza
  function graniteStoneTex() {
    return canvasTex(512, 512, function(g, w, h) {
      g.fillStyle = '#e8ecf2'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(140, 155, 175, 0.4)'; g.lineWidth = 3;
      var sz = 128;
      for (var i = 0; i < 4; i++) {
        for (var j = 0; j < 4; j++) {
          g.strokeRect(i * sz, j * sz, sz, sz);
          // subtle stone flecks
          g.fillStyle = 'rgba(120, 135, 160, 0.08)';
          g.fillRect(i * sz + 10, j * sz + 10, sz - 20, sz - 20);
        }
      }
    });
  }

  // Exterior cream/beige plaster wall with subtle masonry lines
  function exteriorPlasterTex() {
    return canvasTex(256, 512, function(g, w, h) {
      // Cream beige base
      g.fillStyle = '#f5efe4'; g.fillRect(0, 0, w, h);
      // Subtle masonry bands
      g.strokeStyle = 'rgba(195, 185, 170, 0.35)'; g.lineWidth = 2;
      for (var y = 32; y < h; y += 48) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
      // Top pastel green frieze band
      g.fillStyle = '#8db8a7'; g.fillRect(0, 0, w, 28);
      g.strokeStyle = '#759f8e'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 28); g.lineTo(w, 28); g.stroke();
    });
  }

  // Interior classroom wall: warm cream with wood wainscot rail
  function interiorWallTex() {
    return canvasTex(256, 512, function(g, w, h) {
      g.fillStyle = '#faf8f3'; g.fillRect(0, 0, w, h);
      // Wood wainscot rail at chair height
      g.fillStyle = '#8a5e3c'; g.fillRect(0, h - 80, w, 14);
      g.fillStyle = '#e8dfd2'; g.fillRect(0, h - 66, w, 66);
      // Top accent strip
      g.fillStyle = '#9fc3b5'; g.fillRect(0, 0, w, 18);
    });
  }

  // Grass terrain texture
  function grassTerrainTex() {
    return canvasTex(512, 512, function(g, w, h) {
      g.fillStyle = '#4c8a49'; g.fillRect(0, 0, w, h);
      // blades texture
      g.fillStyle = '#5ba158';
      for (var i = 0; i < 400; i++) {
        var rx = Math.random() * w, ry = Math.random() * h;
        g.fillRect(rx, ry, 2 + Math.random() * 3, 4 + Math.random() * 5);
      }
      g.fillStyle = '#3e753b';
      for (var j = 0; j < 300; j++) {
        var rx2 = Math.random() * w, ry2 = Math.random() * h;
        g.fillRect(rx2, ry2, 2, 4);
      }
    });
  }

  // General text texture helper
  function makeTextTex(text, bw, bh, fpx, color, bgColor) {
    var t = canvasTex(bw, bh, function(g, w, h) {
      if (bgColor) {
        g.fillStyle = bgColor;
        g.fillRect(0, 0, w, h);
      } else {
        g.clearRect(0, 0, w, h);
      }
      g.font = '700 ' + fpx + 'px "Inter",system-ui,sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = color;
      g.fillText(text, w / 2, h / 2);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  /* ── Procedural Face Generator ─────────────────────────────────────────── */
  function drawStudentFace(ctx, w, h, s, isBlinking) {
    ctx.clearRect(0, 0, w, h);

    // 1. Skin base with soft radial contouring
    var skin = s.skinTone || '#ecd0b8';
    var grad = ctx.createRadialGradient(w/2, h/2 - 10, 30, w/2, h/2, w/2);
    grad.addColorStop(0, skin);
    grad.addColorStop(0.85, skin);
    grad.addColorStop(1, '#b88a6d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 2. Rosy cheeks
    ctx.fillStyle = 'rgba(235, 120, 110, 0.14)';
    ctx.beginPath(); ctx.arc(w * 0.28, h * 0.58, 42, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.72, h * 0.58, 42, 0, Math.PI * 2); ctx.fill();

    // 3. Eyebrows
    ctx.strokeStyle = s.hairColor ? ('#' + s.hairColor.toString(16).padStart(6, '0')) : '#2a1a10';
    ctx.lineWidth = s.gender === 'f' ? 5 : 7;
    ctx.lineCap = 'round';
    // Left eyebrow
    ctx.beginPath();
    ctx.moveTo(w * 0.24, h * 0.38);
    ctx.quadraticCurveTo(w * 0.35, h * 0.33, w * 0.44, h * 0.37);
    ctx.stroke();
    // Right eyebrow
    ctx.beginPath();
    ctx.moveTo(w * 0.56, h * 0.37);
    ctx.quadraticCurveTo(w * 0.65, h * 0.33, w * 0.76, h * 0.38);
    ctx.stroke();

    // 4. Eyes
    var eyeY = h * 0.46;
    var eyeDist = w * 0.17;
    var eyeRadius = 24;

    if (isBlinking) {
      // Closed eye arc
      ctx.strokeStyle = '#3a2215';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w/2 - eyeDist, eyeY + 4, eyeRadius * 0.8, 0.1 * Math.PI, 0.9 * Math.PI, false);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w/2 + eyeDist, eyeY + 4, eyeRadius * 0.8, 0.1 * Math.PI, 0.9 * Math.PI, false);
      ctx.stroke();
    } else {
      // Open eyes
      [w/2 - eyeDist, w/2 + eyeDist].forEach(function(cx) {
        // White sclera
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(cx, eyeY, eyeRadius * 1.05, eyeRadius * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(70, 45, 30, 0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Iris
        ctx.fillStyle = s.eyeColor || '#382618';
        ctx.beginPath();
        ctx.arc(cx, eyeY, eyeRadius * 0.52, 0, Math.PI * 2);
        ctx.fill();

        // Pupil
        ctx.fillStyle = '#0a0a0c';
        ctx.beginPath();
        ctx.arc(cx, eyeY, eyeRadius * 0.26, 0, Math.PI * 2);
        ctx.fill();

        // Specular highlight
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 4, eyeY - 5, 4, 0, Math.PI * 2);
        ctx.fill();
      });

      // Upper eyelid line
      ctx.strokeStyle = '#2d1810';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(w/2 - eyeDist, eyeY - 2, eyeRadius * 1.05, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w/2 + eyeDist, eyeY - 2, eyeRadius * 1.05, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
    }

    // 5. Glasses (if student wears spectacles)
    if (s.glasses) {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.strokeRect(w/2 - eyeDist - 28, eyeY - 20, 56, 40);
      ctx.strokeRect(w/2 + eyeDist - 28, eyeY - 20, 56, 40);
      // Bridge
      ctx.beginPath();
      ctx.moveTo(w/2 - eyeDist + 28, eyeY);
      ctx.lineTo(w/2 + eyeDist - 28, eyeY);
      ctx.stroke();
    }

    // 6. Nose
    ctx.strokeStyle = 'rgba(130, 85, 55, 0.4)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w/2, h * 0.44);
    ctx.lineTo(w/2 - 4, h * 0.62);
    ctx.quadraticCurveTo(w/2, h * 0.66, w/2 + 6, h * 0.63);
    ctx.stroke();
    // Nostrils
    ctx.fillStyle = 'rgba(90, 50, 30, 0.35)';
    ctx.beginPath(); ctx.arc(w/2 - 9, h * 0.64, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w/2 + 9, h * 0.64, 3, 0, Math.PI * 2); ctx.fill();

    // 7. Lips / Smile
    ctx.fillStyle = '#c56a64';
    ctx.beginPath();
    // Upper lip
    ctx.moveTo(w * 0.38, h * 0.77);
    ctx.quadraticCurveTo(w/2, h * 0.74, w * 0.62, h * 0.77);
    // Lower lip
    ctx.quadraticCurveTo(w/2, h * 0.83, w * 0.38, h * 0.77);
    ctx.fill();
    // Smile line
    ctx.strokeStyle = '#853730';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.36, h * 0.76);
    ctx.quadraticCurveTo(w/2, h * 0.78, w * 0.64, h * 0.76);
    ctx.stroke();
  }

  function createStudentFaceTexture(s) {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    var ctx = c.getContext('2d');
    drawStudentFace(ctx, 512, 512, s, false);
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = maxAniso;
    return { canvas: c, ctx: ctx, texture: tex };
  }

  /* ── Materials Cache ────────────────────────────────────────────────────── */
  var matExteriorWall, matInteriorWall, matFloorClassroom, matFloorCorridor, matFloorLibrary, matCeiling;
  var matDeskWood, matChairMetal, matChairSeat, matBookshelf, matChalkboard;
  var matBeaconBody, matGrass, matPlazaPavement, matPorticoColumn;
  var matGlassWindow, matDoorFrame;

  function initMaterials() {
    matExteriorWall = new THREE.MeshStandardMaterial({
      map: exteriorPlasterTex(),
      roughness: 0.75,
      metalness: 0.05
    });

    matInteriorWall = new THREE.MeshStandardMaterial({
      map: interiorWallTex(),
      roughness: 0.82
    });

    var cTile = classroomTileTex(); cTile.repeat.set(4, 4);
    matFloorClassroom = new THREE.MeshStandardMaterial({
      map: cTile,
      roughness: 0.35,
      metalness: 0.05
    });

    var gStone = graniteStoneTex(); gStone.repeat.set(6, 4);
    matFloorCorridor = new THREE.MeshStandardMaterial({
      map: gStone,
      roughness: 0.4,
      metalness: 0.08
    });

    var pWood = parquetWoodTex(); pWood.repeat.set(4, 4);
    matFloorLibrary = new THREE.MeshStandardMaterial({
      map: pWood,
      roughness: 0.45,
      metalness: 0.05
    });

    var grs = grassTerrainTex(); grs.repeat.set(12, 10);
    matGrass = new THREE.MeshStandardMaterial({
      map: grs,
      roughness: 0.9,
      color: 0x488a44
    });

    var plzp = graniteStoneTex(); plzp.repeat.set(8, 6);
    matPlazaPavement = new THREE.MeshStandardMaterial({
      map: plzp,
      roughness: 0.55
    });

    matCeiling = new THREE.MeshStandardMaterial({ color: 0xfafcff, roughness: 0.9 });
    matDeskWood = new THREE.MeshStandardMaterial({ color: 0xc8985c, roughness: 0.65 });
    matChairMetal = new THREE.MeshStandardMaterial({ color: 0x2b374d, roughness: 0.4, metalness: 0.6 });
    matChairSeat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.7 });
    matBookshelf = new THREE.MeshStandardMaterial({ color: 0x8a5528, roughness: 0.75 });
    matChalkboard = new THREE.MeshStandardMaterial({ color: 0x1b4d32, roughness: 0.9 });
    matBeaconBody = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.25, metalness: 0.8 });
    matPorticoColumn = new THREE.MeshStandardMaterial({ color: 0xf3ede2, roughness: 0.6 });
    matDoorFrame = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4, metalness: 0.5 });
    matGlassWindow = new THREE.MeshStandardMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.2,
      roughness: 0.05,
      side: THREE.DoubleSide
    });
  }

  function addBox(parent, x, y, z, w, h, d, mat) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /* ── Build School Campus Building & Landscaping ────────────────────────── */
  function buildCampusBuilding() {
    var grp = new THREE.Group();
    scene.add(grp);

    // 1. Expansive lush grass campus grounds
    var grassGeo = new THREE.PlaneGeometry(84, 64);
    var grass = new THREE.Mesh(grassGeo, matGrass);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(24, -0.15, 15);
    grass.receiveShadow = true;
    grp.add(grass);

    // 2. Front entrance plaza & driveway
    var plazaGeo = new THREE.PlaneGeometry(26, 14);
    var plaza = new THREE.Mesh(plazaGeo, matPlazaPavement);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(24, -0.08, 36);
    plaza.receiveShadow = true;
    grp.add(plaza);

    // 3. Perimeter walkway and curbs
    var curbMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.7 });
    addBox(grp, 24, 0.05, 43, 26.2, 0.15, 0.3, curbMat);
    addBox(grp, 10.9, 0.05, 36, 0.3, 0.15, 14, curbMat);
    addBox(grp, 37.1, 0.05, 36, 0.3, 0.15, 14, curbMat);

    // 4. Main building base foundation slab
    var slabGeo = new THREE.BoxGeometry(SCHOOL.width + 0.8, 0.2, SCHOOL.depth + 0.8);
    var slabMat = new THREE.MeshStandardMaterial({ color: 0x78432a, roughness: 0.7 }); // Terracotta plinth
    var slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(SCHOOL.width / 2, -0.05, SCHOOL.depth / 2);
    slab.receiveShadow = true;
    grp.add(slab);

    // 5. Individual room floors with accurate, realistic materials
    SCHOOL_ROOMS.forEach(function(room) {
      var rw = room.x2 - room.x1, rd = room.z2 - room.z1;
      var mat = room.type === 'corridor' ? matFloorCorridor :
                room.type === 'library'  ? matFloorLibrary  : matFloorClassroom;
      var floor = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.05, rd), mat);
      floor.position.set(room.x1 + rw / 2, 0.02, room.z1 + rd / 2);
      floor.receiveShadow = true;
      grp.add(floor);

      // Room nameplate on the floor for clear overview perspective
      if (room.type !== 'corridor') {
        var labelTex = makeTextTex(room.name, 512, 128, 32, '#0f172a', '#ffffffcc');
        var labelMat = new THREE.MeshBasicMaterial({
          map: labelTex,
          transparent: true,
          opacity: 0.88,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        var labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(rw - 0.6, 3.8), 0.8), labelMat);
        labelMesh.rotation.x = -Math.PI / 2;
        labelMesh.position.set(room.x1 + rw / 2, 0.06, room.z1 + rd / 2);
        labelMesh.userData = { roomId: room.id };
        grp.add(labelMesh);
      }
    });

    // 6. Walls (Interior & Exterior)
    SCHOOL_WALLS.forEach(function(wp) {
      var w = wp.x2 - wp.x1, d = wp.z2 - wp.z1;
      var isOuter = (wp.z1 <= 0.1 || wp.z2 >= SCHOOL.depth - 0.1 || wp.x1 <= 0.1 || wp.x2 >= SCHOOL.width - 0.1);
      var mat = isOuter ? matExteriorWall : matInteriorWall;
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, SCHOOL.wallH, d), mat);
      mesh.position.set((wp.x1 + wp.x2) / 2, SCHOOL.wallH / 2, (wp.z1 + wp.z2) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      grp.add(mesh);
    });

    // 7. Door Lintels & Framed Glass Doors
    SCHOOL_DOOR_OPENINGS.forEach(function(d) {
      var dw = d.x2 - d.x1, dd = d.z2 - d.z1;
      var lintelH = SCHOOL.wallH - 2.3;
      var dim = dw > dd ? [dw, dd] : [dd, dw];
      var lintel = new THREE.Mesh(new THREE.BoxGeometry(dim[0] + 0.01, lintelH, dim[1] + SCHOOL.wallT), matInteriorWall);
      lintel.position.set((d.x1 + d.x2) / 2, 2.3 + lintelH / 2, (d.z1 + d.z2) / 2);
      grp.add(lintel);

      // Door frame
      var frameW = new THREE.Mesh(new THREE.BoxGeometry(dim[0], 2.3, 0.06), matDoorFrame);
      frameW.position.set((d.x1 + d.x2) / 2, 1.15, (d.z1 + d.z2) / 2);
      // Double glass door pane with push-bars
      var pane = new THREE.Mesh(new THREE.PlaneGeometry(dim[0] - 0.1, 2.2), matGlassWindow);
      pane.position.set((d.x1 + d.x2) / 2, 1.15, (d.z1 + d.z2) / 2);
      if (dw < dd) pane.rotation.y = Math.PI / 2;
      grp.add(pane);
    });

    // 8. Classroom Signboards above every doorway
    var roomSignConfigs = [
      { id: '10A', name: 'CLASS 10-A', bcn: 'BCN-10A', x: 4,  z: 10.15 },
      { id: '10B', name: 'CLASS 10-B', bcn: 'BCN-10B', x: 12, z: 10.15 },
      { id: '10C', name: 'CLASS 10-C', bcn: 'BCN-10C', x: 20, z: 10.15 },
      { id: '9A',  name: 'CLASS 9-A',  bcn: 'BCN-9A',  x: 28, z: 10.15 },
      { id: '9B',  name: 'CLASS 9-B',  bcn: 'BCN-9B',  x: 36, z: 10.15 },
      { id: '9C',  name: 'CLASS 9-C',  bcn: 'BCN-9C',  x: 44, z: 10.15 },
      { id: 'LIB', name: 'LIBRARY & MEDIA', bcn: 'BCN-LIB', x: 8,  z: 13.85 },
      { id: 'REC', name: 'ADMIN & RECEPTION', bcn: 'BCN-REC', x: 26, z: 13.85 },
      { id: 'LAB', name: 'COMPUTER LAB', bcn: 'BCN-LAB', x: 44, z: 13.85 }
    ];

    roomSignConfigs.forEach(function(cfg) {
      // Signboard plaque
      var signPlaque = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.42, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.4 })
      );
      signPlaque.position.set(cfg.x, 2.65, cfg.z);
      grp.add(signPlaque);

      // Signboard text texture
      var signTex = canvasTex(512, 128, function(g, w, h) {
        g.fillStyle = '#0f172a'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#10b981'; g.lineWidth = 6;
        g.strokeRect(4, 4, w - 8, h - 8);
        g.fillStyle = '#ffffff';
        g.font = '800 38px "Inter",sans-serif';
        g.textAlign = 'center';
        g.fillText(cfg.name, w / 2, 54);
        g.fillStyle = '#34d399';
        g.font = '700 24px "JetBrains Mono",monospace';
        g.fillText('📡 ' + cfg.bcn, w / 2, 96);
      });
      var signMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide });
      var signMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.38), signMat);
      signMesh.position.set(cfg.x, 2.65, cfg.z + (cfg.z < 12 ? 0.035 : -0.035));
      if (cfg.z > 12) signMesh.rotation.y = Math.PI;
      grp.add(signMesh);
    });

    // 9. Grand Entrance Portico & Pillars at z = 30 (South Main Entrance)
    var porticoX = 24, porticoZ = 31.8;
    // 4 Classical Columns
    [-2.6, -0.9, 0.9, 2.6].forEach(function(offset) {
      var col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 3.6, 24), matPorticoColumn);
      col.position.set(porticoX + offset, 1.8, porticoZ);
      col.castShadow = true;
      grp.add(col);
      // Pillar base & capital
      addBox(grp, porticoX + offset, 0.12, porticoZ, 0.6, 0.24, 0.6, matPorticoColumn);
      addBox(grp, porticoX + offset, 3.55, porticoZ, 0.6, 0.24, 0.6, matPorticoColumn);
    });

    // Portico Roof Canopy / Pediment
    var canopy = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.35, 3.6), matExteriorWall);
    canopy.position.set(porticoX, 3.8, porticoZ - 0.8);
    canopy.castShadow = true;
    grp.add(canopy);

    // Grand School Name Board
    var schoolBoardTex = canvasTex(1024, 256, function(g, w, h) {
      g.fillStyle = '#064e3b'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#facc15'; g.lineWidth = 10;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#fef08a';
      g.font = '900 52px "Inter",sans-serif';
      g.textAlign = 'center';
      g.fillText('GREENFIELD SMART ACADEMY', w / 2, 90);
      g.fillStyle = '#a7f3d0';
      g.font = '600 32px "Inter",sans-serif';
      g.fillText('3D BLE Beacon Indoor Tracking & Digital Twin Campus', w / 2, 160);
      g.fillStyle = '#6ee7b7';
      g.font = '700 22px "JetBrains Mono",monospace';
      g.fillText('Classrooms 10-A/B/C · 9-A/B/C · Central Library', w / 2, 215);
    });
    var sbMat = new THREE.MeshBasicMaterial({ map: schoolBoardTex, side: THREE.DoubleSide });
    var sbMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.4), sbMat);
    sbMesh.position.set(porticoX, 4.75, porticoZ - 0.7);
    grp.add(sbMesh);

    // Decorative balustrade / parapet on building roof
    addBox(grp, porticoX, 4.05, porticoZ + 0.9, 7.2, 0.3, 0.2, matPorticoColumn);

    // 10. Landscaping: 3D Trees with Trunks and Multi-Layer Leafy Canopies
    var treePositions = [
      { x: -5,  z: 4 },  { x: -5,  z: 16 }, { x: -5,  z: 26 },
      { x: 53,  z: 4 },  { x: 53,  z: 16 }, { x: 53,  z: 26 },
      { x: 8,   z: 41 }, { x: 40,  z: 41 }
    ];

    var trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3219, roughness: 0.9 });
    var leafColors = [0x2d6a36, 0x3d8548, 0x4d9e5b];

    treePositions.forEach(function(pos, idx) {
      var treeGrp = new THREE.Group();
      treeGrp.position.set(pos.x, 0, pos.z);

      // Trunk
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 2.6, 8), trunkMat);
      trunk.position.y = 1.3;
      trunk.castShadow = true;
      treeGrp.add(trunk);

      // Multi-layer organic foliage canopy
      for (var layer = 0; layer < 3; layer++) {
        var r = 1.5 - layer * 0.25;
        var leafMat = new THREE.MeshStandardMaterial({
          color: leafColors[(idx + layer) % leafColors.length],
          roughness: 0.85
        });
        var canopySphere = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), leafMat);
        canopySphere.position.y = 2.4 + layer * 0.9;
        canopySphere.rotation.y = (idx * 0.7 + layer);
        canopySphere.castShadow = true;
        treeGrp.add(canopySphere);
      }

      grp.add(treeGrp);
      treeMeshes.push(treeGrp);
    });

    // 11. Flower beds & hedges
    var hedgeMat = new THREE.MeshStandardMaterial({ color: 0x22542a, roughness: 0.9 });
    var flowerColors = [0xec4899, 0xf59e0b, 0xf43f5e, 0x8b5cf6];

    [
      { x: 16, z: 30.8, w: 9 },
      { x: 32, z: 30.8, w: 9 }
    ].forEach(function(hb, hidx) {
      addBox(grp, hb.x, 0.25, hb.z, hb.w, 0.45, 0.8, hedgeMat);
      // Little blooms
      for (var f = 0; f < 8; f++) {
        var flMat = new THREE.MeshStandardMaterial({
          color: flowerColors[(hidx * 4 + f) % flowerColors.length],
          roughness: 0.6
        });
        var fl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), flMat);
        fl.position.set(hb.x - hb.w/2 + 0.6 + f * (hb.w - 1.2)/7, 0.52, hb.z + (Math.random() - 0.5)*0.3);
        grp.add(fl);
      }
    });

    // 12. Modern campus lamp posts along the entrance
    [
      { x: 14, z: 38 },
      { x: 34, z: 38 }
    ].forEach(function(lp) {
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8), matChairMetal);
      post.position.set(lp.x, 1.6, lp.z);
      grp.add(post);

      var globe = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xfffae0, emissive: 0xfffae0, emissiveIntensity: 1.5 })
      );
      globe.position.set(lp.x, 3.25, lp.z);
      grp.add(globe);

      var pl = new THREE.PointLight(0xfff3cc, 0.8, 8);
      pl.position.set(lp.x, 3.2, lp.z);
      grp.add(pl);
    });

    // 13. Classroom windows on outer north wall (Z = 0)
    SCHOOL_ROOMS.forEach(function(room) {
      if (room.type !== 'classroom') return;
      var rw = room.x2 - room.x1;
      var winW = rw - 1.2;
      var win = new THREE.Mesh(new THREE.PlaneGeometry(winW, 1.3), matGlassWindow);
      win.position.set(room.x1 + rw / 2, 1.8, 0.12);
      grp.add(win);

      var frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
      var fhTop = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.1, 0.08, 0.06), frameMat);
      fhTop.position.set(room.x1 + rw / 2, 1.8 + 0.65, 0.11);
      grp.add(fhTop);
      var fhBot = fhTop.clone();
      fhBot.position.y = 1.8 - 0.65;
      grp.add(fhBot);
    });

    // 14. Ceiling troffers (recessed LED panels) in classrooms
    SCHOOL_ROOMS.forEach(function(room) {
      if (room.type === 'corridor') return;
      var rw = room.x2 - room.x1, rd = room.z2 - room.z1;
      // Main ceiling slab
      var ceil = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.1, 0.08, rd - 0.1), matCeiling);
      ceil.position.set(room.x1 + rw / 2, SCHOOL.wallH - 0.04, room.z1 + rd / 2);
      grp.add(ceil);

      // 4 recessed LED troffers per room
      var ledPanelMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.7
      });
      [
        [room.x1 + rw * 0.3, room.z1 + rd * 0.35],
        [room.x1 + rw * 0.7, room.z1 + rd * 0.35],
        [room.x1 + rw * 0.3, room.z1 + rd * 0.7],
        [room.x1 + rw * 0.7, room.z1 + rd * 0.7]
      ].forEach(function(pt) {
        var troffer = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), ledPanelMat);
        troffer.rotation.x = Math.PI / 2;
        troffer.position.set(pt[0], SCHOOL.wallH - 0.08, pt[1]);
        grp.add(troffer);
      });
    });
  }

  /* ── Build Interior Furniture ─────────────────────────────────────────── */
  function buildFurniture() {
    var grp = new THREE.Group();
    scene.add(grp);

    SCHOOL_ROOMS.forEach(function(room) {
      if (room.type === 'classroom') {
        buildClassroomFurniture(grp, room);
      } else if (room.type === 'library') {
        buildLibraryFurniture(grp, room);
      } else if (room.id === 'REC') {
        buildReceptionFurniture(grp, room);
      }
    });
  }

  function buildClassroomFurniture(grp, room) {
    var rw = room.x2 - room.x1;
    var cx = room.x1 + rw / 2;

    // Chalkboard with chalk diagrams
    var boardTex = canvasTex(1024, 256, function(g, w, h) {
      g.fillStyle = '#174029'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#dcfce7'; g.lineWidth = 2;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = '#ffffff';
      g.font = '700 36px "Inter",sans-serif';
      g.fillText(room.name + '  ·  Period 1 Attendance Active', 30, 60);
      g.fillStyle = '#a7f3d0';
      g.font = '400 24px "Inter",sans-serif';
      g.fillText('Subject: Mathematics (Algebra & Geometry)', 30, 110);
      g.fillText('BLE Beacon: ' + room.beaconId + '  |  Face Verification Enabled', 30, 155);
      // Math formula
      g.fillStyle = '#fef08a';
      g.font = '600 26px "JetBrains Mono",monospace';
      g.fillText('f(x) = ax² + bx + c   |   RSSI = P₀ - 10n log₁₀(d)', 30, 210);
    });
    var boardMat = new THREE.MeshBasicMaterial({ map: boardTex });
    var board = new THREE.Mesh(new THREE.PlaneGeometry(rw - 1.4, 1.2), boardMat);
    board.position.set(cx, 1.8, room.z1 + 0.08);
    grp.add(board);

    // Board wood frame
    addBox(grp, cx, 1.8, room.z1 + 0.05, rw - 1.3, 1.28, 0.05, matBookshelf);

    // Teacher Desk
    addBox(grp, cx, 0.40, room.z1 + 1.3, 2.0, 0.06, 0.8, matDeskWood);
    addBox(grp, cx - 0.9, 0.20, room.z1 + 1.3, 0.06, 0.38, 0.7, matDeskWood);
    addBox(grp, cx + 0.9, 0.20, room.z1 + 1.3, 0.06, 0.38, 0.7, matDeskWood);
    // Teacher Laptop on desk
    var laptopMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.3, metalness: 0.7 });
    addBox(grp, cx, 0.44, room.z1 + 1.3, 0.38, 0.02, 0.26, laptopMat);
    var screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.24, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x10b981 })
    );
    screen.position.set(cx, 0.55, room.z1 + 1.18);
    screen.rotation.x = 0.25;
    grp.add(screen);

    // Student Desks & Chairs: 5 rows × 4 columns = 20 seats
    var cols = 4, rows = 5;
    var startX = room.x1 + 0.9;
    var stepX = (rw - 1.8) / (cols - 1);
    var startZ = room.z1 + 2.5;
    var stepZ = (room.z2 - room.z1 - 3.5) / (rows - 1);

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var dx = startX + c * stepX, dz = startZ + r * stepZ;
        // Desk Top
        addBox(grp, dx, 0.40, dz, 0.95, 0.05, 0.6, matDeskWood);
        // Desk Legs (metal tube)
        [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]].forEach(function(off) {
          addBox(grp, dx + off[0], 0.20, dz + off[1], 0.04, 0.38, 0.04, matChairMetal);
        });
        // Chair
        var cz = dz + 0.52;
        // Seat pan
        addBox(grp, dx, 0.23, cz, 0.46, 0.04, 0.44, matChairSeat);
        // Backrest
        addBox(grp, dx, 0.56, cz + 0.18, 0.44, 0.38, 0.04, matChairSeat);
        // Chair legs
        [[-0.18, -0.16], [0.18, -0.16], [-0.18, 0.16], [0.18, 0.16]].forEach(function(off) {
          addBox(grp, dx + off[0], 0.11, cz + off[1], 0.03, 0.22, 0.03, matChairMetal);
        });
      }
    }
  }

  function buildLibraryFurniture(grp, room) {
    // Bookshelves along walls filled with colorful book spines
    for (var s = 0; s < 4; s++) {
      var sz = room.z1 + 3.2 + s * 4.2;
      // Left shelf
      addBox(grp, room.x1 + 1.2, 0.9, sz, 2.2, 1.7, 0.45, matBookshelf);
      // Right shelf
      addBox(grp, room.x2 - 1.2, 0.9, sz, 2.2, 1.7, 0.45, matBookshelf);

      // Book rows
      var bookCols = [0x991b1b, 0x1e40af, 0x166534, 0x854d0e, 0x581c87];
      for (var b = 0; b < 4; b++) {
        var by = 0.25 + b * 0.42;
        var bMat = new THREE.MeshStandardMaterial({ color: bookCols[(s + b) % bookCols.length], roughness: 0.8 });
        addBox(grp, room.x1 + 1.2, by, sz, 1.9, 0.32, 0.36, bMat);
        addBox(grp, room.x2 - 1.2, by, sz, 1.9, 0.32, 0.36, bMat);
      }
    }

    // Large Reading Tables
    for (var t = 0; t < 3; t++) {
      var tx = room.x1 + 4.5 + t * 5.2, tz = room.z1 + 5.5;
      addBox(grp, tx, 0.40, tz, 2.4, 0.06, 1.1, matDeskWood);
      // Study Lamp with warm glow
      var lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35), matChairMetal);
      lampPost.position.set(tx, 0.58, tz);
      grp.add(lampPost);
      var lampShade = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.14, 16),
        new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.4 })
      );
      lampShade.position.set(tx, 0.72, tz);
      grp.add(lampShade);

      // Study chairs around reading table
      for (var s2 = 0; s2 < 2; s2++) {
        addBox(grp, tx - 0.6 + s2 * 1.2, 0.23, tz + 0.72, 0.44, 0.04, 0.44, matChairSeat);
        addBox(grp, tx - 0.6 + s2 * 1.2, 0.23, tz - 0.72, 0.44, 0.04, 0.44, matChairSeat);
      }
    }

    for (var t2 = 0; t2 < 3; t2++) {
      var tx2 = room.x1 + 4.5 + t2 * 5.2, tz2 = room.z1 + 10.5;
      addBox(grp, tx2, 0.40, tz2, 2.4, 0.06, 1.1, matDeskWood);
      for (var s3 = 0; s3 < 2; s3++) {
        addBox(grp, tx2 - 0.6 + s3 * 1.2, 0.23, tz2 + 0.72, 0.44, 0.04, 0.44, matChairSeat);
      }
    }

    // Librarian Front Desk
    addBox(grp, room.x1 + 4, 0.48, room.z1 + 1.8, 3.2, 0.95, 0.8, matBookshelf);
  }

  function buildReceptionFurniture(grp, room) {
    addBox(grp, room.x1 + 3.2, 0.48, room.z1 + 2.2, 3.4, 0.95, 0.85, matBookshelf);
    addBox(grp, room.x1 + 5.2, 0.23, room.z1 + 3.2, 0.44, 0.04, 0.44, matChairSeat);
  }

  /* ── Detailed Realistic Student Avatars with Clear Faces ───────────────── */
  function buildStudentAvatars() {
    var grp = new THREE.Group();
    scene.add(grp);

    function makeAvatar(s, x, z, isLibrary) {
      var av = new THREE.Group();
      av.position.set(x, 0, z);

      // 1. Lower Body: Dark Navy Trousers or Skirt (Seated pose)
      var pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
      var shoeMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.35, metalness: 0.2 });
      var skinMat = new THREE.MeshStandardMaterial({ color: s.skinTone || 0xecd0b8, roughness: 0.75 });

      // Thighs (extending forward towards desk)
      var thighs = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.34), pantsMat);
      thighs.position.set(0, 0.24, -0.08);
      av.add(thighs);

      // Lower legs (hanging down from chair edge to floor)
      var legL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.22, 10), pantsMat);
      legL.position.set(-0.10, 0.11, -0.23);
      av.add(legL);
      var legR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.22, 10), pantsMat);
      legR.position.set(0.10, 0.11, -0.23);
      av.add(legR);

      // Shoes on the floor
      var shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.16), shoeMat);
      shoeL.position.set(-0.10, 0.03, -0.25);
      av.add(shoeL);
      var shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.16), shoeMat);
      shoeR.position.set(0.10, 0.03, -0.25);
      av.add(shoeR);

      // 2. Upper Body: School Uniform Shirt/Blouse with Collar & Tie
      var shirtColor = isLibrary ? 0xecfdf5 : 0xf8fafc; // Crisp white uniform shirt
      var shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.75 });
      var torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.22), shirtMat);
      torso.position.set(0, 0.48, 0);
      torso.castShadow = true;
      av.add(torso);

      // Necktie (Navy Blue / Emerald)
      var tieMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.6 });
      var tie = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.02), tieMat);
      tie.position.set(0, 0.49, -0.115);
      av.add(tie);

      // School Badge on chest pocket
      var badgeMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      var badge = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.04), badgeMat);
      badge.position.set(0.11, 0.54, -0.112);
      av.add(badge);

      // 3. Natural Seated Arms resting forward on the desk
      var armMat = shirtMat;
      // Left arm
      var armL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 8), armMat);
      armL.position.set(-0.21, 0.42, -0.10);
      armL.rotation.x = -Math.PI / 4;
      av.add(armL);
      // Left hand on desk
      var handL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), skinMat);
      handL.position.set(-0.21, 0.38, -0.24);
      av.add(handL);

      // Right arm (holding smart device)
      var armR = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 8), armMat);
      armR.position.set(0.21, 0.42, -0.10);
      armR.rotation.x = -Math.PI / 4;
      av.add(armR);
      var handR = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), skinMat);
      handR.position.set(0.21, 0.38, -0.24);
      av.add(handR);

      // Smartphone on desk (BLE tracking receiver)
      var phoneMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.8 });
      var phone = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.008, 0.12), phoneMat);
      phone.position.set(0.14, 0.41, -0.26);
      av.add(phone);
      var screenMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 0.6 });
      var phoneScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.11), screenMat);
      phoneScreen.rotation.x = -Math.PI / 2;
      phoneScreen.position.set(0.14, 0.415, -0.26);
      av.add(phoneScreen);

      // 4. Neck
      var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.09, 12), skinMat);
      neck.position.set(0, 0.68, 0);
      av.add(neck);

      // 5. Head with Procedural High-Res Canvas Face Texture
      var headRadius = 0.125;
      var faceObj = createStudentFaceTexture(s);
      var headMat = new THREE.MeshStandardMaterial({
        map: faceObj.texture,
        roughness: 0.7,
        metalness: 0.05
      });
      // Cylinder or sphere head with face aligned to -Z (looking towards front of classroom / teacher)
      var head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 24, 24), headMat);
      head.position.set(0, 0.82, 0);
      head.rotation.y = -Math.PI / 2; // Orient texture towards front (-Z)
      head.castShadow = true;
      av.add(head);

      // 6. Styled 3D Hair Mesh
      var hairMat = new THREE.MeshStandardMaterial({
        color: s.hairColor || 0x1e1815,
        roughness: 0.9
      });
      var hairGrp = new THREE.Group();
      hairGrp.position.set(0, 0.83, 0);

      if (s.gender === 'f') {
        // Girls: Ponytail or Bob cut
        var hairCap = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 1.05, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
        hairGrp.add(hairCap);
        if (s.hairStyle === 'ponytail') {
          var pony = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.22, 10), hairMat);
          pony.position.set(0, 0.02, 0.14);
          pony.rotation.x = 0.4;
          hairGrp.add(pony);
          // Ribbon
          var ribbon = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.015, 8, 16), new THREE.MeshStandardMaterial({ color: 0xef4444 }));
          ribbon.position.set(0, 0.08, 0.12);
          hairGrp.add(ribbon);
        } else {
          // Bob / Shoulder length sides
          var sideL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.18), hairMat);
          sideL.position.set(-0.11, -0.04, 0.02);
          hairGrp.add(sideL);
          var sideR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.18), hairMat);
          sideR.position.set(0.11, -0.04, 0.02);
          hairGrp.add(sideR);
        }
      } else {
        // Boys: Parted hair or crew cut
        var boyHair = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 1.04, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.48), hairMat);
        boyHair.position.y = 0.01;
        hairGrp.add(boyHair);
        var fringe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.06), hairMat);
        fringe.position.set(0, 0.07, -0.10);
        hairGrp.add(fringe);
      }
      av.add(hairGrp);

      // 7. Subtle Signal Status Ring on the floor around student
      var ringGeo = new THREE.RingGeometry(0.24, 0.32, 32);
      var ringMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      var ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      av.add(ring);

      // 8. Overhead Name Label
      var nameTex = makeTextTex(s.name, 512, 128, 30, '#ffffff', '#0f172acc');
      var nameMat = new THREE.MeshBasicMaterial({
        map: nameTex,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      var nameLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), nameMat);
      nameLabel.position.y = 1.15;
      av.add(nameLabel);

      // 9. Interactive Hitbox
      var hitMat = new THREE.MeshBasicMaterial({ visible: false });
      var hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.6), hitMat);
      hitbox.position.y = 0.6;
      hitbox.userData = { studentId: s.id, classId: s.classId };
      av.add(hitbox);

      av.userData = {
        studentId: s.id,
        classId: s.classId,
        ring: ring,
        nameLabel: nameLabel,
        head: head
      };

      grp.add(av);

      studentMeshes[s.id] = {
        group: av,
        ring: ring,
        nameLabel: nameLabel,
        hitbox: hitbox,
        head: head,
        torso: torso,
        faceCanvas: faceObj.canvas,
        faceCtx: faceObj.ctx,
        faceTex: faceObj.texture,
        studentData: s,
        blinkTimer: Math.random() * 4,
        isBlinking: false
      };
    }

    // Classroom students (20 per class × 6 classes = 120 students)
    ['10A', '10B', '10C', '9A', '9B', '9C'].forEach(function(classId) {
      var room = SCHOOL_ROOMS.find(function(r) { return r.id === classId; });
      if (!room) return;
      var students = SCHOOL_STUDENTS[classId] || [];
      var rw = room.x2 - room.x1;
      var cols = 4;
      var startX = room.x1 + 0.9, stepX = (rw - 1.8) / 3;
      var startZ = room.z1 + 2.5, stepZ = (room.z2 - room.z1 - 3.5) / 4;

      students.forEach(function(s, i) {
        var col = i % cols, row = Math.floor(i / cols);
        if (row >= 5) return;
        var sx = startX + col * stepX;
        var sz = startZ + row * stepZ + 0.52; // Sitting right at the chair!
        makeAvatar(s, sx, sz, false);
      });
    });

    // Library Occupants
    var libRoom = SCHOOL_ROOMS.find(function(r) { return r.id === 'LIB'; });
    if (libRoom) {
      var libStudents = SCHOOL_STUDENTS['LIB'] || [];
      var tableXs = [libRoom.x1 + 4.5, libRoom.x1 + 9.7, libRoom.x1 + 14.9];
      var tableZs = [libRoom.z1 + 5.5, libRoom.z1 + 10.5];

      libStudents.forEach(function(s, i) {
        var ti = Math.floor(i / 2), seat = i % 2;
        var tx = tableXs[ti % 3], tz = tableZs[Math.floor(ti / 3) % 2];
        makeAvatar(s, tx - 0.6 + seat * 1.2, tz + 0.72, true);
      });
    }
  }

  /* ── Dedicated Classroom & Library Beacons ─────────────────────────────── */
  function buildBeacons() {
    SCHOOL_BEACONS.forEach(function(b) {
      var grp2 = new THREE.Group();
      grp2.position.set(b.x, SCHOOL.wallH - 0.12, b.z);

      // Body disc
      var bodyMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 24), matBeaconBody);
      bodyMesh.castShadow = true;
      grp2.add(bodyMesh);

      // High-intensity LED indicator
      var ledMat = new THREE.MeshStandardMaterial({
        color: b.color,
        emissive: b.color,
        emissiveIntensity: 2.2
      });
      var led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), ledMat);
      led.position.y = -0.04;
      grp2.add(led);

      // Ceiling mounting bracket
      var mount = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), matDoorFrame);
      mount.position.y = 0.08;
      grp2.add(mount);

      // Concentric expanding transmission rings
      var rings = [];
      for (var ri = 0; ri < 4; ri++) {
        var rGeo = new THREE.RingGeometry(0.2, 0.28, 32);
        var rCol = new THREE.Color(b.color);
        var rMat = new THREE.MeshBasicMaterial({
          color: rCol,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        var ring = new THREE.Mesh(rGeo, rMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.06;
        ring._phase = ri / 4;
        grp2.add(ring);
        rings.push(ring);
      }

      // Point Light
      var ptLight = new THREE.PointLight(b.color, 0.6, 7);
      ptLight.position.y = -0.15;
      grp2.add(ptLight);

      // Floor coverage glow
      var glowGeo = new THREE.CircleGeometry(3.6, 32);
      var glowCol = new THREE.Color(b.color);
      var glowMat = new THREE.MeshBasicMaterial({
        color: glowCol,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      var glow = new THREE.Mesh(glowGeo, glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(b.x, 0.025, b.z);
      scene.add(glow);

      // Beacon ID signboard
      var labelTex = makeTextTex(b.id, 256, 64, 22, '#ffffff', '#' + b.color.toString(16).padStart(6, '0'));
      var labelMat = new THREE.MeshBasicMaterial({
        map: labelTex,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide
      });
      var labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), labelMat);
      labelMesh.position.set(b.x, SCHOOL.wallH - 0.45, b.z);
      scene.add(labelMesh);

      scene.add(grp2);
      beaconViews[b.id] = {
        group: grp2,
        rings: rings,
        led: led,
        ledMat: ledMat,
        ptLight: ptLight,
        glow: glow,
        glowMat: glowMat,
        labelMesh: labelMesh
      };
    });
  }

  /* ── Lighting & Atmosphere ──────────────────────────────────────────────── */
  function buildLights() {
    // Natural hemisphere daylight (sky blue + ground reflection)
    hemiLight = new THREE.HemisphereLight(0xebf5fb, 0x475569, 0.85);
    scene.add(hemiLight);

    // Warm Sun Directional Light with soft PCF shadows
    dirLight = new THREE.DirectionalLight(0xfffaec, 1.25);
    dirLight.position.set(24, 38, -12);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.left = -40;
    dirLight.shadow.camera.right = 40;
    dirLight.shadow.camera.top = 40;
    dirLight.shadow.camera.bottom = -40;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 100;
    dirLight.shadow.bias = -0.0004;
    scene.add(dirLight);

    // Balanced Room Fill Lights
    SCHOOL_ROOMS.forEach(function(room) {
      if (room.type === 'corridor') return;
      var pl = new THREE.PointLight(0xfff7ea, 0.55, 15);
      pl.position.set(room.x1 + (room.x2 - room.x1) / 2, SCHOOL.wallH - 0.35, room.z1 + (room.z2 - room.z1) / 2);
      scene.add(pl);
    });
  }

  /* ── Circular Sleek Crosshair (No ugly plus sign!) ──────────────────────── */
  var crosshairEl = null;
  function createCrosshair(h) {
    crosshairEl = document.createElement('div');
    crosshairEl.id = 'crosshair';
    crosshairEl.style.cssText =
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'width:12px;height:12px;border:2px solid rgba(255,255,255,0.85);' +
      'border-radius:50%;background:rgba(16,185,129,0.3);box-shadow:0 0 8px rgba(16,185,129,0.5);' +
      'pointer-events:none;display:none;';
    h.appendChild(crosshairEl);
  }

  /* ── Camera Modes & Transitions ─────────────────────────────────────────── */
  function enterOverview() {
    mode = 'overview';
    controls.enabled = true;
    startCameraTransition(
      new THREE.Vector3(SCHOOL.width / 2, 26, SCHOOL.depth + 14),
      new THREE.Vector3(SCHOOL.width / 2, 0, SCHOOL.depth / 2),
      0.8
    );
    if (document.pointerLockElement) document.exitPointerLock();
    if (crosshairEl) crosshairEl.style.display = 'none';

    var hint = document.getElementById('view-hint');
    if (hint) hint.textContent = 'Drag to orbit · Scroll to zoom · Click room to enter · Click student to zoom face';
    var enterBtn = document.getElementById('enter-fps-btn');
    if (enterBtn) { enterBtn.textContent = '🚶 Walk School (FPS)'; enterBtn.style.display = 'inline-flex'; }
    if (SchoolScene.onModeChange) SchoolScene.onModeChange('overview');
  }

  function enterFPS(spawnId) {
    var spawn = ROOM_SPAWN[spawnId || 'CORR'] || ROOM_SPAWN['CORR'];
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = spawn.yaw || 0;
    player.pitch = 0;
    mode = 'fps';
    controls.enabled = false;
    camera.position.set(player.x, EYE_HEIGHT, player.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = 0;

    if (crosshairEl) crosshairEl.style.display = 'block';
    var hint = document.getElementById('view-hint');
    if (hint) hint.textContent = 'WASD to walk · Mouse to look · Click student to select · Esc to return';
    var enterBtn = document.getElementById('enter-fps-btn');
    if (enterBtn) { enterBtn.textContent = '🏫 Overview Mode'; enterBtn.style.display = 'inline-flex'; }

    renderer.domElement.requestPointerLock();
    if (SchoolScene.onModeChange) SchoolScene.onModeChange('fps');
  }

  // Smooth zoom directly to selected student's face & desk!
  function focusStudent(sid) {
    var sm = studentMeshes[sid];
    if (!sm) return;
    selectStudent(sid);

    mode = 'focus';
    controls.enabled = true;
    var targetHeadPos = sm.group.position.clone().add(new THREE.Vector3(0, 0.82, 0));
    var camPos = targetHeadPos.clone().add(new THREE.Vector3(0, 0.05, -0.65));

    startCameraTransition(camPos, targetHeadPos, 0.9, function() {
      controls.target.copy(targetHeadPos);
    });

    var hint = document.getElementById('view-hint');
    if (hint) hint.textContent = 'Viewing ' + sm.studentData.name + ' · Drag to orbit face · Scroll to zoom';
  }

  function startCameraTransition(targetPos, targetLook, duration, onComplete) {
    camAnim = {
      startPos: camera.position.clone(),
      targetPos: targetPos.clone(),
      startLook: controls.target.clone(),
      targetLook: targetLook.clone(),
      progress: 0,
      duration: duration || 0.8,
      onComplete: onComplete
    };
  }

  function updateCameraTransition(dt) {
    if (!camAnim) return;
    camAnim.progress += dt / camAnim.duration;
    var t = Math.min(camAnim.progress, 1);
    // Smooth easeInOutCubic
    var ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(camAnim.startPos, camAnim.targetPos, ease);
    controls.target.lerpVectors(camAnim.startLook, camAnim.targetLook, ease);
    camera.lookAt(controls.target);

    if (t >= 1) {
      if (camAnim.onComplete) camAnim.onComplete();
      camAnim = null;
    }
  }

  /* ── Selection ──────────────────────────────────────────────────────────── */
  function selectStudent(sid) {
    if (selectedStudentId && studentMeshes[selectedStudentId]) {
      studentMeshes[selectedStudentId].ring.material.color.setHex(0x10b981);
      studentMeshes[selectedStudentId].ring.material.opacity = 0.7;
      studentMeshes[selectedStudentId].ring.scale.set(1, 1, 1);
    }
    selectedStudentId = sid;
    if (sid && studentMeshes[sid]) {
      studentMeshes[sid].ring.material.color.setHex(0xfacc15); // Golden yellow
      studentMeshes[sid].ring.material.opacity = 1.0;
      studentMeshes[sid].ring.scale.set(1.2, 1.2, 1.2);
    }
    if (onStudentClick) onStudentClick(sid);
  }

  /* ── Input Handlers ─────────────────────────────────────────────────────── */
  function bindInput() {
    var sensitivity = 0.0018;

    document.addEventListener('pointerlockchange', function() {
      pointerLocked = (document.pointerLockElement === renderer.domElement);
      if (!pointerLocked && mode === 'fps') {
        enterOverview();
      }
    });

    document.addEventListener('mousemove', function(e) {
      if (!pointerLocked || mode !== 'fps') return;
      player.yaw   -= e.movementX * sensitivity;
      player.pitch  = clamp(player.pitch - e.movementY * sensitivity, -1.3, 1.3);
    });

    window.addEventListener('keydown', function(e) {
      var key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup')    keys.w = true;
      if (key === 's' || key === 'arrowdown')  keys.s = true;
      if (key === 'a' || key === 'arrowleft')  keys.a = true;
      if (key === 'd' || key === 'arrowright') keys.d = true;
      if (key === 'escape' && mode === 'fps')  enterOverview();
      if (key === 'f') {
        if (mode === 'overview') enterFPS('CORR');
        else enterOverview();
      }
    });

    window.addEventListener('keyup', function(e) {
      var key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup')    keys.w = false;
      if (key === 's' || key === 'arrowdown')  keys.s = false;
      if (key === 'a' || key === 'arrowleft')  keys.a = false;
      if (key === 'd' || key === 'arrowright') keys.d = false;
    });

    renderer.domElement.addEventListener('click', function(e) {
      if (mode === 'overview' || mode === 'focus') {
        handleSceneClick(e);
      } else if (mode === 'fps' && !pointerLocked) {
        renderer.domElement.requestPointerLock();
      } else if (mode === 'fps' && pointerLocked) {
        doFPSInteract();
      }
    });
  }

  function handleSceneClick(e) {
    var rect = renderer.domElement.getBoundingClientRect();
    var mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    var raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // 1. Check student hitboxes
    var studentHitboxes = [];
    Object.keys(studentMeshes).forEach(function(id) {
      if (studentMeshes[id].hitbox) studentHitboxes.push(studentMeshes[id].hitbox);
    });
    var studentHits = raycaster.intersectObjects(studentHitboxes, false);
    if (studentHits.length > 0) {
      var sid = studentHits[0].object.userData.studentId;
      focusStudent(sid);
      return;
    }

    // 2. Check room floorplates
    var intersects = raycaster.intersectObjects(scene.children, true);
    for (var i = 0; i < intersects.length; i++) {
      var obj = intersects[i].object;
      if (obj.userData && obj.userData.roomId) {
        enterFPS(obj.userData.roomId);
        return;
      }
    }
  }

  function doFPSInteract() {
    var raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = 3.2;
    var meshes = [];
    Object.keys(studentMeshes).forEach(function(id) {
      if (studentMeshes[id].hitbox) meshes.push(studentMeshes[id].hitbox);
    });
    var hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      var sid = hits[0].object.userData.studentId;
      selectStudent(sid);
    }
  }

  /* ── FPS Movement ───────────────────────────────────────────────────────── */
  function updateFPS(dt) {
    if (!pointerLocked) return;
    var speed = SIM.playerSpeed;
    var cos = Math.cos(player.yaw), sin = Math.sin(player.yaw);
    var fwdX = -sin, fwdZ = -cos;
    var rgtX = cos,  rgtZ = -sin;
    var dx = 0, dz = 0;

    if (keys.w) { dx += fwdX * speed * dt; dz += fwdZ * speed * dt; }
    if (keys.s) { dx -= fwdX * speed * dt; dz -= fwdZ * speed * dt; }
    if (keys.a) { dx -= rgtX * speed * dt; dz -= rgtZ * speed * dt; }
    if (keys.d) { dx += rgtX * speed * dt; dz += rgtZ * speed * dt; }

    if (dx !== 0 || dz !== 0) movePlayer(player, dx, dz);

    camera.position.set(player.x, EYE_HEIGHT, player.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
  }

  /* ── Animations: Blinking, Breathing, Beacons ───────────────────────────── */
  function updateStudentAnims(dt, t) {
    Object.keys(studentMeshes).forEach(function(sid) {
      var sm = studentMeshes[sid];
      if (!sm) return;

      // 1. Subtle breathing chest rise/fall
      if (sm.torso) {
        sm.torso.position.y = 0.48 + 0.005 * Math.sin(t * 2.5 + sid.charCodeAt(0));
      }

      // 2. Subtle periodic blinking (canvas eye redraw)
      sm.blinkTimer -= dt;
      if (sm.blinkTimer <= 0) {
        sm.isBlinking = !sm.isBlinking;
        drawStudentFace(sm.faceCtx, 512, 512, sm.studentData, sm.isBlinking);
        sm.faceTex.needsUpdate = true;
        // Keep blink closed for 0.14s, open for 3.5s - 5.5s
        sm.blinkTimer = sm.isBlinking ? 0.14 : (3.5 + Math.random() * 2.0);
      }

      // 3. Subtle signal ring pulse
      if (sm.ring && sid !== selectedStudentId) {
        var sc = 1 + 0.08 * Math.sin(t * 2.0 + sid.charCodeAt(sid.length - 1));
        sm.ring.scale.set(sc, sc, sc);
      }

      // 4. Billboard name label
      if (sm.nameLabel) {
        sm.nameLabel.lookAt(camera.position);
      }
    });
  }

  function updateBeaconAnims(t) {
    Object.keys(beaconViews).forEach(function(bid) {
      var bv = beaconViews[bid];
      bv.rings.forEach(function(ring) {
        var phase = ((t / 2.8) + ring._phase) % 1;
        var sc = 0.4 + phase * 6.5;
        ring.scale.set(sc, sc, sc);
        ring.material.opacity = Math.max(0, (1 - phase) * 0.6);
      });
      bv.ledMat.emissiveIntensity = 1.6 + 0.8 * Math.sin(t * 4);
      bv.ptLight.intensity = 0.55 + 0.25 * Math.sin(t * 2.5);
      bv.glowMat.opacity = 0.05 + 0.02 * Math.sin(t * 1.5);
      bv.labelMesh.lookAt(camera.position);
    });
  }

  function detectCurrentRoom() {
    var room = findSchoolRoom(player.x, player.z);
    if (room.id !== lastRoomId) {
      lastRoomId = room.id;
      if (onRoomChange) onRoomChange(room.id, room);
    }
  }

  /* ── Public Status Color API ────────────────────────────────────────────── */
  function setStudentSignalColor(studentId, color, opacity) {
    if (studentMeshes[studentId] && studentMeshes[studentId].ring) {
      if (studentId === selectedStudentId) return; // Keep yellow selection highlight
      studentMeshes[studentId].ring.material.color.setHex(color);
      studentMeshes[studentId].ring.material.opacity = opacity != null ? opacity : 0.75;
    }
  }

  /* ── Render Loop ────────────────────────────────────────────────────────── */
  function render(dt, t) {
    clock = t;
    fpsFrames++; fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      fpsVal = fpsFrames / fpsAccum;
      fpsFrames = 0; fpsAccum = 0;
    }

    if (camAnim) {
      updateCameraTransition(dt);
    } else if (mode === 'fps') {
      updateFPS(dt);
      detectCurrentRoom();
    } else {
      controls.update();
    }

    updateBeaconAnims(t);
    updateStudentAnims(dt, t);

    renderer.render(scene, camera);
  }

  /* ── Init ───────────────────────────────────────────────────────────────── */
  function init(h) {
    host = h;
    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(h.clientWidth, h.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    h.appendChild(renderer.domElement);
    maxAniso = renderer.capabilities.getMaxAnisotropy();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x93c5fd); // Natural daytime sky blue
    scene.fog = new THREE.Fog(0x93c5fd, 55, 110);

    camera = new THREE.PerspectiveCamera(70, h.clientWidth / h.clientHeight, 0.1, 140);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 80;
    controls.minDistance = 0.4;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent going below ground

    initMaterials();
    buildCampusBuilding();
    buildFurniture();
    buildStudentAvatars();
    buildBeacons();
    buildLights();
    createCrosshair(h);
    bindInput();
    enterOverview();

    window.addEventListener('resize', function() {
      if (!host || !renderer) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    });
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  return {
    init: init,
    render: render,
    enterFPS: enterFPS,
    enterOverview: enterOverview,
    focusStudent: focusStudent,
    selectStudent: selectStudent,
    setStudentSignalColor: setStudentSignalColor,
    startCameraTransition: startCameraTransition,
    getScene: function() { return scene; },
    getCamera: function() { return camera; },
    getControls: function() { return controls; },
    getHost: function() { return host; },
    getRenderer: function() { return renderer; },
    canvasTex: canvasTex,
    makeTextTex: makeTextTex,
    getCurrentRoom: function() { return findSchoolRoom(player.x, player.z); },
    getPlayer: function() { return player; },
    getFps: function() { return fpsVal; },
    getMode: function() { return mode; },
    onRoomChange: null,
    onStudentClick: null,
    onModeChange: null
  };
})();

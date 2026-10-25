/* =============================================================================
 * school-presenter.js  –  Interactive 3D Virtual Presenter & School Tour Guide
 *
 * Features:
 *   - Realistic 3D human presenter character (teacher / tour guide) with
 *     procedural detailed face texture, blinking eyes, speaking mouth,
 *     professional tailored blazer, academy lanyard badge, and articulated limbs.
 *   - Natural animations: walking (alternate leg/arm swings, vertical bobbing)
 *     and standing/explaining (breathing, gesturing towards rooms/beacons/students).
 *   - Connected, collision-free waypoint navigation through actual corridors & doors:
 *     The presenter physically walks from the entrance, along corridors, through
 *     each classroom doorway, stops, explains, and exits back to the corridor.
 *   - 16 Tour Stops covering every classroom (10A, 10B, 10C, 9A, 9B, 9C),
 *     Computer Lab, Library, BLE Signal Telemetry, Student Attendance App,
 *     Face Verification, Admin Dashboard, and Campus Overviews.
 *   - Interactive Tour Controls: Start, Pause, Resume, Next, Previous, Restart,
 *     Exit, Skip, Subtitles toggle, Voice-Over toggle (SpeechSynthesis),
 *     and Camera Follow / Free Orbit mode.
 *   - Welcome Screen modal with 4 quick-action launch options.
 * ========================================================================== */
'use strict';

var SchoolPresenter = (function() {

  /* ── Private State ─────────────────────────────────────────────────────── */
  var scene, camera, controls;
  var presenterGroup = null;
  var limbs = {}; // { legL, legR, armL, armR, head, torso, badge, tablet, faceCanvas, faceCtx, faceTex, auraRing }

  var currentStopIndex = 0;
  var tourActive = false;
  var tourPaused = false;
  var voiceEnabled = true;
  var subtitlesEnabled = true;
  var cameraFollowEnabled = true;

  // Navigation & Walking State
  var waypointsQueue = [];
  var currentWaypoint = null;
  var isWalking = false;
  var isExplaining = false;
  var walkPhase = 0;
  var walkSpeed = 2.4; // metres per second
  var currentPos = { x: 24, z: 34, y: 0 };
  var currentYaw = 0;
  var targetYaw = 0;

  var blinkTimer = 3.0;
  var isBlinking = false;
  var mouthOpen = 0;
  var speakingTimer = 0;

  var synth = window.speechSynthesis || null;
  var currentUtterance = null;

  /* ── 16 Detailed Tour Stops Specification ──────────────────────────────── */
  var TOUR_STOPS = [
    {
      id: 'entrance',
      title: 'Main School Entrance',
      badge: 'Stop 1 of 16 · Campus Welcome',
      pos: { x: 24, z: 34 },
      yaw: 0,
      camPos: { x: 24, y: 2.8, z: 38 },
      camLook: { x: 24, y: 1.3, z: 34 },
      roomId: 'CORR',
      beaconId: null,
      explanation: 'Welcome to Greenfield Smart Academy! I am your virtual tour guide. Today, we will explore our 3D Smart School Digital Twin, featuring automated BLE beacon indoor tracking, real-time student attendance, biometric face verification, and comprehensive administrative oversight.'
    },
    {
      id: 'overview',
      title: 'Campus Architecture & Landscaping',
      badge: 'Stop 2 of 16 · Campus Overview',
      pos: { x: 24, z: 32 },
      yaw: 0,
      camPos: { x: 24, y: 24, z: 46 },
      camLook: { x: 24, y: 1.5, z: 15 },
      roomId: 'CORR',
      beaconId: null,
      explanation: 'Our 3D campus spans 48 by 30 meters with lush manicured lawns, 3D landscaping trees, classical portico architecture, and 9 dedicated indoor zones accommodating 120 enrolled students with simulated Bluetooth Low Energy signal propagation.'
    },
    {
      id: 'corridor',
      title: 'Central Arterial Corridor',
      badge: 'Stop 3 of 16 · Main Hallway',
      pos: { x: 24, z: 12 },
      yaw: -Math.PI / 2,
      camPos: { x: 28, y: 2.2, z: 15.5 },
      camLook: { x: 23, y: 1.4, z: 12 },
      roomId: 'CORR',
      beaconId: null,
      explanation: 'We have now entered the central arterial corridor. This wide hallway connects all classrooms along the northern wing with the administration, library, and computer lab along the southern wing.'
    },
    {
      id: 'class10a',
      title: 'Class 10-A',
      badge: 'Stop 4 of 16 · Academic Wing',
      pos: { x: 4, z: 6.8 },
      yaw: Math.PI,
      camPos: { x: 4, y: 2.2, z: 9.8 },
      camLook: { x: 4, y: 1.1, z: 4.5 },
      roomId: '10A',
      beaconId: 'BCN-10A',
      classId: '10A',
      explanation: 'This is Class 10-A. Each student has a unique Student ID from 10A-S001 to 10A-S020. This classroom has its own dedicated BLE beacon overhead, BCN-10A. The system detects classroom-level proximity and helps validate attendance during the scheduled period.'
    },
    {
      id: 'class10b',
      title: 'Class 10-B',
      badge: 'Stop 5 of 16 · Academic Wing',
      pos: { x: 12, z: 6.8 },
      yaw: Math.PI,
      camPos: { x: 12, y: 2.2, z: 9.8 },
      camLook: { x: 12, y: 1.1, z: 4.5 },
      roomId: '10B',
      beaconId: 'BCN-10B',
      classId: '10B',
      explanation: 'Moving to Class 10-B. Each classroom has separate students and a dedicated beacon. Here, beacon BCN-10B monitors section 10-B students. Signals from adjacent classrooms are attenuated by brick partition walls to ensure accurate room presence.'
    },
    {
      id: 'class10c',
      title: 'Class 10-C',
      badge: 'Stop 6 of 16 · Academic Wing',
      pos: { x: 20, z: 6.8 },
      yaw: Math.PI,
      camPos: { x: 20, y: 2.2, z: 9.8 },
      camLook: { x: 20, y: 1.1, z: 4.5 },
      roomId: '10C',
      beaconId: 'BCN-10C',
      classId: '10C',
      explanation: 'This is Class 10-C with beacon BCN-10C. Notice that all student avatars feature realistic anatomical proportions, individualized procedural face textures, school uniforms, and natural periodic eye-blinking.'
    },
    {
      id: 'class9a',
      title: 'Class 9-A',
      badge: 'Stop 7 of 16 · Junior Wing',
      pos: { x: 28, z: 6.8 },
      yaw: Math.PI,
      camPos: { x: 28, y: 2.2, z: 9.8 },
      camLook: { x: 28, y: 1.1, z: 4.5 },
      roomId: '9A',
      beaconId: 'BCN-9A',
      classId: '9A',
      explanation: 'Welcome to Class 9-A, supervised by beacon BCN-9A. Even as students sit at their study desks, their personal smartphones receive signal advertisements from the ceiling beacon to maintain live room occupancy logs.'
    },
    {
      id: 'class9b',
      title: 'Class 9-B',
      badge: 'Stop 8 of 16 · Junior Wing',
      pos: { x: 36, z: 6.8 },
      yaw: Math.PI,
      camPos: { x: 36, y: 2.2, z: 9.8 },
      camLook: { x: 36, y: 1.1, z: 4.5 },
      roomId: '9B',
      beaconId: 'BCN-9B',
      classId: '9B',
      explanation: 'In Class 9-B, beacon BCN-9B transmits at minus 59 dBm reference power. The radio path-loss exponent is calibrated for classroom acoustics, giving a reliable room-level confidence indicator.'
    },
    {
      id: 'class9c',
      title: 'Class 9-C',
      badge: 'Stop 9 of 16 · Junior Wing',
      pos: { x: 44, z: 6.8 },
      yaw: Math.PI,
      camPos: { x: 44, y: 2.2, z: 9.8 },
      camLook: { x: 44, y: 1.1, z: 4.5 },
      roomId: '9C',
      beaconId: 'BCN-9C',
      classId: '9C',
      explanation: 'Class 9-C concludes our northern academic wing with beacon BCN-9C. Across all six sections, 120 students are actively monitored throughout the official Period 1 attendance window from 9:00 AM to 10:00 AM.'
    },
    {
      id: 'lab',
      title: 'Computer Science Lab',
      badge: 'Stop 10 of 16 · Specialized Wings',
      pos: { x: 44, z: 19.5 },
      yaw: 0,
      camPos: { x: 44, y: 2.4, z: 15.2 },
      camLook: { x: 44, y: 1.2, z: 22 },
      roomId: 'LAB',
      beaconId: 'BCN-LAB',
      explanation: 'Across the southern wing is our Computer Lab and Staffroom. Beacon BCN-LAB tracks specialized facility utilization, logging student practical sessions and workstation usage throughout school hours.'
    },
    {
      id: 'library',
      title: 'Central Library & Media Center',
      badge: 'Stop 11 of 16 · Reading Hall',
      pos: { x: 11, z: 20 },
      yaw: 0,
      camPos: { x: 11, y: 2.5, z: 15.8 },
      camLook: { x: 11, y: 1.3, z: 23.5 },
      roomId: 'LIB',
      beaconId: 'BCN-LIB',
      explanation: 'We have now entered the Central Library. Monitored by beacon BCN-LIB, this facility uses separate library attendance sessions. When a student enters, their permanent Student ID is linked to a unique library session ID, such as LIB-SESSION-10A-S001, recording dwell times without modifying their classroom records.'
    },
    {
      id: 'beacon_tech',
      title: 'BLE Beacon Signal Monitoring',
      badge: 'Stop 12 of 16 · Signal Telemetry',
      pos: { x: 20, z: 7.2 },
      yaw: Math.PI,
      camPos: { x: 20, y: 2.6, z: 6.2 },
      camLook: { x: 20, y: 2.8, z: 5.0 },
      roomId: '10C',
      beaconId: 'BCN-10C',
      explanation: 'Let us examine our BLE beacon technology. The beacon broadcasts continuous advertising packets. The student application measures Received Signal Strength in dBm. We use log-distance path loss with wall attenuation to estimate room presence without requiring battery-draining GPS.'
    },
    {
      id: 'student_app',
      title: 'Student Attendance Mobile App',
      badge: 'Stop 13 of 16 · Mobile Punch-In',
      pos: { x: 4, z: 6.8 },
      yaw: Math.PI,
      camPos: { x: 4, y: 2.2, z: 8.5 },
      camLook: { x: 4, y: 1.2, z: 5.5 },
      roomId: '10A',
      beaconId: 'BCN-10A',
      classId: '10A',
      explanation: 'Now, let us examine the Student Attendance App. When Period 1 becomes active at 9:00 AM, the mobile application scans for the assigned classroom beacon. Only when strong proximity is validated does the Punch In button unlock.'
    },
    {
      id: 'face_verification',
      title: 'Biometric Face Verification',
      badge: 'Stop 14 of 16 · Biometric Check',
      pos: { x: 4, z: 6.8 },
      yaw: Math.PI,
      camPos: { x: 4, y: 2.2, z: 7.8 },
      camLook: { x: 4, y: 1.2, z: 5.5 },
      roomId: '10A',
      beaconId: 'BCN-10A',
      classId: '10A',
      explanation: 'During punch-in, the student triggers the camera face verification guide. A biometric facial mesh confirms student identity with demonstration confidence scores, ensuring authentic classroom attendance. Once confirmed, the student is marked Present.'
    },
    {
      id: 'admin_dashboard',
      title: 'Live Admin Attendance Dashboard',
      badge: 'Stop 15 of 16 · Central Analytics',
      pos: { x: 24, z: 12 },
      yaw: -Math.PI / 2,
      camPos: { x: 26, y: 2.5, z: 15.5 },
      camLook: { x: 23, y: 1.3, z: 12 },
      roomId: 'CORR',
      beaconId: null,
      explanation: 'Here is the Live Admin Attendance Dashboard. School administrators have instant visibility into total enrolled students, marked Present, Pending Not-Marked, and finalized Absentees after 10:00 AM. Data can be filtered by section or exported directly to CSV.'
    },
    {
      id: 'farewell',
      title: 'Tour Complete — Explore Greenfield Academy',
      badge: 'Stop 16 of 16 · Digital Twin Complete',
      pos: { x: 24, z: 34 },
      yaw: 0,
      camPos: { x: 24, y: 18, z: 44 },
      camLook: { x: 24, y: 1.5, z: 15 },
      roomId: 'CORR',
      beaconId: null,
      explanation: 'This concludes our guided tour of Greenfield Smart Academy. All classroom avatars, beacons, attendance lifecycles, and dashboard analytics remain fully active in the live simulation. You can now explore the campus freely. Thank you for visiting!'
    }
  ];

  /* ── Procedural Detailed Presenter Face Canvas Texture ─────────────────── */
  function createPresenterFaceTexture() {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    var ctx = c.getContext('2d');

    drawPresenterFace(ctx, 512, 512, false, 0);

    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    return { canvas: c, ctx: ctx, texture: tex };
  }

  function drawPresenterFace(ctx, w, h, isBlink, mouthMv) {
    ctx.clearRect(0, 0, w, h);

    // 1. Warm skin base with natural tone & soft shading
    var baseSkin = '#e8c9ad';
    var grad = ctx.createRadialGradient(w / 2, h / 2 - 15, 35, w / 2, h / 2, w / 2);
    grad.addColorStop(0, '#f2d8c2');
    grad.addColorStop(0.85, baseSkin);
    grad.addColorStop(1, '#b88a6d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 2. Subtle cheek blush / contour
    ctx.fillStyle = 'rgba(215, 110, 100, 0.12)';
    ctx.beginPath(); ctx.arc(w * 0.26, h * 0.58, 45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.74, h * 0.58, 45, 0, Math.PI * 2); ctx.fill();

    // 3. Professional, arched eyebrows
    ctx.strokeStyle = '#2d1b10';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    // Left eyebrow
    ctx.beginPath();
    ctx.moveTo(w * 0.22, h * 0.36);
    ctx.quadraticCurveTo(w * 0.34, h * 0.31, w * 0.44, h * 0.35);
    ctx.stroke();
    // Right eyebrow
    ctx.beginPath();
    ctx.moveTo(w * 0.56, h * 0.35);
    ctx.quadraticCurveTo(w * 0.66, h * 0.31, w * 0.78, h * 0.36);
    ctx.stroke();

    // 4. Detailed expressive eyes
    var eyeY = h * 0.45;
    var eyeDist = w * 0.17;
    var eyeRadius = 24;

    if (isBlink) {
      // Natural closed eyelid line
      ctx.strokeStyle = '#2b180d';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2 - eyeDist, eyeY + 4, eyeRadius * 0.85, 0.1 * Math.PI, 0.9 * Math.PI, false);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w / 2 + eyeDist, eyeY + 4, eyeRadius * 0.85, 0.1 * Math.PI, 0.9 * Math.PI, false);
      ctx.stroke();
    } else {
      [w / 2 - eyeDist, w / 2 + eyeDist].forEach(function(cx) {
        // White sclera
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(cx, eyeY, eyeRadius * 1.05, eyeRadius * 0.74, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(60, 40, 25, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Warm hazel / brown Iris
        ctx.fillStyle = '#452b18';
        ctx.beginPath();
        ctx.arc(cx, eyeY, eyeRadius * 0.54, 0, Math.PI * 2);
        ctx.fill();

        // Dark pupil
        ctx.fillStyle = '#0a0a0c';
        ctx.beginPath();
        ctx.arc(cx, eyeY, eyeRadius * 0.28, 0, Math.PI * 2);
        ctx.fill();

        // Realistic specular gleam
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 4, eyeY - 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // 5. Contoured nose bridge
    ctx.strokeStyle = 'rgba(150, 95, 65, 0.4)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.50, h * 0.44);
    ctx.lineTo(w * 0.49, h * 0.58);
    ctx.quadraticCurveTo(w * 0.46, h * 0.64, w * 0.50, h * 0.65);
    ctx.quadraticCurveTo(w * 0.54, h * 0.64, w * 0.52, h * 0.58);
    ctx.stroke();

    // 6. Speaking, smiling lips
    var mouthY = h * 0.77;
    var mouthW = 44;
    var openH = 3 + mouthMv * 6; // Opens up subtly when speaking!

    // Upper lip
    ctx.fillStyle = '#b8544c';
    ctx.beginPath();
    ctx.moveTo(w / 2 - mouthW, mouthY);
    ctx.quadraticCurveTo(w / 2 - mouthW * 0.4, mouthY - 5, w / 2, mouthY - 3);
    ctx.quadraticCurveTo(w / 2 + mouthW * 0.4, mouthY - 5, w / 2 + mouthW, mouthY);
    ctx.quadraticCurveTo(w / 2, mouthY + openH, w / 2 - mouthW, mouthY);
    ctx.fill();

    // Tooth highlight inside open mouth
    if (openH > 4) {
      ctx.fillStyle = '#fffdfa';
      ctx.fillRect(w / 2 - 12, mouthY - 1, 24, 3.5);
    }

    // Lower lip
    ctx.fillStyle = '#c76258';
    ctx.beginPath();
    ctx.moveTo(w / 2 - mouthW, mouthY);
    ctx.quadraticCurveTo(w / 2, mouthY + 11 + openH * 0.5, w / 2 + mouthW, mouthY);
    ctx.quadraticCurveTo(w / 2, mouthY + 3, w / 2 - mouthW, mouthY);
    ctx.fill();
  }

  /* ── 3D Virtual Presenter Human Model Builder ──────────────────────────── */
  function buildPresenterModel() {
    presenterGroup = new THREE.Group();
    presenterGroup.position.set(currentPos.x, currentPos.y, currentPos.z);
    presenterGroup.rotation.y = currentYaw;

    // Materials
    var matSuit = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75, metalness: 0.1 }); // Tailored dark navy blazer
    var matLapel = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6, metalness: 0.2 });
    var matShirt = new THREE.MeshStandardMaterial({ color: 0xe0f2fe, roughness: 0.65 }); // Light blue crisp formal shirt
    var matTie = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.45, metalness: 0.1 });  // Royal blue silk tie
    var matPants = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });
    var matShoes = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.35, metalness: 0.3 }); // Polished black shoes
    var matSkin = new THREE.MeshStandardMaterial({ color: 0xe8c9ad, roughness: 0.75 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3, metalness: 0.8 });

    // 1. Legs (Upper leg, Lower leg, Foot)
    // Left Leg
    var legLGroup = new THREE.Group();
    legLGroup.position.set(-0.11, 0.84, 0);
    var thighL = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.42, 12), matPants);
    thighL.position.y = -0.21;
    thighL.castShadow = true;
    legLGroup.add(thighL);

    var shinL = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.40, 10), matPants);
    shinL.position.y = -0.58;
    shinL.castShadow = true;
    legLGroup.add(shinL);

    var shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.22), matShoes);
    shoeL.position.set(0, -0.80, 0.04);
    legLGroup.add(shoeL);
    presenterGroup.add(legLGroup);
    limbs.legL = legLGroup;

    // Right Leg
    var legRGroup = new THREE.Group();
    legRGroup.position.set(0.11, 0.84, 0);
    var thighR = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.42, 12), matPants);
    thighR.position.y = -0.21;
    thighR.castShadow = true;
    legRGroup.add(thighR);

    var shinR = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.40, 10), matPants);
    shinR.position.y = -0.58;
    shinR.castShadow = true;
    legRGroup.add(shinR);

    var shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.22), matShoes);
    shoeR.position.set(0, -0.80, 0.04);
    legRGroup.add(shoeR);
    presenterGroup.add(legRGroup);
    limbs.legR = legRGroup;

    // 2. Pelvis & Torso
    var pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.24), matPants);
    pelvis.position.y = 0.90;
    presenterGroup.add(pelvis);

    var torsoGroup = new THREE.Group();
    torsoGroup.position.set(0, 0.98, 0);

    // Blazer Body
    var jacket = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.26), matSuit);
    jacket.position.y = 0.24;
    jacket.castShadow = true;
    torsoGroup.add(jacket);

    // Shirt & Lapels
    var shirtInlay = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.03), matShirt);
    shirtInlay.position.set(0, 0.26, 0.132);
    torsoGroup.add(shirtInlay);

    var tie = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.28, 0.02), matTie);
    tie.position.set(0, 0.22, 0.142);
    torsoGroup.add(tie);

    // Blazer Lapels
    var lapelL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.025), matLapel);
    lapelL.position.set(-0.09, 0.26, 0.138);
    lapelL.rotation.z = -0.15;
    torsoGroup.add(lapelL);

    var lapelR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.025), matLapel);
    lapelR.position.set(0.09, 0.26, 0.138);
    lapelR.rotation.z = 0.15;
    torsoGroup.add(lapelR);

    // Official Presenter Lanyard / Badge
    var lanyardTex = SchoolScene.makeTextTex('TOUR GUIDE', 256, 64, 22, '#ffffff', '#10b981');
    var badgeMat = new THREE.MeshBasicMaterial({ map: lanyardTex });
    var badgeMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.05), badgeMat);
    badgeMesh.position.set(0.11, 0.32, 0.144);
    torsoGroup.add(badgeMesh);

    // Gold Pin
    var pin = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), matGold);
    pin.position.set(0.11, 0.36, 0.145);
    torsoGroup.add(pin);

    presenterGroup.add(torsoGroup);
    limbs.torso = torsoGroup;

    // 3. Neck & Head
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 12), matSkin);
    neck.position.y = 1.48;
    presenterGroup.add(neck);

    var headGroup = new THREE.Group();
    headGroup.position.set(0, 1.62, 0);

    // High-Res Procedural Face
    var faceObj = createPresenterFaceTexture();
    limbs.faceCanvas = faceObj.canvas;
    limbs.faceCtx = faceObj.ctx;
    limbs.faceTex = faceObj.texture;

    var headMat = new THREE.MeshStandardMaterial({
      map: faceObj.texture,
      roughness: 0.7,
      metalness: 0.05
    });
    var headRadius = 0.128;
    var headMesh = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 24, 24), headMat);
    headMesh.rotation.y = Math.PI / 2; // Orient procedural canvas face towards +Z (front)
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    // Professional Styled Hair
    var hairMat = new THREE.MeshStandardMaterial({ color: 0x241812, roughness: 0.85 });
    var hairTop = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 1.04, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.48), hairMat);
    hairTop.position.y = 0.015;
    headGroup.add(hairTop);

    var sideburnL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.10, 0.08), hairMat);
    sideburnL.position.set(-0.118, -0.01, 0.01);
    headGroup.add(sideburnL);

    var sideburnR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.10, 0.08), hairMat);
    sideburnR.position.set(0.118, -0.01, 0.01);
    headGroup.add(sideburnR);

    presenterGroup.add(headGroup);
    limbs.head = headGroup;

    // 4. Arms
    // Left Arm (Holds digital presenter tablet)
    var armLGroup = new THREE.Group();
    armLGroup.position.set(-0.23, 1.42, 0);
    var bicepL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.28, 10), matSuit);
    bicepL.position.y = -0.14;
    armLGroup.add(bicepL);

    var forearmLGroup = new THREE.Group();
    forearmLGroup.position.set(0, -0.28, 0);
    var forearmL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.24, 10), matSuit);
    forearmL.position.y = -0.12;
    forearmLGroup.add(forearmL);

    var handL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), matSkin);
    handL.position.set(0, -0.26, 0);
    forearmLGroup.add(handL);

    // Presenter Tablet (Smart School Controller)
    var tabletMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.8 });
    var tablet = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.01, 0.24), tabletMat);
    tablet.position.set(0, -0.26, 0.10);
    tablet.rotation.x = 0.5;
    forearmLGroup.add(tablet);

    var tabletScreenMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 0.8 });
    var tabletScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), tabletScreenMat);
    tabletScreen.position.set(0, -0.254, 0.10);
    tabletScreen.rotation.x = -Math.PI / 2 + 0.5;
    forearmLGroup.add(tabletScreen);

    // Default resting / holding pose for left arm
    armLGroup.rotation.x = 0.35;
    armLGroup.rotation.z = 0.12;
    forearmLGroup.rotation.x = -0.75;
    armLGroup.add(forearmLGroup);
    presenterGroup.add(armLGroup);
    limbs.armL = armLGroup;
    limbs.forearmL = forearmLGroup;

    // Right Arm (Gesturing & Pointing to Beacons/Rooms)
    var armRGroup = new THREE.Group();
    armRGroup.position.set(0.23, 1.42, 0);
    var bicepR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.28, 10), matSuit);
    bicepR.position.y = -0.14;
    armRGroup.add(bicepR);

    var forearmRGroup = new THREE.Group();
    forearmRGroup.position.set(0, -0.28, 0);
    var forearmR = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.24, 10), matSuit);
    forearmR.position.y = -0.12;
    forearmRGroup.add(forearmR);

    var handR = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), matSkin);
    handR.position.set(0, -0.26, 0);
    forearmRGroup.add(handR);

    armRGroup.add(forearmRGroup);
    presenterGroup.add(armRGroup);
    limbs.armR = armRGroup;
    limbs.forearmR = forearmRGroup;

    // 5. Overhead Presenter Billboard
    var guidePillTex = SchoolScene.makeTextTex('🎙 VIRTUAL TOUR GUIDE', 512, 128, 32, '#ffffff', '#064e3bcc');
    var pillMat = new THREE.MeshBasicMaterial({ map: guidePillTex, transparent: true, opacity: 0.95 });
    var pillMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), pillMat);
    pillMesh.position.y = 1.95;
    presenterGroup.add(pillMesh);
    limbs.billboard = pillMesh;

    // 6. Glowing Floor Presentation Aura Ring
    var ringGeo = new THREE.RingGeometry(0.42, 0.54, 32);
    var ringMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var aura = new THREE.Mesh(ringGeo, ringMat);
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.02;
    presenterGroup.add(aura);
    limbs.auraRing = aura;

    scene.add(presenterGroup);
  }

  /* ── Corridor & Doorway Waypoint Navigation System ──────────────────────── */
  // Returns connected, non-colliding waypoints along the hallway and through doors
  function buildPathBetween(from, to) {
    var path = [];
    var corridorZ = 12.0;

    // Helper: find doorway X for a room position
    function getDoorForPoint(pt) {
      if (pt.z < 10) {
        // Northern classrooms: doors at Z = 10
        if (pt.x <= 8)  return { x: 4,  z: 10 }; // 10A
        if (pt.x <= 16) return { x: 12, z: 10 }; // 10B
        if (pt.x <= 24) return { x: 20, z: 10 }; // 10C
        if (pt.x <= 32) return { x: 28, z: 10 }; // 9A
        if (pt.x <= 40) return { x: 36, z: 10 }; // 9B
        return { x: 44, z: 10 };                  // 9C
      } else if (pt.z > 14) {
        // Southern spaces: doors at Z = 14 or main entrance at Z = 30
        if (pt.z >= 28) {
          // Outside / Portico
          return { x: 24, z: 30 }; // Main Entrance
        }
        if (pt.x <= 22) return { x: 8,  z: 14 }; // Library
        if (pt.x <= 30) return { x: 26, z: 14 }; // Reception
        if (pt.x <= 40) return { x: 35, z: 14 }; // Staff
        return { x: 44, z: 14 };                  // Computer Lab
      }
      return null; // Already in corridor
    }

    var fromDoor = getDoorForPoint(from);
    var toDoor = getDoorForPoint(to);

    // If starting inside a room or outside, step through the doorway into the corridor
    if (fromDoor) {
      path.push({ x: fromDoor.x, z: fromDoor.z });
      if (fromDoor.z === 30) {
        // Walking inside from the outside portico
        path.push({ x: 24, z: 22 });
        path.push({ x: 26, z: 14 });
      }
      path.push({ x: fromDoor.x === 24 && fromDoor.z === 30 ? 26 : fromDoor.x, z: corridorZ });
    }

    // Travel along corridor centerline (Z = 12.0)
    var targetCorridorX = toDoor ? (toDoor.z === 30 ? 26 : toDoor.x) : to.x;
    path.push({ x: targetCorridorX, z: corridorZ });

    // If destination is inside a room or outside, walk through its door to the target
    if (toDoor) {
      if (toDoor.z === 30) {
        // Exiting out to the portico plaza
        path.push({ x: 26, z: 14 });
        path.push({ x: 24, z: 22 });
        path.push({ x: 24, z: 30 });
      } else {
        path.push({ x: toDoor.x, z: toDoor.z });
      }
    }

    // Final destination
    path.push({ x: to.x, z: to.z });
    return path;
  }

  function planRouteToStop(stopIndex) {
    var targetStop = TOUR_STOPS[stopIndex];
    if (!targetStop) return;

    var path = buildPathBetween(currentPos, targetStop.pos);
    waypointsQueue = path;
    currentWaypoint = waypointsQueue.shift();
    isWalking = true;
    isExplaining = false;
  }

  /* ── Speech Synthesis & Subtitles ───────────────────────────────────────── */
  function speakExplanation(text) {
    if (!voiceEnabled || !synth) {
      // Just simulate speaking time for lip sync
      speakingTimer = Math.max(3.5, text.length * 0.05);
      return;
    }

    try {
      synth.cancel();
      var utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      utter.pitch = 1.0;
      utter.lang = 'en-US';

      // Pick natural sounding English voice if available
      var voices = synth.getVoices();
      var prefVoice = voices.find(function(v) {
        return (v.lang === 'en-US' || v.lang.startsWith('en')) &&
               (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Daniel'));
      });
      if (prefVoice) utter.voice = prefVoice;

      speakingTimer = Math.max(3.5, text.length * 0.06);

      utter.onend = function() {
        speakingTimer = 0;
      };
      utter.onerror = function() {
        speakingTimer = 0;
      };

      currentUtterance = utter;
      synth.speak(utter);
    } catch (e) {
      speakingTimer = Math.max(3.5, text.length * 0.05);
    }
  }

  function updateHUD(stop) {
    var badgeEl = document.getElementById('tour-badge');
    if (badgeEl) badgeEl.textContent = stop.badge;

    var titleEl = document.getElementById('tour-title');
    if (titleEl) titleEl.textContent = stop.title;

    var subEl = document.getElementById('tour-subtitles');
    if (subEl) {
      subEl.textContent = stop.explanation;
      subEl.style.display = subtitlesEnabled ? 'block' : 'none';
    }

    var progressFill = document.getElementById('tour-progress-bar');
    if (progressFill) {
      var pct = ((currentStopIndex + 1) / TOUR_STOPS.length) * 100;
      progressFill.style.width = pct + '%';
    }

    // If stop includes a classroom or beacon, highlight beacon and roster
    if (stop.classId && window.SchoolDashboard) {
      SchoolDashboard.renderStudentList(stop.classId);
    }
  }

  /* ── Interactive Tour Execution & Transitions ──────────────────────────── */
  function goToStop(index) {
    if (index < 0) index = 0;
    if (index >= TOUR_STOPS.length) index = TOUR_STOPS.length - 1;
    currentStopIndex = index;
    var stop = TOUR_STOPS[currentStopIndex];

    updateHUD(stop);

    // If already at position (e.g. initial start), execute directly
    var dist = Math.hypot(currentPos.x - stop.pos.x, currentPos.z - stop.pos.z);
    if (dist < 0.2) {
      arriveAtStop(stop);
    } else {
      planRouteToStop(currentStopIndex);
    }
  }

  function arriveAtStop(stop) {
    isWalking = false;
    isExplaining = true;
    targetYaw = stop.yaw;

    // Smooth camera swoop into viewing position
    if (cameraFollowEnabled && SchoolScene.startCameraTransition) {
      SchoolScene.startCameraTransition(
        new THREE.Vector3(stop.camPos.x, stop.camPos.y, stop.camPos.z),
        new THREE.Vector3(stop.camLook.x, stop.camLook.y, stop.camLook.z),
        1.2
      );
    }

    // Speak explanation
    speakExplanation(stop.explanation);

    // Trigger stop-specific interactive demonstrations
    executeStopDemonstration(stop);
  }

  function executeStopDemonstration(stop) {
    // Stop 13: Student App Proximity Check
    if (stop.id === 'student_app' && window.SchoolDashboard) {
      SchoolDashboard.handleStudentSelect('10A-S001', '10A');
      SchoolDashboard.showToast('📱 Student App: BCN-10A verified within proximity range!', 'info');
    }

    // Stop 14: Face Verification Demonstration
    if (stop.id === 'face_verification' && window.SchoolDashboard) {
      setTimeout(function() {
        if (!tourActive) return;
        SchoolDashboard.handlePunchInFlow('10A-S001', '10A');
      }, 900);
    }

    // Stop 15: Admin Dashboard Tour
    if (stop.id === 'admin_dashboard' && window.SchoolDashboard) {
      setTimeout(function() {
        if (!tourActive) return;
        SchoolDashboard.switchView('admin-dashboard');
        setTimeout(function() {
          if (!tourActive) return;
          SchoolDashboard.switchView('simulation');
        }, 3600);
      }, 1000);
    }
  }

  /* ── Frame Update (Walk Physics, Gestures, Lip Sync) ─────────────────────── */
  function update(dt, t) {
    if (!presenterGroup) return;

    // 1. Waypoint Walking Interpolation
    if (isWalking && !tourPaused) {
      if (currentWaypoint) {
        var dx = currentWaypoint.x - currentPos.x;
        var dz = currentWaypoint.z - currentPos.z;
        var dist = Math.hypot(dx, dz);

        if (dist > 0.12) {
          var step = Math.min(walkSpeed * dt, dist);
          currentPos.x += (dx / dist) * step;
          currentPos.z += (dz / dist) * step;

          // Rotate presenter towards movement direction
          var moveAngle = Math.atan2(dx, dz);
          currentYaw = THREE.MathUtils.lerp(currentYaw, moveAngle, 0.18);

          // Animate walk cycle (alternating leg swings & arm counter-swings)
          walkPhase += dt * 9.5;
          var swing = Math.sin(walkPhase);

          if (limbs.legL) limbs.legL.rotation.x = swing * 0.55;
          if (limbs.legR) limbs.legR.rotation.x = -swing * 0.55;

          // Arms swing in opposition to legs
          if (limbs.armR) limbs.armR.rotation.x = -swing * 0.45;
          // Left arm holds tablet steadily with slight bob
          if (limbs.armL) limbs.armL.rotation.x = 0.35 + swing * 0.08;

          // Subtle vertical body bobbing during stride
          if (limbs.torso) limbs.torso.position.y = 0.98 + Math.abs(Math.cos(walkPhase)) * 0.025;

          // Camera follow during walk
          if (cameraFollowEnabled && camera && controls) {
            var camDist = 3.8;
            var targetCamX = currentPos.x - Math.sin(currentYaw) * camDist;
            var targetCamZ = currentPos.z - Math.cos(currentYaw) * camDist;
            camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, 0.08);
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, 2.4, 0.08);
            camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, 0.08);
            controls.target.set(currentPos.x, 1.4, currentPos.z);
          }
        } else {
          // Reached waypoint, fetch next
          if (waypointsQueue.length > 0) {
            currentWaypoint = waypointsQueue.shift();
          } else {
            currentWaypoint = null;
            arriveAtStop(TOUR_STOPS[currentStopIndex]);
          }
        }
      }
    }

    // 2. Explaining / Standing Idle Gestures
    if (isExplaining && !tourPaused) {
      // Rotate presenter to target yaw
      currentYaw = THREE.MathUtils.lerp(currentYaw, targetYaw, 0.1);

      // Return legs smoothly to standing position
      if (limbs.legL) limbs.legL.rotation.x = THREE.MathUtils.lerp(limbs.legL.rotation.x, 0, 0.15);
      if (limbs.legR) limbs.legR.rotation.x = THREE.MathUtils.lerp(limbs.legR.rotation.x, 0, 0.15);

      // Gentle natural breathing
      if (limbs.torso) {
        limbs.torso.position.y = 0.98 + 0.006 * Math.sin(t * 2.2);
      }

      // Expressive explaining gesture with right arm
      if (limbs.armR) {
        var gesturePhase = t * 2.0;
        // Lift right arm up to waist/chest level, open palm towards classroom/beacon
        limbs.armR.rotation.x = THREE.MathUtils.lerp(limbs.armR.rotation.x, -0.65 + 0.12 * Math.sin(gesturePhase), 0.1);
        limbs.armR.rotation.z = THREE.MathUtils.lerp(limbs.armR.rotation.z, 0.35 + 0.08 * Math.cos(gesturePhase * 0.8), 0.1);
        if (limbs.forearmR) {
          limbs.forearmR.rotation.x = -0.55 + 0.15 * Math.sin(gesturePhase * 1.2);
        }
      }

      // Natural gentle head movement looking towards audience / room
      if (limbs.head) {
        limbs.head.rotation.y = 0.15 * Math.sin(t * 1.6);
        limbs.head.rotation.x = 0.05 * Math.cos(t * 2.0);
      }
    }

    // Update position and rotation in Three.js
    presenterGroup.position.set(currentPos.x, currentPos.y, currentPos.z);
    presenterGroup.rotation.y = currentYaw;

    // 3. Eye Blinking & Speaking Mouth Animation
    blinkTimer -= dt;
    if (blinkTimer <= 0) {
      isBlinking = !isBlinking;
      blinkTimer = isBlinking ? 0.14 : (3.2 + Math.random() * 2.5);
    }

    // Mouth moves when speaking
    if (speakingTimer > 0) {
      speakingTimer -= dt;
      mouthOpen = 0.5 + 0.5 * Math.sin(t * 16);
    } else {
      mouthOpen = 0;
    }

    if (limbs.faceCtx) {
      drawPresenterFace(limbs.faceCtx, 512, 512, isBlinking, mouthOpen);
      limbs.faceTex.needsUpdate = true;
    }

    // 4. Billboard overhead guide name badge towards camera
    if (limbs.billboard && camera) {
      limbs.billboard.lookAt(camera.position);
    }

    // 5. Pulsing glowing aura ring under feet
    if (limbs.auraRing) {
      var sc = 1 + 0.06 * Math.sin(t * 3.0);
      limbs.auraRing.scale.set(sc, sc, sc);
    }
  }

  /* ── Tour Control API ───────────────────────────────────────────────────── */
  function startTour() {
    tourActive = true;
    tourPaused = false;
    currentStopIndex = 0;

    var dock = document.getElementById('tour-dock');
    if (dock) dock.style.display = 'flex';

    var welcomeModal = document.getElementById('welcome-modal');
    if (welcomeModal) welcomeModal.style.display = 'none';

    // Position presenter at start
    var startStop = TOUR_STOPS[0];
    currentPos = { x: startStop.pos.x, z: startStop.pos.z, y: 0 };
    currentYaw = startStop.yaw;
    presenterGroup.position.set(currentPos.x, 0, currentPos.z);
    presenterGroup.visible = true;

    goToStop(0);
  }

  function pauseTour() {
    tourPaused = true;
    if (synth) synth.pause();
    var pauseBtn = document.getElementById('tour-pause-btn');
    if (pauseBtn) pauseBtn.innerHTML = '▶ Resume';
  }

  function resumeTour() {
    tourPaused = false;
    if (synth) synth.resume();
    var pauseBtn = document.getElementById('tour-pause-btn');
    if (pauseBtn) pauseBtn.innerHTML = '⏸ Pause';
  }

  function togglePause() {
    if (tourPaused) resumeTour();
    else pauseTour();
  }

  function nextStop() {
    if (synth) synth.cancel();
    if (currentStopIndex < TOUR_STOPS.length - 1) {
      goToStop(currentStopIndex + 1);
    }
  }

  function prevStop() {
    if (synth) synth.cancel();
    if (currentStopIndex > 0) {
      goToStop(currentStopIndex - 1);
    }
  }

  function restartTour() {
    if (synth) synth.cancel();
    startTour();
  }

  function exitTour() {
    tourActive = false;
    tourPaused = false;
    if (synth) synth.cancel();

    var dock = document.getElementById('tour-dock');
    if (dock) dock.style.display = 'none';

    var subEl = document.getElementById('tour-subtitles');
    if (subEl) subEl.style.display = 'none';

    // Keep presenter visible at standing position for manual inspection
    isWalking = false;
    isExplaining = true;

    if (SchoolScene.enterOverview) SchoolScene.enterOverview();
  }

  function toggleSubtitles() {
    subtitlesEnabled = !subtitlesEnabled;
    var subEl = document.getElementById('tour-subtitles');
    if (subEl) subEl.style.display = subtitlesEnabled ? 'block' : 'none';
    var btn = document.getElementById('tour-sub-btn');
    if (btn) btn.classList.toggle('active', subtitlesEnabled);
  }

  function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    if (!voiceEnabled && synth) synth.cancel();
    var btn = document.getElementById('tour-voice-btn');
    if (btn) btn.classList.toggle('active', voiceEnabled);
  }

  function toggleCameraFollow() {
    cameraFollowEnabled = !cameraFollowEnabled;
    var btn = document.getElementById('tour-cam-btn');
    if (btn) {
      btn.textContent = cameraFollowEnabled ? '🎥 Follow: ON' : '🎥 Orbit Mode';
      btn.classList.toggle('active', cameraFollowEnabled);
    }
  }

  /* ── Initialization ─────────────────────────────────────────────────────── */
  function init() {
    scene = SchoolScene.getScene();
    camera = SchoolScene.getCamera();
    controls = SchoolScene.getControls();

    buildPresenterModel();
    bindUIEvents();
  }

  function bindUIEvents() {
    // Welcome modal buttons
    var btnStartTour = document.getElementById('welcome-start-tour');
    if (btnStartTour) btnStartTour.addEventListener('click', startTour);

    var btnManual = document.getElementById('welcome-manual');
    if (btnManual) {
      btnManual.addEventListener('click', function() {
        var m = document.getElementById('welcome-modal');
        if (m) m.style.display = 'none';
        SchoolScene.enterOverview();
      });
    }

    var btnDash = document.getElementById('welcome-dashboard');
    if (btnDash) {
      btnDash.addEventListener('click', function() {
        var m = document.getElementById('welcome-modal');
        if (m) m.style.display = 'none';
        SchoolDashboard.switchView('admin-dashboard');
      });
    }

    var btnApp = document.getElementById('welcome-app');
    if (btnApp) {
      btnApp.addEventListener('click', function() {
        var m = document.getElementById('welcome-modal');
        if (m) m.style.display = 'none';
        SchoolDashboard.switchView('student-app');
      });
    }

    // Floating Tour Dock buttons
    var btnPause = document.getElementById('tour-pause-btn');
    if (btnPause) btnPause.addEventListener('click', togglePause);

    var btnNext = document.getElementById('tour-next-btn');
    if (btnNext) btnNext.addEventListener('click', nextStop);

    var btnPrev = document.getElementById('tour-prev-btn');
    if (btnPrev) btnPrev.addEventListener('click', prevStop);

    var btnRestart = document.getElementById('tour-restart-btn');
    if (btnRestart) btnRestart.addEventListener('click', restartTour);

    var btnExit = document.getElementById('tour-exit-btn');
    if (btnExit) btnExit.addEventListener('click', exitTour);

    var btnSub = document.getElementById('tour-sub-btn');
    if (btnSub) btnSub.addEventListener('click', toggleSubtitles);

    var btnVoice = document.getElementById('tour-voice-btn');
    if (btnVoice) btnVoice.addEventListener('click', toggleVoice);

    var btnCam = document.getElementById('tour-cam-btn');
    if (btnCam) btnCam.addEventListener('click', toggleCameraFollow);
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  return {
    init: init,
    update: update,
    startTour: startTour,
    pauseTour: pauseTour,
    resumeTour: resumeTour,
    nextStop: nextStop,
    prevStop: prevStop,
    restartTour: restartTour,
    exitTour: exitTour,
    toggleSubtitles: toggleSubtitles,
    toggleVoice: toggleVoice,
    toggleCameraFollow: toggleCameraFollow,
    getPresenter: function() { return presenterGroup; },
    isTourActive: function() { return tourActive; },
    getCurrentStop: function() { return TOUR_STOPS[currentStopIndex]; }
  };
})();

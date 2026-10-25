# Greenfield Smart Academy – 3D Smart School Attendance Digital Twin

A comprehensive 3D Smart School BLE Beacon Indoor Location Tracking and Period-Based Attendance Simulation built with **Three.js**, **Vanilla JavaScript**, and **Modern CSS**.

---

## 🌟 Overview & Key Integrated Features

Combine all school operations into a single integrated application:

1. **Realistic & Colourful 3D School Building & Landscaping**:
   - Modern exterior architecture with cream, beige, pastel green, and terracotta accents.
   - Grand entrance portico with 4 classical pillars, entrance canopy, double glass doors with metal handles.
   - 3D school name signboard: `"GREENFIELD SMART ACADEMY - 3D BLE Beacon Attendance & Indoor Digital Twin"`.
   - Landscaped campus with an 84m × 64m green grass lawn, front entrance paved plaza, 8 realistic 3D trees with multi-tier canopies, flowering hedge beds, and modern campus lamp posts.
   - 3D classroom signboards above every doorway with room numbers and assigned beacon IDs.
   - Realistic materials: checkered terrazzo tiles in classrooms, herringbone parquet wood in the Library, granite pavers in corridors.
   - Natural daylight lighting with soft shadows, hemisphere sky bounce, and anti-aliasing.

2. **Detailed, Realistic-Looking Student Avatars & Clear Faces**:
   - Seated human models with accurate anatomy: torso, arms resting on desks, smartphone/tablet in hand, uniform shirt/blouse, navy necktie/collar crest, trousers/skirts, and shoes on the floor.
   - Procedurally generated 512×512 high-resolution canvas face textures featuring eyes (sclera, colored iris, pupil, corneal specular reflection), arched eyebrows, shaded nose, and curved lips/smiles.
   - Varied natural skin tones, hair styles (parted, crew, curly, ponytail, bob, braids), and hair colors.
   - Subtle idle animations: gentle breathing chest rise/fall and natural eye blinking (closed eyelid arc every ~4 seconds).
   - Student focus camera zoom: clicking any student smoothly animates the camera into a portrait close-up of their face, badge, and desk.

3. **Multiple Classrooms with Dedicated BLE Beacons**:
   - **Class 10-A**: `BCN-10A`
   - **Class 10-B**: `BCN-10B`
   - **Class 10-C**: `BCN-10C`
   - **Class 9-A**: `BCN-9A`
   - **Class 9-B**: `BCN-9B`
   - **Class 9-C**: `BCN-9C`
   - **Central Library**: `BCN-LIB`
   - **Reception / Admin**: `BCN-REC`
   - **Computer Lab**: `BCN-LAB`

4. **Integrated 4-Page Navigation**:
   - `🏫 3D School Simulation`: Full 3D interactive campus viewport, camera presets (Overview, 10-A, 10-B, 10-C, 9-A, 9-B, 9-C, Library, Walk FPS), simulation controls, mini-map, and classroom roster drawer.
   - `📱 Student Attendance App`: Responsive mobile-framed app with a student selector (120 students across classes), student digital ID card, period schedule countdown, live classroom beacon telemetry (-dBm meter & animated signal quality bar), continuous BLE monitoring pulse, attendance receipt, and "Punch In" action.
   - `📊 Admin Attendance Dashboard`: Modern white-and-green theme (`#10b981`, `#059669`, `#f8fafc`, `#ffffff`) with key KPI summary cards, period countdown timer, classroom comparison cards, and a master student table with filters (Class, Status, Search) and CSV export.
   - `📚 Library Monitoring`: Dedicated library zone tracking with real-time occupancy stats, BCN-LIB telemetry, and active reading sessions table linking permanent Student IDs with unique Library Session IDs (`LIB-SESSION-XXX-001`).

5. **Period-Based Attendance (09:00 AM – 10:00 AM)**:
   - **Before 09:00 AM**: Displays *"Attendance Not Started"*. Punch-in button is disabled with scheduled opening time. All students show `NOT MARKED`.
   - **09:00 AM – 10:00 AM**: Attendance session unlocks automatically. Eligible students inside their assigned classroom can punch in and verify biometrics. Confirmed attendance is marked `PRESENT` with timestamp and face score. Unpunched students remain `NOT MARKED`.
   - **At or after 10:00 AM**: Period 1 session closes automatically. New punch-ins are locked. Successfully recorded punch-ins are preserved. All unpunched students are finalized as `ABSENT`.
   - Simulation Clock with Start, Pause, Reset, Speed slider (1x–120x), and instant time presets: `08:50 (Before)`, `09:10 (Active)`, `09:50 (Last Call)`, `10:05 (Closed)`.

6. **Face Biometric Verification & Punch-In Workflow**:
   - Interactive camera modal with animated laser scanning beam, 48 facial landmark dots, biometric target oval, real-time match confidence score (96.8%), and confirm action.
   - Clearly labelled as educational / simulated biometric demonstration.
   - Prevents duplicate attendance records for the same student and period.

7. **Clean UI & Removal of Debug Symbols**:
   - Removed unwanted debug plus-lines and raw clutter.
   - Circular sleek reticle in FPS mode and clean status badges.

---

## 🚀 How to Run Locally

### Option A: Direct Browser Launch (Zero Installation)
Double-click `index.html` (or drag it into Chrome, Edge, Brave, or Firefox).
No build step, compilation, or external internet connection is required—Three.js and OrbitControls are bundled locally in `js/lib/`.

### Option B: Local HTTP Server (Recommended)
Using Node.js:
```bash
# Start a local static server on port 8080
npx http-server . -p 8080 -c-1

# Open in browser:
# http://localhost:8080/
```

Or using Python:
```bash
python -m http.server 8080
# Open http://localhost:8080/
```

---

## 🧪 Verification & Acceptance Criteria Suite

Run the automated acceptance suite verifying all 16 criteria:
```bash
node test_acceptance_criteria.js
```
Expected output:
```
🌟 ALL 16 ACCEPTANCE CRITERIA VERIFIED AND PASSED 100%! 🌟
```

---

## 📁 Project Structure

```
ble-beacon-tracker/
├── index.html                  # Main integrated HTML entry point with 4 top-level views & modal
├── README.md                   # Comprehensive documentation & run instructions
├── test_acceptance_criteria.js # Test script validating all 16 prompt acceptance criteria
├── test_engine.js              # State machine and attendance lifecycle verification script
├── check_assets.js             # Asset reference integrity validator
├── css/
│   ├── school-style.css        # Complete styling for 3D view, Student App, Admin Dashboard & Library
│   ├── campus-style.css        # Legacy style reference
│   └── style.css               # Base styles
└── js/
    ├── lib/
    │   ├── three.min.js        # Three.js r147 standalone build
    │   └── OrbitControls.js    # Three.js camera controls
    ├── school-config.js        # Campus layout, 120 student profiles with styling & face data, beacons
    ├── school-engine.js        # Period-based attendance engine (9-10 AM), RSSI path-loss, library tracking
    ├── school-scene.js         # 3D campus, landscaping (lawn, 3D trees, shrubs, portico), student models with procedural faces
    ├── school-dashboard.js     # Orchestrates 4 integrated views, time presets, admin table, and face modal
    └── school-main.js          # Master frame loop & synchronization
```

---

## 🎮 Navigation & Keyboard Controls

- **Overview Camera**: Click and drag to orbit campus, scroll wheel to zoom, right-drag to pan.
- **Classroom Jump**: Click any classroom button in the top bar or sidebar (`10-A`, `10-B`, `10-C`, `9-A`, `9-B`, `9-C`, `Library`).
- **Student Focus / Face Zoom**: Click any student row in the roster or click any student avatar in 3D to zoom in on their face and desk.
- **Walk Mode (FPS)**: Press `F` or click *"Walk School (FPS)"*. Use `W`, `A`, `S`, `D` to walk and mouse to look around. Press `Esc` or `F` to return to overview.

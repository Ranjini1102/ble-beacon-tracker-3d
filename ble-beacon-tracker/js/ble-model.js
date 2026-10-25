/* =============================================================================
 * ble-model.js
 * -----------------------------------------------------------------------------
 * The signal model and the positioning algorithms. This file contains no
 * graphics code, so it can be read (and tested) on its own.
 *
 * IMPORTANT: Every RSSI value produced here is SIMULATED with a mathematical
 * model. Nothing is read from a Bluetooth adapter.
 *
 * Pipeline used for every BLE "scan report":
 *   1. true distance   -> mean RSSI          (log-distance path-loss model)
 *   2. mean RSSI       -> noisy RSSI         (Gaussian shadow-fading noise)
 *   3. noisy RSSI      -> filtered RSSI      (exponential moving average)
 *   4. filtered RSSI   -> estimated distance (inverse of the path-loss model)
 *   5. 3 distances     -> (x, z) position    (trilateration / weighted centroid)
 * ========================================================================== */

const BleModel = {

  /* Step 1 - Log-distance path-loss model.
   *     RSSI(d) = P0 - 10 * n * log10(d)
   *   P0 : RSSI at 1 m (params.txPower),  n : path-loss exponent,  d : distance in metres */
  meanRssi: function (distance3d) {
    const d = Math.max(distance3d, SIM.minDistance);
    return params.txPower - 10 * params.pathLossExp * Math.log10(d);
  },

  /* Standard normal random number (mean 0, variance 1) using the Box-Muller transform. */
  gaussian: function () {
    let u = 0;
    while (u === 0) u = Math.random();      // avoid log(0)
    const v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  },

  /* Step 2 - One simulated RSSI reading: mean value + Gaussian noise.
   *     RSSI = P0 - 10 n log10(d) + X_sigma,   X_sigma ~ N(0, sigma^2)
   * The result is rounded to whole dBm (as real phones report) and limited to
   * the receiver's range [sensitivity, maxRssi]. */
  measure: function (distance3d) {
    const noisy = this.meanRssi(distance3d) + this.gaussian() * params.noiseStd;
    return Math.round(clamp(noisy, SIM.sensitivity, SIM.maxRssi));
  },

  /* Step 3 - Exponential moving average (a simple low-pass filter).
   *     filtered = alpha * new + (1 - alpha) * previous */
  smooth: function (previous, sample) {
    if (previous === null || previous === undefined) return sample;
    return params.smoothing * sample + (1 - params.smoothing) * previous;
  },

  /* Step 4 - Invert the path-loss model to estimate the distance from an RSSI value.
   *     d = 10 ^ ((P0 - RSSI) / (10 * n)) */
  rssiToDistance: function (rssi) {
    return Math.pow(10, (params.txPower - rssi) / (10 * params.pathLossExp));
  },

  /* The beacons hang on the ceiling, the phone is held at 1.2 m, so the radio
   * distance is a 3-D distance. For positioning on the floor plan we need the
   * horizontal part only:  d_floor = sqrt(d_3d^2 - dh^2). */
  toFloorDistance: function (distance3d) {
    const dh = SIM.beaconHeight - SIM.receiverHeight;
    return Math.sqrt(Math.max(distance3d * distance3d - dh * dh, 0));
  },

  /* Distance at which the mean RSSI falls to `thresholdDbm` (used to size the signal rings). */
  rangeAtRssi: function (thresholdDbm) {
    return Math.pow(10, (params.txPower - thresholdDbm) / (10 * params.pathLossExp));
  }
};


const Positioning = {

  /* ---------------------------------------------------------------------------
   * Algorithm 1 - Linear trilateration (least squares)
   * ---------------------------------------------------------------------------
   * Every beacon i gives a circle:  (x - xi)^2 + (z - zi)^2 = di^2
   * These equations are non-linear, but subtracting the equation of one
   * reference beacon (r) from all the others removes the x^2 and z^2 terms:
   *
   *     2(xr - xi)*x + 2(zr - zi)*z = di^2 - dr^2 - xi^2 - zi^2 + xr^2 + zr^2
   *
   * This is a linear system A * [x z]^T = b with one row per non-reference
   * beacon. It is solved with the normal equations (A^T A) p = A^T b.
   * Returns null when the beacons are (almost) on one line. */
  linear: function (beacons, d) {
    const n = beacons.length;
    const r = n - 1;                       // reference beacon = last one
    let a11 = 0, a12 = 0, a22 = 0, c1 = 0, c2 = 0;

    for (let i = 0; i < r; i++) {
      const ax = 2 * (beacons[r].x - beacons[i].x);
      const az = 2 * (beacons[r].z - beacons[i].z);
      const b = d[i] * d[i] - d[r] * d[r]
              - beacons[i].x * beacons[i].x - beacons[i].z * beacons[i].z
              + beacons[r].x * beacons[r].x + beacons[r].z * beacons[r].z;
      a11 += ax * ax;  a12 += ax * az;  a22 += az * az;   // A^T A
      c1  += ax * b;   c2  += az * b;                     // A^T b
    }
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-6) return null;
    return { x: (c1 * a22 - c2 * a12) / det, z: (a11 * c2 - a12 * c1) / det };
  },

  /* ---------------------------------------------------------------------------
   * Algorithm 2 - Weighted centroid
   * ---------------------------------------------------------------------------
   * The estimate is the average of the beacon positions, where closer beacons
   * (shorter estimated distance) get a larger weight  w = 1 / d^2.
   * Very simple and robust, but it can never leave the triangle of beacons,
   * so it is biased towards the middle of the building. */
  centroid: function (beacons, d) {
    let sw = 0, sx = 0, sz = 0;
    for (let i = 0; i < beacons.length; i++) {
      const w = 1 / Math.pow(Math.max(d[i], 0.3), 2);
      sw += w;  sx += w * beacons[i].x;  sz += w * beacons[i].z;
    }
    return { x: sx / sw, z: sz / sw };
  },

  /* ---------------------------------------------------------------------------
   * Algorithm 3 - Trilateration refined with Gauss-Newton
   * ---------------------------------------------------------------------------
   * Minimises the weighted sum of squared range errors
   *     E(p) = sum_i  w_i * ( |p - bi| - di )^2 ,   w_i = 1 / di^2
   * Far beacons have noisier distance estimates, so they get smaller weights.
   * Starts from the linear solution and repeats a few Gauss-Newton steps. */
  gaussNewton: function (beacons, d) {
    let p = this.linear(beacons, d) || this.centroid(beacons, d);

    for (let iter = 0; iter < 12; iter++) {
      let h11 = 0, h12 = 0, h22 = 0, g1 = 0, g2 = 0;
      for (let i = 0; i < beacons.length; i++) {
        const dx = p.x - beacons[i].x;
        const dz = p.z - beacons[i].z;
        const range = Math.max(Math.hypot(dx, dz), 1e-3);
        const residual = range - d[i];
        const jx = dx / range, jz = dz / range;            // Jacobian row
        const w = 1 / Math.pow(Math.max(d[i], 0.5), 2);
        h11 += w * jx * jx;  h12 += w * jx * jz;  h22 += w * jz * jz;
        g1  += w * jx * residual;  g2 += w * jz * residual;
      }
      h11 += 1e-3;  h22 += 1e-3;                            // tiny damping for stability
      const det = h11 * h22 - h12 * h12;
      if (Math.abs(det) < 1e-12) break;
      let sx = -(g1 * h22 - g2 * h12) / det;                // solve H * step = -g
      let sz = -(h11 * g2 - h12 * g1) / det;
      const len = Math.hypot(sx, sz);
      if (len > 3) { sx *= 3 / len; sz *= 3 / len; }        // limit the step to 3 m
      p = { x: p.x + sx, z: p.z + sz };
      if (len < 1e-4) break;                                // converged
    }
    return p;
  },

  /* Runs the selected algorithm and keeps the result inside the building. */
  estimate: function (algorithm, beacons, distances) {
    let p;
    if (algorithm === 'centroid')          p = this.centroid(beacons, distances);
    else if (algorithm === 'gauss-newton') p = this.gaussNewton(beacons, distances);
    else                                   p = this.linear(beacons, distances) || this.centroid(beacons, distances);

    return {
      x: clamp(p.x, 0.1, BUILDING.width - 0.1),
      z: clamp(p.z, 0.1, BUILDING.depth - 0.1)
    };
  }
};

// Integer math ported line for line from the golden models:
//   tiny-tensor-core/model/golden.py      (run_integer)
//   int8-rollout-engine/model/golden.py   (int_step, int_rollout, argmin_first)
//   int8-rollout-engine/model/planner.py  (quantize_state, Planner)
(function (root) {
  "use strict";

  // ---- tiny-tensor-core: 196 -> 32 -> 10 ----

  function mnist(M, x) {
    const acc1 = new Array(32), h = new Array(32), acc2 = new Array(10), logits = new Array(10);
    for (let j = 0; j < 32; j++) {
      let a = 0;
      for (let i = 0; i < 196; i++) a += M.W1[j * 196 + i] * x[i];
      acc1[j] = a;
      // (acc * M1 + B1q + 2^23) >> 24, exact: the sum stays below 2^53
      const r = Math.floor((a * M.M1 + M.B1q[j] + 8388608) / 16777216);
      h[j] = r < 0 ? 0 : r > 127 ? 127 : r;
    }
    let digit = 0;
    for (let k = 0; k < 10; k++) {
      let a = 0;
      for (let j = 0; j < 32; j++) a += M.W2[k * 32 + j] * h[j];
      acc2[k] = a;
      logits[k] = a + M.B2q[k];
      if (logits[k] > logits[digit]) digit = k;
    }
    return { acc1, h, acc2, logits, digit };
  }

  // ---- int8-rollout-engine: 3 -> 16 -> 2 learned pendulum model ----

  function step(R, theta, omega, u) {
    const h = new Array(16);
    for (let j = 0; j < 16; j++) {
      const acc = R.B1[j] + R.W1[3 * j] * theta + R.W1[3 * j + 1] * omega + R.W1[3 * j + 2] * u;
      const v = acc >> R.S1;                       // arithmetic shift = floor
      h[j] = v < 0 ? 0 : v > 127 ? 127 : v;
    }
    let a0 = R.B2[0], a1 = R.B2[1];
    for (let j = 0; j < 16; j++) { a0 += R.W2[j] * h[j]; a1 += R.W2[16 + j] * h[j]; }
    let th = (theta + (a0 >> R.S2[0])) & 0xff;      // theta wraps
    if (th >= 128) th -= 256;
    let om = omega + (a1 >> R.S2[1]);               // omega saturates
    om = om < -127 ? -127 : om > 127 ? 127 : om;
    const cost = th * th + ((21 * om * om) >> 5) + ((u * u) >> 11);
    return [th, om, cost];
  }

  // Imagine every plan H steps ahead. Returns per-lane cost, the imagined
  // theta trajectory of every lane, and the winner (strict <, like the RTL).
  function rollout(R, theta0, omega0, plans) {
    const n = plans.length, H = plans[0].length;
    const cost = new Array(n), traj = new Array(n);
    let best = 0;
    for (let l = 0; l < n; l++) {
      let th = theta0, om = omega0, c = 0;
      const t = [th];
      for (let s = 0; s < H; s++) {
        const r = step(R, th, om, plans[l][s]);
        th = r[0]; om = r[1]; c += r[2];
        t.push(th);
      }
      cost[l] = c; traj[l] = t;
      if (c < cost[best]) best = l;
    }
    return { cost, traj, best };
  }

  const THETA_LSB = Math.PI / 128, OMEGA_LSB = 8 / 127;

  function quantize(theta, omega) {
    const tq = ((Math.round(theta / THETA_LSB) + 128) % 256 + 256) % 256 - 128;
    const oq = Math.max(-127, Math.min(127, Math.round(omega / OMEGA_LSB)));
    return [tq, oq];
  }

  // Candidate plans with a warm start, as in planner.py (SIGMA = 0.5).
  function candidates(rng, best, n, H) {
    const plans = [];
    if (!best) {
      for (let l = 0; l < n; l++) {
        const p = [];
        for (let s = 0; s < H; s++) p.push(Math.floor(rng() * 255) - 127);
        plans.push(p);
      }
      return plans;
    }
    const base = [];
    for (let s = 0; s < H; s++) base.push(best[Math.min(s + 1, best.length - 1)]);
    plans.push(base);
    for (let l = 1; l < n; l++) {
      const p = [];
      for (let s = 0; s < H; s++) {
        const v = Math.max(-1, Math.min(1, base[s] / 127 + 0.5 * gauss(rng)));
        p.push(Math.round(v * 127));
      }
      plans.push(p);
    }
    return plans;
  }

  function gauss(rng) {
    let u = 0; while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Pendulum-v1 physics (g = 10, m = l = 1, dt = 0.05, torque = 2u, |omega| <= 8).
  function physics(theta, omega, uq) {
    const u = 2 * uq / 127;
    let om = omega + (15 * Math.sin(theta) + 3 * u) * 0.05;
    om = Math.max(-8, Math.min(8, om));
    let th = theta + om * 0.05;
    th = ((th + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return [th, om];
  }

  // Clocks per decision from the int8-rollout-engine README.
  function clocks(lanes, H) { return (32 / lanes) * (83 * H + 2) + 34; }

  const api = { mnist, step, rollout, quantize, candidates, mulberry32, physics, clocks, THETA_LSB };
  if (typeof module !== "undefined") module.exports = api; else root.Engine = api;
})(this);

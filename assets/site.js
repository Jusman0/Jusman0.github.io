(function () {
  "use strict";
  const E = window.Engine, M = window.MODELS;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString("en-US");

  let C = {};
  function readColors() {
    const s = getComputedStyle(document.documentElement);
    for (const k of ["paper", "panel", "ink", "muted", "rule", "green", "copper"]) C[k] = s.getPropertyValue("--" + k).trim();
  }
  readColors();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); drawPend(); drawSeen(); drawHidden(); });

  function fit(canvas) {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return [ctx, r.width, r.height];
  }

  // =========================== pendulum planner ===========================

  const P = {
    theta: Math.PI - 0.05, omega: 0,      // real state; theta = 0 is upright
    lanes: 32, H: 15, best: null, last: null,
    rng: E.mulberry32(20261029), running: true, visible: true,
    grab: false, grabT: 0,
  };
  const pend = $("pend");

  function tick() {
    const [tq, oq] = E.quantize(P.theta, P.omega);
    const plans = E.candidates(P.rng, P.best, P.lanes, P.H);
    const r = E.rollout(M.rollout, tq, oq, plans);
    P.best = plans[r.best];
    const u = P.best[0];
    if (!P.grab) [P.theta, P.omega] = E.physics(P.theta, P.omega, u);
    P.last = { tq, oq, u, r };
    $("r-theta").textContent = tq;
    $("r-omega").textContent = oq;
    $("r-u").textContent = (2 * u / 127).toFixed(2) + " N·m";
    $("r-best").textContent = r.best;
    $("r-cost").textContent = fmt(r.cost[r.best]);
    paintLanes(r);
  }

  function buildLanes() {
    const el = $("lanes");
    el.style.gridTemplateColumns = `repeat(${P.lanes}, 1fr)`;
    el.innerHTML = "";
    for (let i = 0; i < P.lanes; i++) el.appendChild(document.createElement("div"));
  }
  function paintLanes(r) {
    const cells = $("lanes").children;
    let lo = Infinity, hi = -Infinity;
    for (const c of r.cost) { lo = Math.min(lo, c); hi = Math.max(hi, c); }
    for (let i = 0; i < cells.length; i++) {
      const t = hi > lo ? (r.cost[i] - lo) / (hi - lo) : 0;
      cells[i].className = i === r.best ? "best" : "";
      cells[i].style.opacity = i === r.best ? 1 : (1 - 0.82 * t).toFixed(3);
      cells[i].title = `lane ${i}: cost ${fmt(r.cost[i])}`;
    }
  }

  function geom(w, h) {
    const cx = w / 2, cy = h * 0.5, L = Math.min(w, h) * 0.26;
    return { cx, cy, L };
  }

  function drawPend() {
    const [ctx, w, h] = fit(pend);
    ctx.clearRect(0, 0, w, h);
    const { cx, cy, L } = geom(w, h);

    // the circle the bob travels on, and upright marker
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(cx, cy, L, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(cx, cy - L * 1.08); ctx.lineTo(cx, cy - L * 1.75); ctx.stroke();

    // imagined futures: lane l drawn on its own ring outside the rod
    if (P.last) {
      const { r } = P.last, n = r.traj.length;
      const inner = L * 1.14, span = L * 0.56;
      const ring = (l) => inner + (l + 0.5) * span / n;
      const path = (l) => {
        const t = r.traj[l], rad = ring(l);
        ctx.beginPath();
        for (let s = 0; s < t.length; s++) {
          const a = t[s] * E.THETA_LSB, x = cx + rad * Math.sin(a), y = cy - rad * Math.cos(a);
          const jump = s > 0 && Math.abs(t[s] - t[s - 1]) > 128;
          if (s === 0 || jump) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        const a = t[t.length - 1] * E.THETA_LSB;
        ctx.beginPath(); ctx.arc(cx + rad * Math.sin(a), cy - rad * Math.cos(a), l === r.best ? 3.5 : 1.8, 0, 7); ctx.fill();
      };
      ctx.strokeStyle = C.green; ctx.fillStyle = C.green; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.3;
      for (let l = 0; l < n; l++) if (l !== r.best) path(l);
      ctx.globalAlpha = 1; ctx.strokeStyle = C.copper; ctx.fillStyle = C.copper; ctx.lineWidth = 3;
      path(r.best);

      // torque being applied
      const u = P.last.u / 127;
      if (Math.abs(u) > 0.02) {
        ctx.lineWidth = 3; ctx.beginPath();
        const a0 = -Math.PI / 2, a1 = a0 + u * Math.PI * 0.6;
        ctx.arc(cx, cy, 26, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
      }
    }

    // the pendulum itself
    const bx = cx + L * Math.sin(P.theta), by = cy - L * Math.cos(P.theta);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(bx, by, 15, 0, 7); ctx.fill();
    ctx.fillStyle = C.panel; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = C.muted; ctx.font = "12px " + getComputedStyle(document.body).getPropertyValue("--mono");
    ctx.fillText(`${P.lanes} lanes × ${P.H} imagined steps`, 4, h - 6);
    if (!P.running) { ctx.textAlign = "right"; ctx.fillText("paused", w - 4, h - 6); ctx.textAlign = "left"; }
  }

  let acc = 0, prev = 0;
  function loop(t) {
    const dt = Math.min(200, t - (prev || t)); prev = t;
    if (P.running && P.visible) {
      acc += dt;
      while (acc >= 50) { tick(); acc -= 50; }
      drawPend();
    }
    requestAnimationFrame(loop);
  }

  // dragging the pendulum
  function pointAngle(e) {
    const r = pend.getBoundingClientRect(), { cx, cy } = geom(r.width, r.height);
    return Math.atan2(e.clientX - r.left - cx, -(e.clientY - r.top - cy));
  }
  pend.addEventListener("pointerdown", (e) => {
    P.grab = true; P.omega = 0; P.theta = pointAngle(e); P.grabT = performance.now();
    pend.setPointerCapture(e.pointerId); pend.classList.add("grab");
  });
  pend.addEventListener("pointermove", (e) => {
    if (!P.grab) return;
    const now = performance.now(), a = pointAngle(e);
    let d = a - P.theta; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const dt = Math.max(8, now - P.grabT) / 1000;
    P.omega = Math.max(-8, Math.min(8, 0.6 * P.omega + 0.4 * d / dt));
    P.theta = a; P.grabT = now;
    if (!P.running) drawPend();
  });
  const release = () => { P.grab = false; pend.classList.remove("grab"); };
  pend.addEventListener("pointerup", release);
  pend.addEventListener("pointercancel", release);

  function updateClocks() { $("r-clk").textContent = fmt(E.clocks(P.lanes, P.H)); }
  document.querySelectorAll("[data-lanes]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-lanes]").forEach((x) => x.classList.toggle("on", x === b));
    P.lanes = +b.dataset.lanes; P.best = null; buildLanes(); updateClocks();
  }));
  document.querySelectorAll("[data-h]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-h]").forEach((x) => x.classList.toggle("on", x === b));
    P.H = +b.dataset.h; P.best = null; updateClocks();
  }));
  $("drop").addEventListener("click", () => { P.theta = Math.PI - 0.05; P.omega = 0; P.best = null; });
  $("pause").addEventListener("click", (e) => {
    P.running = !P.running; e.target.textContent = P.running ? "Pause" : "Play"; drawPend();
  });
  new IntersectionObserver(([en]) => { P.visible = en.isIntersecting; }).observe(pend);
  window.addEventListener("resize", drawPend);

  buildLanes(); updateClocks(); tick(); drawPend();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { P.running = false; $("pause").textContent = "Play"; drawPend(); }
  requestAnimationFrame(loop);

  // =========================== draw a digit ===========================

  const draw = $("draw"), dctx = draw.getContext("2d");
  const D = { x: null, res: null, clock: 0, anim: 0, drawing: false, last: null };
  const PHASES = [197, 229, 262, 273];   // ends of layer 1, requant, layer 2, argmax
  const DURATION = 2400;                 // ms for all 273 clocks

  function clearDraw() { dctx.fillStyle = "#000"; dctx.fillRect(0, 0, 280, 280); }
  clearDraw();

  function pos(e) {
    const r = draw.getBoundingClientRect();
    return [(e.clientX - r.left) * 280 / r.width, (e.clientY - r.top) * 280 / r.height];
  }
  draw.addEventListener("pointerdown", (e) => {
    if (D.sample) { clearDraw(); D.sample = false; }
    D.drawing = true; D.last = pos(e); draw.setPointerCapture(e.pointerId); stroke(D.last);
  });
  draw.addEventListener("pointermove", (e) => { if (D.drawing) stroke(pos(e)); });
  const endStroke = () => { if (!D.drawing) return; D.drawing = false; const x = preprocess(); if (x) run(x); };
  draw.addEventListener("pointerup", endStroke);
  draw.addEventListener("pointercancel", endStroke);
  function stroke(p) {
    dctx.strokeStyle = "#fff"; dctx.lineWidth = 22; dctx.lineCap = dctx.lineJoin = "round";
    dctx.beginPath(); dctx.moveTo(D.last[0], D.last[1]); dctx.lineTo(p[0], p[1]); dctx.stroke();
    D.last = p;
  }
  $("clear").addEventListener("click", () => {
    clearDraw(); D.sample = false; D.x = null; D.res = null; D.clock = 0; cancelAnimationFrame(D.anim);
    $("digit").textContent = "–"; $("phase-l").textContent = "idle"; showClock(0); drawSeen(); drawHidden(); drawLogits();
  });

  // MNIST-style framing: fit the ink in 20 × 20, centre its mass in 28 × 28,
  // then the same 2 × 2 average pool and round(x * 127) as prepare_mnist.py
  function preprocess() {
    const img = dctx.getImageData(0, 0, 280, 280).data;
    let x0 = 280, y0 = 280, x1 = -1, y1 = -1;
    for (let y = 0; y < 280; y++) for (let x = 0; x < 280; x++) if (img[(y * 280 + x) * 4] > 20) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = 20 / Math.max(bw, bh);
    const tw = Math.max(1, Math.round(bw * s)), th = Math.max(1, Math.round(bh * s));
    // shrink in two steps so thin strokes are averaged rather than skipped
    const mid = document.createElement("canvas"); mid.width = tw * 4; mid.height = th * 4;
    const mctx = mid.getContext("2d"); mctx.imageSmoothingQuality = "high";
    mctx.drawImage(draw, x0, y0, bw, bh, 0, 0, tw * 4, th * 4);
    const sm = document.createElement("canvas"); sm.width = tw; sm.height = th;
    const sctx = sm.getContext("2d"); sctx.imageSmoothingQuality = "high";
    sctx.drawImage(mid, 0, 0, tw, th);
    const g = sctx.getImageData(0, 0, tw, th).data;
    let m = 0, mx = 0, my = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const v = g[(y * tw + x) * 4]; m += v; mx += v * x; my += v * y; }
    const ox = Math.round(14 - (mx / m + 0.5)), oy = Math.round(14 - (my / m + 0.5));
    const f = new Float32Array(28 * 28);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const X = x + ox, Y = y + oy;
      if (X >= 0 && X < 28 && Y >= 0 && Y < 28) f[Y * 28 + X] = g[(y * tw + x) * 4] / 255;
    }
    const out = new Array(196);
    for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
      const v = (f[(2 * y) * 28 + 2 * x] + f[(2 * y) * 28 + 2 * x + 1] + f[(2 * y + 1) * 28 + 2 * x] + f[(2 * y + 1) * 28 + 2 * x + 1]) / 4;
      out[y * 14 + x] = Math.max(0, Math.min(127, Math.round(v * 127)));
    }
    return out;
  }

  function run(x) {
    D.x = x; D.res = E.mnist(M.mnist, x);
    cancelAnimationFrame(D.anim);
    const t0 = performance.now();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (t) => {
      D.clock = reduce ? 273 : Math.min(273, Math.floor((t - t0) / DURATION * 273));
      render();
      if (D.clock < 273) D.anim = requestAnimationFrame(frame);
    };
    D.anim = requestAnimationFrame(frame);
  }

  function render() {
    const c = D.clock, r = D.res;
    showClock(c);
    $("phase-l").textContent = c < PHASES[0] ? `layer 1 · pixel ${Math.min(c, 195)}` :
      c < PHASES[1] ? `requantize · lane ${c - PHASES[0]}` :
      c < PHASES[2] ? `layer 2 · input ${Math.min(c - PHASES[1], 31)}` :
      c < PHASES[3] ? `argmax · digit ${Math.min(c - PHASES[2], 9)}` : "done";
    drawSeen(); drawHidden(); drawLogits();
    if (c >= 273) $("digit").textContent = r.digit;
    else if (c >= PHASES[2]) {
      let b = 0; const k = Math.min(c - PHASES[2], 9);
      for (let i = 1; i <= k; i++) if (r.logits[i] > r.logits[b]) b = i;
      $("digit").textContent = b;
    } else $("digit").textContent = "?";
  }

  function showClock(c) {
    $("clk").textContent = c;
    $("cursor").style.left = `calc(${(c / 273) * 100}% - 1px)`;
    const ph = document.querySelectorAll(".ph"), ends = PHASES;
    ph.forEach((el, i) => el.classList.toggle("done", c >= ends[i]));
  }

  function drawSeen() {
    const cv = $("seen"), ctx = cv.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 196, 196);
    if (!D.x) return;
    for (let i = 0; i < 196; i++) {
      const v = Math.round(D.x[i] * 255 / 127);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect((i % 14) * 14, Math.floor(i / 14) * 14, 14, 14);
    }
    if (D.clock < PHASES[0] && D.res) {
      const i = Math.min(D.clock, 195);
      ctx.strokeStyle = C.copper; ctx.lineWidth = 3;
      ctx.strokeRect((i % 14) * 14 + 1.5, Math.floor(i / 14) * 14 + 1.5, 11, 11);
    }
  }

  // 32 lanes: signed partial sums during layer 1, then h (0..127) as each lane is requantized
  function drawHidden() {
    const cv = $("hid"), [ctx, w, h] = fit(cv);
    ctx.clearRect(0, 0, w, h);
    const bw = w / 32, mid = h / 2;
    ctx.fillStyle = C.rule; ctx.fillRect(0, mid, w, 1);
    if (!D.res) return;
    const c = D.clock, r = D.res;
    let amax = 1;
    for (const a of r.acc1) amax = Math.max(amax, Math.abs(a));
    const upto = Math.min(c + 1, 196);
    for (let j = 0; j < 32; j++) {
      const x = j * bw + 1, wd = bw - 2;
      if (c >= PHASES[0] && j < c - PHASES[0] || c >= PHASES[1]) {
        const v = r.h[j] / 127 * (h - 2);
        ctx.fillStyle = C.copper; ctx.fillRect(x, h - v, wd, v);
      } else {
        let a = 0;
        for (let i = 0; i < upto; i++) a += M.mnist.W1[j * 196 + i] * D.x[i];
        const v = a / amax * (mid - 2);
        ctx.fillStyle = C.green;
        if (v >= 0) ctx.fillRect(x, mid - v, wd, v); else ctx.fillRect(x, mid + 1, wd, -v);
      }
    }
  }

  function drawLogits() {
    const el = $("logits");
    if (!el.children.length) {
      for (let k = 0; k < 10; k++) {
        const row = document.createElement("div");
        row.innerHTML = `<span>${k}</span><span class="bar"><i></i></span><span class="num"></span>`;
        el.appendChild(row);
      }
    }
    const rows = el.children, r = D.res, c = D.clock;
    if (!r || c < PHASES[1]) {
      for (const row of rows) { row.className = ""; row.querySelector("i").style.width = "0"; row.querySelector(".num").textContent = ""; }
      return;
    }
    const upto = Math.min(c - PHASES[1], 32);
    const v = [];
    for (let k = 0; k < 10; k++) {
      let a = M.mnist.B2q[k];
      for (let j = 0; j < upto; j++) a += M.mnist.W2[k * 32 + j] * r.h[j];
      v.push(a);
    }
    const lo = Math.min(...r.logits, 0), hi = Math.max(...r.logits);
    for (let k = 0; k < 10; k++) {
      rows[k].className = c >= 273 && k === r.digit ? "win" : "";
      rows[k].querySelector("i").style.width = Math.max(0, (v[k] - lo) / (hi - lo) * 100) + "%";
      rows[k].querySelector(".num").textContent = fmt(v[k]);
    }
  }

  // real MNIST test images, one per digit
  M.mnist.samples.forEach((s) => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 14;
    cv.title = `MNIST test image, label ${s.label}`;
    const ctx = cv.getContext("2d"), id = ctx.createImageData(14, 14);
    for (let i = 0; i < 196; i++) { const v = Math.round(s.x[i] * 255 / 127); id.data.set([v, v, v, 255], i * 4); }
    ctx.putImageData(id, 0, 0);
    cv.addEventListener("click", () => {
      clearDraw(); dctx.imageSmoothingEnabled = false; dctx.drawImage(cv, 0, 0, 280, 280); D.sample = true;
      run(s.x);
    });
    $("samples").appendChild(cv);
  });

  // the UNO comparison, measured in this animation's time
  const unoMin = Math.round(491000 / 273 * DURATION / 60000);
  $("uno").textContent = `The Arduino UNO needs ~491,000 clocks for the same image. At this speed that is about ${unoMin} minutes.`;

  drawSeen(); drawHidden(); drawLogits();
  let shown = false;
  new IntersectionObserver(([en]) => {
    if (en.isIntersecting && !shown) { shown = true; $("samples").children[7].click(); }
  }, { threshold: 0.4 }).observe($("digits"));
})();

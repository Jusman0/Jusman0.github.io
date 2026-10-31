// Live pendulum balanced by the port of int8-rollout-engine (see engine.js).
//
//   const pl = Planner(pendulumCanvas, { chart: chartCanvas, observe: element, onTick(last, state) {} });
//   (observe: the element whose visibility pauses/resumes the loop; default the canvas)
//
// Every 50 ms: quantize the state, build candidate plans (warm-started from the
// last winner), roll them all through the int8 model, apply the winner's first
// torque to the Pendulum-v1 physics. The pendulum canvas shows the real
// pendulum (drag the bob to push it); the optional chart canvas shows the angle
// each candidate plan predicts over the horizon.
(function () {
  "use strict";
  const E = window.Engine, M = window.MODELS;
  const DT = 0.05;                       // seconds per planner step
  const COL = {
    fg: "#fff", muted: "#8a8a8a", line: "#333", faint: "#222", bg: "#000",
    cand: "rgba(138,138,138,0.45)",
  };
  const SANS = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  // Size the backing store to CSS size x devicePixelRatio, draw in CSS pixels.
  function fit(canvas) {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return [ctx, r.width, r.height];
  }

  const lsbToDeg = (q) => q * 180 / 128;

  window.Planner = function (canvas, opt) {
    opt = opt || {};
    const chart = opt.chart || null;
    const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const P = {
      theta: Math.PI - 0.05, omega: 0, lanes: 32, H: 15, best: null, last: null,
      rng: E.mulberry32(20261029), running: !reduced, visible: true, grab: false, grabT: 0,
    };

    // ---- planner step (unchanged logic) ----
    function tick(planOnly) {
      const [tq, oq] = E.quantize(P.theta, P.omega);
      const plans = E.candidates(P.rng, P.best, P.lanes, P.H);
      const r = E.rollout(M.rollout, tq, oq, plans);
      P.best = plans[r.best];
      const u = P.best[0];
      if (!P.grab && !planOnly) [P.theta, P.omega] = E.physics(P.theta, P.omega, u);
      P.last = { tq, oq, u, r };
      if (opt.onTick) opt.onTick(P.last, P);
    }

    // ---- pendulum drawing ----
    function geom(w, h) {
      const cx = w / 2, cy = h / 2, L = Math.min(w, h) * 0.34;
      return { cx, cy, L };
    }

    function drawPendulum() {
      const [ctx, w, h] = fit(canvas);
      ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);
      const { cx, cy, L } = geom(w, h);
      const bobR = Math.max(8, L * 0.09);

      // faint marker at the upright target
      ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - L - bobR - 6); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.muted; ctx.font = "11px " + SANS;
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText("upright", cx, cy - L - bobR - 10);

      const bx = cx + L * Math.sin(P.theta), by = cy - L * Math.cos(P.theta);
      ctx.lineCap = "round";
      ctx.strokeStyle = COL.fg; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = COL.fg;
      ctx.beginPath(); ctx.arc(bx, by, bobR, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = COL.bg; ctx.strokeStyle = COL.fg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }

    // ---- prediction chart ----
    function drawChart() {
      if (!chart) return;
      const [ctx, w, h] = fit(chart);
      ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);
      const H = P.last ? P.last.r.traj[0].length - 1 : P.H;
      const padL = 46, padR = 12, padT = 12, padB = 40;
      const pw = Math.max(10, w - padL - padR), ph = Math.max(10, h - padT - padB);
      const X = (s) => padL + s / H * pw;
      const Y = (deg) => padT + deg / 180 * ph;   // 0° (upright) at the top, 180° (hanging) at the bottom

      // horizontal grid + y labels
      ctx.font = "11px " + MONO; ctx.textBaseline = "middle"; ctx.textAlign = "right";
      ctx.lineWidth = 1;
      for (const d of [0, 45, 90, 135, 180]) {
        const y = Math.round(Y(d)) + 0.5;
        ctx.strokeStyle = d === 0 ? COL.line : COL.faint;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
        ctx.fillStyle = COL.muted;
        ctx.fillText(d + "°", padL - 6, y);
      }
      ctx.font = "11px " + SANS; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillStyle = COL.muted;
      ctx.textBaseline = "top"; ctx.fillText("upright", padL + 4, Y(0) + 3);
      ctx.textBaseline = "bottom"; ctx.fillText("hanging down", padL + 4, Y(180) - 3);

      // x ticks on round times: every 0.25 s for long horizons, every step for short
      ctx.font = "11px " + MONO; ctx.textBaseline = "top";
      const every = H >= 10 ? 5 : 1, ticks = [];
      for (let s = 0; s <= H; s += every) ticks.push(s);
      if (ticks[ticks.length - 1] !== H) ticks.push(H);
      // gridline at every tick; a label only where it fits (the last one always shows)
      const lab = (s) => (s === 0 ? "now" : (s * DT).toFixed(2));
      const lastW = ctx.measureText(lab(H)).width, lastLeft = X(H) - lastW;
      let right = -Infinity;
      ctx.fillStyle = COL.muted;
      ticks.forEach((s, i) => {
        const x = Math.round(X(s)) + 0.5, last = i === ticks.length - 1;
        ctx.strokeStyle = COL.faint;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
        const tw = ctx.measureText(lab(s)).width;
        const left = i === 0 ? x : last ? x - tw : x - tw / 2;
        if (!last && (left < right + 10 || left + tw > lastLeft - 10)) return;
        ctx.textAlign = i === 0 ? "left" : last ? "right" : "center";
        ctx.fillText(lab(s), x, padT + ph + 6);
        right = left + tw;
      });
      ctx.font = "11px " + SANS; ctx.textAlign = "center";
      ctx.fillStyle = COL.muted;
      ctx.fillText("time ahead (seconds)", padL + pw / 2, padT + ph + 22);

      if (!P.last) return;
      const r = P.last.r;
      const line = (t) => {
        ctx.beginPath();
        for (let s = 0; s < t.length; s++) {
          // distance from upright, so the swing-up never jumps across the ±180° wrap
          const x = X(s), y = Y(Math.abs(lsbToDeg(t[s])));
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      ctx.save();
      ctx.beginPath(); ctx.rect(padL, padT - 2, pw, ph + 4); ctx.clip();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = COL.cand; ctx.lineWidth = 1;
      for (let l = 0; l < r.traj.length; l++) if (l !== r.best) line(r.traj[l]);
      ctx.strokeStyle = COL.fg; ctx.lineWidth = 2;
      line(r.traj[r.best]);
      ctx.restore();
    }

    function draw() { drawPendulum(); drawChart(); }

    // ---- animation loop: runs only while playing and on screen ----
    let acc = 0, prev = 0, raf = 0;
    function loop(t) {
      raf = 0;
      if (!(P.running && P.visible)) { prev = 0; return; }
      const dt = Math.min(200, t - (prev || t)); prev = t;
      acc += dt;
      while (acc >= 50) { tick(); acc -= 50; }
      draw();
      raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf && P.running && P.visible) { prev = 0; raf = requestAnimationFrame(loop); } }

    // ---- drag the bob ----
    function pointAngle(e) {
      const r = canvas.getBoundingClientRect(), g = geom(r.width, r.height);
      return Math.atan2(e.clientX - r.left - g.cx, -(e.clientY - r.top - g.cy));
    }
    canvas.addEventListener("pointerdown", (e) => {
      P.grab = true; P.omega = 0; P.theta = pointAngle(e); P.grabT = performance.now();
      canvas.setPointerCapture(e.pointerId); canvas.classList.add("grab");
      if (!P.running) draw();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!P.grab) return;
      const now = performance.now(), a = pointAngle(e);
      let d = a - P.theta; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const dt = Math.max(8, now - P.grabT) / 1000;
      P.omega = Math.max(-8, Math.min(8, 0.6 * P.omega + 0.4 * d / dt));
      P.theta = a; P.grabT = now;
      if (!P.running) draw();
    });
    const release = () => { P.grab = false; canvas.classList.remove("grab"); };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);

    if ("IntersectionObserver" in window) {
      new IntersectionObserver((ens) => {
        P.visible = ens.some((en) => en.isIntersecting);
        kick();
      }).observe(opt.observe || canvas);
    }
    window.addEventListener("resize", draw);

    tick(!P.running); draw();
    kick();

    return {
      state: P,
      setLanes(n) { P.lanes = n; P.best = null; if (!P.running) { tick(true); draw(); } },
      setH(h) { P.H = h; P.best = null; if (!P.running) { tick(true); draw(); } },
      reset() { P.theta = Math.PI - 0.05; P.omega = 0; P.best = null; if (!P.running) { tick(true); draw(); } },
      toggle() { P.running = !P.running; draw(); kick(); return P.running; },
      draw,
    };
  };
})();

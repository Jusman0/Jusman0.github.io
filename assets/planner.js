// Live pendulum balanced by the port of int8-rollout-engine (see engine.js).
// new Planner(canvas, { hud, onTick }) — hud draws the round instrument frame.
(function () {
  "use strict";
  const E = window.Engine, M = window.MODELS;
  const css = (k) => getComputedStyle(document.documentElement).getPropertyValue("--" + k).trim();

  function fit(canvas) {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return [ctx, r.width, r.height];
  }

  window.Planner = function (canvas, opt) {
    opt = opt || {};
    const C = { ink: css("ink"), muted: css("muted"), faint: css("faint"), copper: css("copper"), green: css("green"), bg: css("bg") };
    const mono = css("mono");
    const P = {
      theta: Math.PI - 0.05, omega: 0, lanes: 32, H: 15, best: null, last: null,
      rng: E.mulberry32(20261029), running: true, visible: true, grab: false, grabT: 0,
    };

    function tick() {
      const [tq, oq] = E.quantize(P.theta, P.omega);
      const plans = E.candidates(P.rng, P.best, P.lanes, P.H);
      const r = E.rollout(M.rollout, tq, oq, plans);
      P.best = plans[r.best];
      const u = P.best[0];
      if (!P.grab) [P.theta, P.omega] = E.physics(P.theta, P.omega, u);
      P.last = { tq, oq, u, r };
      if (opt.onTick) opt.onTick(P.last, P);
    }

    function geom(w, h) {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
      return { cx, cy, R, L: R * (opt.hud ? 0.47 : 0.5) };
    }

    function draw() {
      const [ctx, w, h] = fit(canvas);
      ctx.clearRect(0, 0, w, h);
      const { cx, cy, R, L } = geom(w, h);
      ctx.lineCap = "round";

      if (opt.hud) {
        // instrument bezel: 64 ticks, every 8th long, angle labels in int8 LSBs
        ctx.strokeStyle = C.copper; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, 0, 7); ctx.stroke();
        for (let i = 0; i < 64; i++) {
          const a = i / 64 * 2 * Math.PI, long = i % 8 === 0;
          const r0 = R - 2, r1 = R - (long ? 14 : 7);
          ctx.beginPath();
          ctx.moveTo(cx + r0 * Math.sin(a), cy - r0 * Math.cos(a));
          ctx.lineTo(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a));
          ctx.stroke();
        }
        ctx.globalAlpha = 0.8; ctx.fillStyle = C.copper; ctx.font = "10px " + mono;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * 2 * Math.PI, rr = R - 24, v = i < 4 ? i * 32 : (i - 8) * 32;
          ctx.fillText(String(v), cx + rr * Math.sin(a), cy - rr * Math.cos(a));
        }
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = C.faint; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.arc(cx, cy, L, 0, 7); ctx.stroke(); ctx.setLineDash([]);

      if (P.last) {
        const { r } = P.last, n = r.traj.length;
        const inner = L * 1.12, span = opt.hud ? R * 0.78 - inner : L * 0.62;
        const ring = (l) => inner + (l + 0.5) * span / n;
        const path = (l) => {
          const t = r.traj[l], rad = ring(l);
          ctx.beginPath();
          for (let s = 0; s < t.length; s++) {
            const a = t[s] * E.THETA_LSB, x = cx + rad * Math.sin(a), y = cy - rad * Math.cos(a);
            if (s === 0 || Math.abs(t[s] - t[s - 1]) > 128) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
          const a = t[t.length - 1] * E.THETA_LSB;
          ctx.beginPath(); ctx.arc(cx + rad * Math.sin(a), cy - rad * Math.cos(a), l === r.best ? 3 : 1.5, 0, 7); ctx.fill();
        };
        ctx.strokeStyle = C.green; ctx.fillStyle = C.green; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.2;
        for (let l = 0; l < n; l++) if (l !== r.best) path(l);
        ctx.globalAlpha = 1; ctx.strokeStyle = C.copper; ctx.fillStyle = C.copper; ctx.lineWidth = 2.5;
        path(r.best);

        const u = P.last.u / 127;
        if (Math.abs(u) > 0.02) {
          ctx.lineWidth = 2.5; ctx.beginPath();
          const a0 = -Math.PI / 2, a1 = a0 + u * Math.PI * 0.6;
          ctx.arc(cx, cy, L * 0.22, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
        }
      }

      const bx = cx + L * Math.sin(P.theta), by = cy - L * Math.cos(P.theta);
      ctx.strokeStyle = C.ink; ctx.lineWidth = opt.hud ? 4 : 6;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(bx, by, opt.hud ? 9 : 13, 0, 7); ctx.fill();
      ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
    }

    let acc = 0, prev = 0;
    function loop(t) {
      const dt = Math.min(200, t - (prev || t)); prev = t;
      if (P.running && P.visible) {
        acc += dt;
        while (acc >= 50) { tick(); acc -= 50; }
        draw();
      }
      requestAnimationFrame(loop);
    }

    function pointAngle(e) {
      const r = canvas.getBoundingClientRect(), g = geom(r.width, r.height);
      return Math.atan2(e.clientX - r.left - g.cx, -(e.clientY - r.top - g.cy));
    }
    canvas.addEventListener("pointerdown", (e) => {
      P.grab = true; P.omega = 0; P.theta = pointAngle(e); P.grabT = performance.now();
      canvas.setPointerCapture(e.pointerId); canvas.classList.add("grab");
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
    new IntersectionObserver(([en]) => { P.visible = en.isIntersecting; }).observe(canvas);
    window.addEventListener("resize", draw);

    tick(); draw();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) P.running = false;
    requestAnimationFrame(loop);

    return {
      state: P,
      setLanes(n) { P.lanes = n; P.best = null; },
      setH(h) { P.H = h; P.best = null; },
      drop() { P.theta = Math.PI - 0.05; P.omega = 0; P.best = null; },
      toggle() { P.running = !P.running; draw(); return P.running; },
    };
  };
})();

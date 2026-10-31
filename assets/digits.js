// The tiny-tensor-core schedule drawn clock by clock (see engine.js for the math).
// const v = new DigitView({ seen, hid, logits, digit, phase, clk, cursor, track });
// v.set(x) loads a 14x14 int image; v.show(clock) draws the state after that clock.
(function () {
  "use strict";
  const E = window.Engine, M = window.MODELS;
  const css = (k) => getComputedStyle(document.documentElement).getPropertyValue("--" + k).trim();
  const fmt = (n) => n.toLocaleString("en-US");
  const PHASES = [197, 229, 262, 273];   // ends of layer 1, requantize, layer 2, argmax

  function fit(canvas) {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return [ctx, r.width, r.height];
  }

  window.DigitView = function (el) {
    const C = { copper: css("copper"), green: css("green"), faint: css("faint") };
    let x = null, res = null, clock = 0;

    if (el.logits && !el.logits.children.length) {
      for (let k = 0; k < 10; k++) {
        const row = document.createElement("div");
        row.innerHTML = `<span>${k}</span><span class="bar"><i></i></span><span class="num"></span>`;
        el.logits.appendChild(row);
      }
    }

    function drawSeen() {
      const ctx = el.seen.getContext("2d"), s = el.seen.width / 14;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, el.seen.width, el.seen.height);
      if (!x) return;
      for (let i = 0; i < 196; i++) {
        const v = Math.round(x[i] * 255 / 127);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect((i % 14) * s, Math.floor(i / 14) * s, s, s);
      }
      if (clock < PHASES[0]) {
        const i = Math.min(clock, 195);
        ctx.strokeStyle = C.copper; ctx.lineWidth = Math.max(2, s / 5);
        ctx.strokeRect((i % 14) * s + 1, Math.floor(i / 14) * s + 1, s - 2, s - 2);
      }
    }

    // signed partial sums during layer 1, then h (0..127) as each lane is requantized
    function drawHidden() {
      const [ctx, w, h] = fit(el.hid);
      ctx.clearRect(0, 0, w, h);
      const bw = w / 32, mid = h / 2;
      ctx.fillStyle = C.faint; ctx.fillRect(0, mid, w, 1);
      if (!res) return;
      let amax = 1;
      for (const a of res.acc1) amax = Math.max(amax, Math.abs(a));
      const upto = Math.min(clock + 1, 196);
      for (let j = 0; j < 32; j++) {
        const bx = j * bw + 1, wd = Math.max(1, bw - 2);
        if ((clock >= PHASES[0] && j < clock - PHASES[0]) || clock >= PHASES[1]) {
          const v = res.h[j] / 127 * (h - 2);
          ctx.fillStyle = C.copper; ctx.fillRect(bx, h - v, wd, v);
        } else {
          let a = 0;
          for (let i = 0; i < upto; i++) a += M.mnist.W1[j * 196 + i] * x[i];
          const v = a / amax * (mid - 2);
          ctx.fillStyle = C.green;
          if (v >= 0) ctx.fillRect(bx, mid - v, wd, v); else ctx.fillRect(bx, mid + 1, wd, -v);
        }
      }
    }

    function drawLogits() {
      if (!el.logits) return;
      const rows = el.logits.children;
      if (!res || clock < PHASES[1]) {
        for (const row of rows) { row.className = ""; row.querySelector("i").style.width = "0"; row.querySelector(".num").textContent = ""; }
        return;
      }
      const upto = Math.min(clock - PHASES[1], 32), v = [];
      for (let k = 0; k < 10; k++) {
        let a = M.mnist.B2q[k];
        for (let j = 0; j < upto; j++) a += M.mnist.W2[k * 32 + j] * res.h[j];
        v.push(a);
      }
      const lo = Math.min(...res.logits, 0), hi = Math.max(...res.logits);
      for (let k = 0; k < 10; k++) {
        rows[k].className = clock >= 273 && k === res.digit ? "win" : "";
        rows[k].querySelector("i").style.width = Math.max(0, (v[k] - lo) / (hi - lo) * 100) + "%";
        rows[k].querySelector(".num").textContent = fmt(v[k]);
      }
    }

    function show(c) {
      clock = Math.max(0, Math.min(273, c));
      if (el.clk) el.clk.textContent = clock;
      if (el.cursor) el.cursor.style.left = `calc(${(clock / 273) * 100}% - 1px)`;
      if (el.track) el.track.querySelectorAll(".ph").forEach((p, i) => p.classList.toggle("done", clock >= PHASES[i]));
      if (el.phase) el.phase.textContent = !res ? "idle" :
        clock < PHASES[0] ? `layer 1 · pixel ${Math.min(clock, 195)}` :
        clock < PHASES[1] ? `rescale · unit ${clock - PHASES[0]}` :
        clock < PHASES[2] ? `layer 2 · input ${Math.min(clock - PHASES[1], 31)}` :
        clock < PHASES[3] ? `pick · digit ${Math.min(clock - PHASES[2], 9)}` : "done";
      if (el.digit) {
        if (!res) el.digit.textContent = "–";
        else if (clock >= 273) el.digit.textContent = res.digit;
        else if (clock >= PHASES[2]) {
          let b = 0; const k = Math.min(clock - PHASES[2], 9);
          for (let i = 1; i <= k; i++) if (res.logits[i] > res.logits[b]) b = i;
          el.digit.textContent = b;
        } else el.digit.textContent = "?";
      }
      drawSeen(); drawHidden(); drawLogits();
    }

    window.addEventListener("resize", () => show(clock));
    return {
      set(img) { x = img; res = img ? E.mnist(M.mnist, img) : null; show(clock); return res; },
      show,
      get clock() { return clock; },
    };
  };
  window.DigitView.PHASES = PHASES;

  // Small 14x14 thumbnail canvas of an image.
  window.DigitView.thumb = function (img) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 14;
    const ctx = cv.getContext("2d"), id = ctx.createImageData(14, 14);
    for (let i = 0; i < 196; i++) { const v = Math.round(img[i] * 255 / 127); id.data.set([v, v, v, 255], i * 4); }
    ctx.putImageData(id, 0, 0);
    return cv;
  };
})();

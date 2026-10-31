(function () {
  "use strict";
  const M = window.MODELS, $ = (id) => document.getElementById(id);
  const DURATION = 2400;   // ms for all 273 clocks
  const view = DigitView({
    seen: $("seen"), hid: $("hid"), logits: $("logits"), digit: $("digit"),
    phase: $("phase"), clk: $("clk"), cursor: $("cursor"), track: $("track"),
  });
  const draw = $("draw"), dctx = draw.getContext("2d");
  let drawing = false, last = null, sample = false, anim = 0;

  function clearDraw() { dctx.fillStyle = "#000"; dctx.fillRect(0, 0, 560, 560); }
  clearDraw();

  function pos(e) {
    const r = draw.getBoundingClientRect();
    return [(e.clientX - r.left) * 560 / r.width, (e.clientY - r.top) * 560 / r.height];
  }
  function stroke(p) {
    dctx.strokeStyle = "#fff"; dctx.lineWidth = 44; dctx.lineCap = dctx.lineJoin = "round";
    dctx.beginPath(); dctx.moveTo(last[0], last[1]); dctx.lineTo(p[0], p[1]); dctx.stroke();
    last = p;
  }
  draw.addEventListener("pointerdown", (e) => {
    if (sample) { clearDraw(); sample = false; }
    drawing = true; last = pos(e); draw.setPointerCapture(e.pointerId); stroke(last);
  });
  draw.addEventListener("pointermove", (e) => { if (drawing) stroke(pos(e)); });
  const end = () => { if (!drawing) return; drawing = false; const x = preprocess(); if (x) run(x); };
  draw.addEventListener("pointerup", end);
  draw.addEventListener("pointercancel", end);
  $("clear").addEventListener("click", () => { clearDraw(); sample = false; cancelAnimationFrame(anim); view.set(null); view.show(0); });

  // MNIST-style framing: fit the ink in 20 × 20, centre its mass in 28 × 28,
  // then the same 2 × 2 average pool and round(x * 127) as prepare_mnist.py
  function preprocess() {
    // the canvas is drawn at 2x for sharp screens; read it back at 280 x 280
    const src = document.createElement("canvas"); src.width = src.height = 280;
    src.getContext("2d").drawImage(draw, 0, 0, 280, 280);
    const img = src.getContext("2d").getImageData(0, 0, 280, 280).data;
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
    mctx.drawImage(src, x0, y0, bw, bh, 0, 0, tw * 4, th * 4);
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
    view.set(x);
    cancelAnimationFrame(anim);
    const t0 = performance.now(), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (t) => {
      const c = reduce ? 273 : Math.min(273, Math.floor((t - t0) / DURATION * 273));
      view.show(c);
      if (c < 273) anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
  }

  M.mnist.samples.forEach((s) => {
    const cv = DigitView.thumb(s.x);
    cv.title = `MNIST test image, label ${s.label}`;
    cv.addEventListener("click", () => {
      clearDraw(); dctx.imageSmoothingEnabled = false; dctx.drawImage(cv, 0, 0, 560, 560); sample = true;
      run(s.x);
    });
    $("samples").appendChild(cv);
  });

  $("uno").textContent = `The Arduino UNO needs about 491,000 clock cycles for the same image.`;
  view.show(0);
  $("samples").children[3].click();
})();

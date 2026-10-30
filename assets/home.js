(function () {
  "use strict";
  const E = window.Engine, M = window.MODELS;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString("en-US");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- hero instrument ----------
  const read = $("hud-read");
  Planner($("hud"), {
    hud: true,
    onTick(last, P) {
      read.textContent = `θ ${last.tq} · ω ${last.oq} · LANE ${last.r.best}/${P.lanes} · ${fmt(E.clocks(P.lanes, P.H))} CLK`;
    },
  });

  // ---------- statements that light up word by word ----------
  const sayings = [...document.querySelectorAll("[data-words]")].map((p) => {
    const hl = new Set((p.dataset.hl || "").split("|"));
    p.innerHTML = p.textContent.trim().split(/\s+/)
      .map((w) => `<span class="w${hl.has(w) ? " hl" : ""}">${w}</span>`).join(" ");
    return { p, words: [...p.querySelectorAll(".w")] };
  });

  // ---------- scrollytelling: the 273-clock schedule ----------
  const view = DigitView({
    seen: $("s-seen"), hid: $("s-hid"), logits: $("s-logits"), digit: $("s-digit"),
    phase: $("s-phase"), clk: $("s-clk"), cursor: $("s-cursor"), track: $("s-track"),
  });
  const samples = M.mnist.samples;
  const pick = $("s-pick");
  samples.forEach((s, i) => {
    const cv = DigitView.thumb(s.x);
    cv.title = `MNIST test image, label ${s.label}`;
    cv.addEventListener("click", () => choose(i));
    pick.appendChild(cv);
  });
  function choose(i) {
    [...pick.children].forEach((c, j) => c.classList.toggle("on", j === i));
    view.set(samples[i].x);
  }
  choose(7);
  const steps = [...document.querySelectorAll(".step")];

  function scrollStory() {
    const line = innerHeight * 0.55;
    let clock = 0, active = -1;
    for (let i = 0; i < steps.length; i++) {
      const top = steps[i].getBoundingClientRect().top;
      if (top > line) break;
      const next = i + 1 < steps.length ? steps[i + 1].getBoundingClientRect().top : top + steps[i].offsetHeight * 0.7;
      const f = Math.min(1, (line - top) / Math.max(1, next - top));
      const from = +steps[i].dataset.from, to = +steps[i].dataset.to;
      clock = Math.round(from + f * (to - from));
      active = i;
    }
    steps.forEach((s, i) => s.classList.toggle("on", i === active));
    if (clock !== view.clock) view.show(clock);
  }

  // ---------- lab card illustrations ----------
  (function ttcArt() {
    const svg = $("ttc-art");
    let s = '<path d="M20 30H300" stroke="#d4844a"/><text x="20" y="22" fill="#8b9087" stroke="none">pixel x[i] → all 32 lanes</text>';
    for (let j = 0; j < 32; j++) {
      const x = 22 + j * 8.9, h = 30 + Math.round(40 * Math.abs(Math.sin(j * 1.7)));
      s += `<path d="M${x + 3} 30V52" stroke="#283029"/><rect x="${x}" y="52" width="6" height="14" stroke="#8b9087"/>`;
      s += `<rect x="${x}" y="${170 - h}" width="6" height="${h}" fill="${j % 9 === 4 ? "#d4844a" : "#6faf87"}" stroke="none" opacity="0.85"/>`;
    }
    s += '<text x="20" y="190" fill="#8b9087" stroke="none">32 MAC lanes · 196 + 32 + 33 + 11 = 273 clocks</text>';
    svg.innerHTML = s;
  })();
  (function mpcArt() {
    // a frozen tick of the real planner from the upright state
    const rng = E.mulberry32(7);
    const plans = E.candidates(rng, null, 32, 15);
    const r = E.rollout(M.rollout, 18, -10, plans);
    const cx = 160, cy = 186;
    let s = "";
    r.traj.forEach((t, l) => {
      const rad = 58 + l * 2.7;
      const pts = t.map((v) => { const a = v * E.THETA_LSB; return `${(cx + rad * Math.sin(a)).toFixed(1)},${(cy - rad * Math.cos(a)).toFixed(1)}`; });
      const best = l === r.best;
      s += `<polyline points="${pts.join(" ")}" stroke="${best ? "#d4844a" : "#6faf87"}" stroke-width="${best ? 2.2 : 1}" opacity="${best ? 1 : 0.45}"/>`;
    });
    const a = 18 * E.THETA_LSB;
    s += `<path d="M${cx} ${cy}L${cx + 46 * Math.sin(a)} ${cy - 46 * Math.cos(a)}" stroke="#ebe7dd" stroke-width="3"/><circle cx="${cx + 46 * Math.sin(a)}" cy="${cy - 46 * Math.cos(a)}" r="6" fill="#ebe7dd"/>`;
    $("mpc-art").innerHTML = s;
  })();

  // ---------- carousel buttons ----------
  const rail = $("rail");
  document.querySelectorAll(".rail-nav button").forEach((b) => b.addEventListener("click", () => {
    const card = rail.querySelector(".card");
    rail.scrollBy({ left: +b.dataset.dir * (card.offsetWidth + 28), behavior: reduce ? "auto" : "smooth" });
  }));

  // ---------- scroll-driven bits ----------
  const bar = $("progress");
  const navLinks = [...document.querySelectorAll(".links a")];
  const sections = navLinks.map((a) => document.querySelector(a.getAttribute("href")));
  function onScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (scrollY / Math.max(1, max) * 100) + "%";
    for (const { p, words } of sayings) {
      const r = p.getBoundingClientRect();
      const f = reduce ? 1 : (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35);
      const n = Math.round(Math.max(0, Math.min(1, f)) * words.length);
      words.forEach((w, i) => w.classList.toggle("on", i < n));
    }
    scrollStory();
    let cur = -1;
    sections.forEach((s, i) => { if (s && s.getBoundingClientRect().top < innerHeight * 0.4) cur = i; });
    navLinks.forEach((a, i) => a.classList.toggle("on", i === cur));
  }
  let queued = false;
  addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; onScroll(); }); } }, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();
})();

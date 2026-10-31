(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString("en-US");
  // signed number with a real minus sign and no "-0"
  const num = (x, d) => {
    const s = Math.abs(x).toFixed(d);
    return (+s === 0 ? "" : x < 0 ? "−" : "+") + s;
  };

  const pl = Planner($("pend"), {
    chart: $("chart"),
    observe: document.querySelector(".pl-demo"),   // pause when the whole demo is off-screen
    onTick(last, P) {
      $("r-angle").textContent = num(P.theta * 180 / Math.PI, 0) + "°";
      $("r-speed").textContent = num(P.omega, 1) + " rad/s";
      $("r-torque").textContent = num(2 * last.u / 127, 2) + " N·m";
    },
  });

  const clk = () => { $("r-clk").textContent = fmt(Engine.clocks(pl.state.lanes, pl.state.H)); };
  const pick = (sel, b) => document.querySelectorAll(sel).forEach((x) => {
    x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b ? "true" : "false");
  });
  document.querySelectorAll("[data-lanes]").forEach((b) => b.addEventListener("click", () => {
    pick("[data-lanes]", b); pl.setLanes(+b.dataset.lanes); clk();
  }));
  document.querySelectorAll("[data-h]").forEach((b) => b.addEventListener("click", () => {
    pick("[data-h]", b); pl.setH(+b.dataset.h); clk();
  }));
  pick("[data-lanes]", document.querySelector('[data-lanes="32"]'));
  pick("[data-h]", document.querySelector('[data-h="15"]'));

  const pauseBtn = $("pause");
  const label = () => { pauseBtn.textContent = pl.state.running ? "Pause" : "Play"; };
  pauseBtn.addEventListener("click", () => { pl.toggle(); label(); });
  $("reset").addEventListener("click", () => pl.reset());
  label(); clk();
})();

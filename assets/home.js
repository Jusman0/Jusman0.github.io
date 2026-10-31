(function () {
  "use strict";

  // menu
  const body = document.body, burger = document.querySelector(".burger");
  const setMenu = (open) => { body.classList.toggle("menu-open", open); burger.setAttribute("aria-expanded", open); };
  burger.addEventListener("click", () => setMenu(!body.classList.contains("menu-open")));
  document.querySelectorAll(".menu a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  // typed line under the name
  const el = document.querySelector(".typed .t");
  const phrases = JSON.parse(el.dataset.phrases);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = phrases[0]; return; }
  let p = 0, i = 0, del = false;
  (function step() {
    const s = phrases[p];
    i += del ? -1 : 1;
    el.textContent = s.slice(0, i);
    let wait = del ? 35 : 70;
    if (!del && i === s.length) { del = true; wait = 1800; }
    else if (del && i === 0) { del = false; p = (p + 1) % phrases.length; wait = 400; }
    setTimeout(step, wait);
  })();
})();

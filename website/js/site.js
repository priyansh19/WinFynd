/* WinFynd website: shared behaviour for every page.
   - sets .js on <html> (pages also set it inline in <head> to avoid a flash)
   - scroll reveal (.reveal, [data-reveal-group])
   - header state on scroll, mobile menu niceties
   - [data-fit] scaling for product shots
   - WinFynd.whenActive(el, cb): run demos only while visible and the tab is shown
   Everything degrades to fully visible, static content without JavaScript. */
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");

  var reduceQuery = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var WF = (window.WinFynd = window.WinFynd || {});
  WF.reducedMotion = function () { return !!reduceQuery.matches; };

  /* ---------- Scroll reveal ---------- */
  function initReveal() {
    document.querySelectorAll("[data-reveal-group]").forEach(function (group) {
      var i = 0;
      group.querySelectorAll(".reveal").forEach(function (el) {
        if (!el.style.getPropertyValue("--i")) el.style.setProperty("--i", String(i));
        i++;
      });
    });
    var items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Header ---------- */
  function initHeader() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var ticking = false;
    function update() { header.classList.toggle("is-scrolled", window.scrollY > 8); ticking = false; }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();

    var menu = header.querySelector(".site-menu");
    if (!menu) return;
    var summary = menu.querySelector("summary");
    function close(focus) {
      if (!menu.open) return;
      menu.open = false;
      if (focus && summary) summary.focus();
    }
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(true); });
    document.addEventListener("click", function (e) { if (!menu.contains(e.target)) close(false); });
    menu.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", function () { close(false); }); });
    var wide = window.matchMedia("(min-width: 861px)");
    var onWide = function () { if (wide.matches) close(false); };
    if (wide.addEventListener) wide.addEventListener("change", onWide);
  }

  /* ---------- Fit product shots ----------
     <div data-fit="880"> is designed 880 px wide; it is zoomed down to fit its parent. */
  WF.fit = function (el) {
    var design = parseFloat(el.getAttribute("data-fit")) || el.offsetWidth;
    var parent = el.parentElement;
    if (!parent) return;
    function apply() {
      var cs = getComputedStyle(parent);
      var avail = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      var z = Math.min(1, avail / design);
      z = Math.floor(z * 1000) / 1000;
      el.style.zoom = String(z);
      el.style.setProperty("--fit", String(z));
    }
    apply();
    if ("ResizeObserver" in window) new ResizeObserver(apply).observe(parent);
    else window.addEventListener("resize", apply);
  };
  function initFit() { document.querySelectorAll("[data-fit]").forEach(WF.fit); }

  /* ---------- Demo visibility helper ----------
     WinFynd.whenActive(el, function (active) { ... })
     active is true only while el is on screen and the tab is visible. */
  WF.whenActive = function (el, cb, options) {
    var inView = false, last = null;
    var threshold = (options && options.threshold) || 0.15;
    function emit() {
      var active = inView && !document.hidden;
      if (active !== last) { last = active; cb(active); }
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { inView = e.isIntersecting; });
        emit();
      }, { threshold: threshold }).observe(el);
    } else { inView = true; }
    document.addEventListener("visibilitychange", emit);
    emit();
  };

  /* ---------- Small helpers shared by page scripts ---------- */
  WF.fmt = function (n) { return Number(n).toLocaleString("en-US"); };

  function init() { initReveal(); initHeader(); initFit(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

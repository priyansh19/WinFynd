/* WinFynd website: shared behaviour for every page.
   - sets .js on <html> (pages also set it inline in <head> to avoid a flash)
   - scroll reveal (.reveal, [data-reveal-group]); #anchor targets are shown at once so links land exactly
   - header state on scroll, mobile menu niceties
   - [data-fit] scaling for product shots
   - WinFynd.whenActive(el, cb): run demos only while visible, the tab is shown and animations aren't paused
   Everything degrades to fully visible, static content without JavaScript. */
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");

  var reduceQuery = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var WF = (window.WinFynd = window.WinFynd || {});
  WF.reducedMotion = function () { return !!reduceQuery.matches; };

  /* ---------- Scroll reveal ---------- */
  var io = null;
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
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        /* Also show anything already scrolled past (anchor links, restored scroll),
           so scrolling back up never meets hidden content. */
        if (e.isIntersecting || e.boundingClientRect.bottom <= 0) {
          e.target.classList.add("is-in"); io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Anchor links land exactly ----------
     A .reveal element waits 16 px low until it is shown, so a #link that scrolls to it (or to
     something inside it) would land 16 px off and then slide. WinFynd.revealNow(target) shows,
     with no transition: the target, its .reveal ancestors, everything before it on the page
     and whatever of it fills the first screen. It runs before the browser scrolls (page load
     with a #hash, a click on a same-page #link) and after a hashchange, which re-aligns.
     Returns true if anything was still hidden. */
  WF.revealNow = function (target) {
    if (!target || !target.getBoundingClientRect) return false;
    var reach = target.getBoundingClientRect().top + (window.innerHeight || 800);
    var list = [];
    document.querySelectorAll(".reveal:not(.is-in)").forEach(function (el) {
      var before = el.compareDocumentPosition(target) & 4; /* target follows el, or el contains it */
      var inside = el === target || (target.contains(el) && el.getBoundingClientRect().top < reach);
      if (before || inside) list.push(el);
    });
    if (!list.length) return false;
    list.forEach(function (el) {
      el.style.transition = "none";
      el.classList.add("is-in");
      if (io) io.unobserve(el);
    });
    void root.offsetHeight; /* settle the shown state while transitions are off */
    list.forEach(function (el) { el.style.transition = ""; });
    return true;
  };
  function hashTarget(hash) {
    if (!hash || hash.length < 2) return null;
    var id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch (e) { /* keep it as written */ }
    return document.getElementById(id);
  }
  function initAnchors() {
    WF.revealNow(hashTarget(location.hash));
    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.target && a.target !== "_self" || a.hasAttribute("download")) return;
      if (a.origin !== location.origin || a.pathname !== location.pathname || a.search !== location.search) return;
      WF.revealNow(hashTarget(a.hash));
    });
    window.addEventListener("hashchange", function () {
      var t = hashTarget(location.hash);
      if (WF.revealNow(t)) t.scrollIntoView({ block: "start" });
    });
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
    menu.addEventListener("focusout", function (e) { if (e.relatedTarget && !menu.contains(e.relatedTarget)) close(false); });
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
  /* ---------- Pause animations ----------
     The footer's "Pause animations" button stops every demo and CSS loop on the site
     (html.is-paused), and the choice is remembered on this device. */
  var PAUSE_KEY = "winfynd-paused", pauseListeners = [];
  try { if (localStorage.getItem(PAUSE_KEY) === "1") root.classList.add("is-paused"); } catch (e) {}
  WF.paused = function () { return root.classList.contains("is-paused"); };
  function initPause() {
    var btn = document.querySelector("[data-motion-toggle]");
    if (!btn) return;
    function sync() {
      var paused = WF.paused();
      btn.setAttribute("aria-pressed", paused ? "true" : "false");
      btn.textContent = paused ? "Play animations" : "Pause animations";
    }
    btn.hidden = false;
    sync();
    btn.addEventListener("click", function () {
      root.classList.toggle("is-paused");
      try { localStorage.setItem(PAUSE_KEY, WF.paused() ? "1" : "0"); } catch (e) {}
      sync();
      pauseListeners.forEach(function (fn) { fn(); });
    });
  }

  WF.whenActive = function (el, cb, options) {
    var inView = false, last = null;
    var threshold = (options && options.threshold) || 0.15;
    function emit() {
      var active = inView && !document.hidden && !WF.paused();
      if (active !== last) { last = active; cb(active); }
    }
    pauseListeners.push(emit);
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

  function init() { initReveal(); initAnchors(); initHeader(); initFit(); initPause(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

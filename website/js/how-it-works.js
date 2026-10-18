/* WinFynd website: How it works page behaviour.
   1. Watch step: new files arrive in the feed and finish in their kind colour.
   2. First run: the four setup screens become tabs; the window is zoomed to fit.
   3. Welcome screen cycles its sample searches; Warm-up counts files up, as in the app.
   Demos run only while on screen and the tab is visible (WinFynd.whenActive).
   Without JavaScript every screen is shown, stacked, and nothing moves. */
(function () {
  "use strict";
  var WF = window.WinFynd || {};
  function reduced() { return WF.reducedMotion ? WF.reducedMotion() : false; }
  function whenActive(el, cb) { if (WF.whenActive) WF.whenActive(el, cb); else cb(true); }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; });
  }
  function feedItem(name, kind, state, fresh) {
    return '<div class="feeditem ' + kind + (fresh ? " b" : "") + '"><span class="state ' + state + '"></span><span class="ellip">' + esc(name) + "</span></div>";
  }

  /* A ticker that runs only while its element is active. */
  function ticker(el, ms, step) {
    var timer = null;
    whenActive(el, function (active) {
      if (active && !timer && !reduced()) timer = setInterval(step, ms);
      if (!active && timer) { clearInterval(timer); timer = null; }
    });
  }

  /* ================================================================ 1. Watch feed */
  var NEW_FILES = [
    ["Standup 2026-10-18.m4a", "k-audio"], ["Q4 forecast v3.xlsx", "k-sheet"], ["INV-20931 Brightline.pdf", "k-doc"],
    ["IMG_20261018_0912.jpg", "k-img"], ["Onboarding deck.pptx", "k-slide"], ["search.rs", "k-code"],
    ["Demo walkthrough.mp4", "k-video"], ["Screenshot 2026-10-18 101422.png", "k-img"],
    ["Meeting notes 18 Oct.md", "k-doc"], ["Expenses October.csv", "k-sheet"], ["PXL_20261017_184455.jpg", "k-img"]
  ];
  function initWatch() {
    var feed = document.querySelector("[data-watch-feed]");
    if (!feed) return;
    var shown = all(".feeditem", feed).map(function (el) {
      return [el.textContent, (el.className.match(/k-[a-z]+/) || ["k-doc"])[0]];
    });
    var i = 0, flip = false;
    ticker(feed, 1700, function () {
      var next = NEW_FILES[i++ % NEW_FILES.length];
      shown.unshift(next);
      shown = shown.slice(0, 3);
      flip = !flip;
      feed.innerHTML = shown.map(function (f, n) {
        return feedItem(f[0], f[1], n === 0 ? "reading" : (n === 1 ? "done" + (flip ? " b" : "") : "done"), n === 0 && flip);
      }).join("");
    });
  }

  /* ================================================================ 2. First run tabs */
  function initFirstRun() {
    var root = document.querySelector("[data-fr]");
    if (!root) return;
    var deck = root.querySelector("[data-fr-deck]");
    var list = root.querySelector("[data-fr-tabs]");
    var tabs = all(".fr-tab", root);
    var panes = all(".fr-pane", deck);
    if (!tabs.length || tabs.length !== panes.length) return;

    /* Fit each 960 px window; on phones CSS reflows it at full size instead. */
    var phone = window.matchMedia("(max-width: 699px)");
    function fit() {
      var natural = 960;
      panes.forEach(function (p) {
        var frame = p.querySelector(".fr-fit");
        var w = p.querySelector(".fr-wf");
        if (!frame || !w || p.hidden) return;
        if (phone.matches) { w.style.removeProperty("zoom"); return; }
        var z = Math.min(1, frame.clientWidth / natural);
        w.style.zoom = String(Math.floor(z * 1000) / 1000);
      });
    }

    list.setAttribute("role", "tablist");
    list.setAttribute("aria-label", "Setup steps");
    all("li", list).forEach(function (li) { li.setAttribute("role", "presentation"); });
    tabs.forEach(function (t, i) {
      t.setAttribute("role", "tab");
      t.setAttribute("aria-controls", panes[i].id);
      panes[i].setAttribute("role", "tabpanel");
      panes[i].setAttribute("aria-labelledby", t.id);
      panes[i].setAttribute("tabindex", "0");
    });
    deck.classList.add("is-tabs");

    var current = -1;
    function select(i, focus) {
      if (i === current) return;
      current = i;
      tabs.forEach(function (t, n) {
        var on = n === i;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        panes[n].hidden = !on;
      });
      fit();
      if (focus) tabs[i].focus();
      root.dispatchEvent(new CustomEvent("fr-change", { detail: panes[i].getAttribute("data-pane") }));
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function (e) { e.preventDefault(); select(i, false); });
      t.addEventListener("keydown", function (e) {
        var n = null;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") n = (i + 1) % tabs.length;
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") n = 0;
        else if (e.key === "End") n = tabs.length - 1;
        if (n !== null) { e.preventDefault(); select(n, true); }
      });
    });
    select(0, false);
    if ("ResizeObserver" in window) new ResizeObserver(fit).observe(deck);
    else window.addEventListener("resize", fit);
    if (phone.addEventListener) phone.addEventListener("change", fit);

    initWelcome(root, deck.querySelector('[data-pane="welcome"]'));
    initWarmup(root, deck.querySelector('[data-pane="warmup"]'));
  }

  /* Welcome: the sample search changes every 3.2 s (SetupWelcome artboard). */
  function initWelcome(root, pane) {
    if (!pane) return;
    var q = pane.querySelector("[data-wq]");
    var rows = pane.querySelector("[data-wrows]");
    var demos = all("template[data-wdemo]", pane);
    if (!q || !rows || !demos.length) return;
    var t = 0;
    ticker(pane, 3200, function () {
      if (pane.hidden) return;
      t++;
      var d = demos[t % demos.length];
      q.textContent = d.getAttribute("data-q");
      rows.innerHTML = d.innerHTML;
      if (t % 2 === 1) all(".feeditem", rows).forEach(function (r) { r.classList.add("b"); });
    });
  }

  /* Warm-up: files are read one by one; chips count up and flash their kind colour (SetupWarmup artboard). */
  var WARM_FILES = [
    ["Screenshot 2026-10-18 101422.png", "k-img"], ["Q4 forecast v3.xlsx", "k-sheet"], ["Standup 2026-10-18.m4a", "k-audio"],
    ["INV-20931 Brightline.pdf", "k-doc"], ["Onboarding deck.pptx", "k-slide"], ["search.rs", "k-code"],
    ["IMG_20261018_0912.jpg", "k-img"], ["Lease_Renewal_2026_Signed.pdf", "k-doc"], ["Demo walkthrough.mp4", "k-video"],
    ["Meeting notes 18 Oct.md", "k-doc"], ["PXL_20261017_184455.jpg", "k-img"], ["Expenses October.csv", "k-sheet"]
  ];
  var TOTAL = 51204, START = 12840;
  function initWarmup(root, pane) {
    if (!pane) return;
    var feed = pane.querySelector("[data-warm-feed]");
    var doneEl = pane.querySelector("[data-done]");
    var bar = pane.querySelector("[data-bar]");
    var chips = all("[data-warm-kinds] .chip", pane);
    if (!feed || !doneEl) return;
    var t = 0;
    ticker(pane, 1200, function () {
      if (pane.hidden) return;
      t++;
      var n = WARM_FILES.length, alt = t % 2 === 1, html = "";
      for (var i = 0; i < 5; i++) {
        var f = WARM_FILES[((t - i) % n + n) % n];
        var st = i === 0 ? "reading" : (i === 1 && alt ? "done b" : "done");
        html += feedItem(f[0], f[1], st, i === 0 && alt);
      }
      feed.innerHTML = html;
      var done = START + t * 7;
      if (done > TOTAL) { t = 0; done = START; }
      var share = done / TOTAL;
      doneEl.textContent = fmt(done);
      if (bar) bar.style.width = Math.round(share * 100) + "%";
      var justRead = WARM_FILES[((t - 1) % n + n) % n][1];
      chips.forEach(function (c) {
        var total = +c.getAttribute("data-total");
        var el = c.querySelector("[data-count]");
        var v = fmt(Math.round(total * share));
        if (el && el.textContent !== v) el.textContent = v;
        if (c.getAttribute("data-kind") === justRead) {
          c.classList.remove("is-flash");
          void c.offsetWidth;
          c.classList.add("is-flash");
        }
      });
    });
  }

  function init() { initWatch(); initFirstRun(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

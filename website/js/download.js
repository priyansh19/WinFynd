/* WinFynd website: Download page only.
   - The "Installing" window fills its progress bar through the installer's real steps.
   - The setup Welcome window types its sample searches, as the app's first screen does.
   Both run only while on screen and the tab is visible (WinFynd.whenActive), and stay
   on their static, finished-looking state without JavaScript or with reduced motion. */
(function () {
  "use strict";
  var WF = window.WinFynd || {};
  if (!WF.whenActive) return;
  var reduced = WF.reducedMotion ? WF.reducedMotion() : false;
  if (reduced) return;

  /* ---------- Installing: progress through the setup steps ---------- */
  function initInstalling(win) {
    var fill = win.querySelector("[data-inst-fill]");
    var label = win.querySelector("[data-inst-label]");
    var title = win.querySelector("[data-inst-title]");
    var btn = win.querySelector("[data-inst-btn]");
    if (!fill || !label || !title) return;

    // The installer's own step labels and step count (setup/ui/setup.js), with their share of the bar.
    var STEPS = [
      { label: "Unpacking WinFynd · step 1 of 3", end: 0.1 },
      { label: "Copying files · step 2 of 3", end: 0.9 },
      { label: "Adding WinFynd to Start and Apps · step 3 of 3", end: 1 }
    ];
    var RUN = 6400, HOLD = 2600;
    var raf = 0, start = 0, offset = 0, running = false;

    function ease(t) { return 1 - Math.pow(1 - t, 1.6); }
    function render(p) {
      fill.style.width = (Math.max(0.02, p) * 100).toFixed(2) + "%";
      if (p >= 1) {
        win.classList.add("is-done");
        title.textContent = "WinFynd is installed";
        label.textContent = "It lives in the tray, next to the clock.";
        // The installer's finished screen has one button, Finish (setup/ui/setup.js).
        if (btn) { btn.textContent = "Finish"; btn.classList.add("accent"); btn.classList.remove("inst-btn-off"); }
        return;
      }
      win.classList.remove("is-done");
      if (btn) { btn.textContent = "Cancel"; btn.classList.remove("accent"); btn.classList.add("inst-btn-off"); }
      title.textContent = "Installing WinFynd";
      for (var i = 0; i < STEPS.length; i++) {
        if (p < STEPS[i].end) { label.textContent = STEPS[i].label; break; }
      }
    }
    function frame(now) {
      if (!running) return;
      var t = (now - start) % (RUN + HOLD);
      offset = t;
      render(t >= RUN ? 1 : ease(t / RUN));
      raf = requestAnimationFrame(frame);
    }
    WF.whenActive(win, function (active) {
      if (active && !running) {
        running = true;
        raf = requestAnimationFrame(function (now) { start = now - offset; frame(now); });
      } else if (!active && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    }, { threshold: 0.3 });
  }

  /* ---------- Setup Welcome: sample searches ----------
     The app's own sample lines (src/onboarding/steps/Welcome.tsx), as on How it works,
     except "Shown at 3:42": the app writes "03:42" there but 3:42 in real results. */
  var BADGE = { PDF: "#e5484d", DOC: "#2f6ce5", XLS: "#1d8f53", PPT: "#d9622b", MP4: "#c43d6a", M4A: "#7a4ae0", MD: "#6b7280", JPG: "#c03d8a" };
  var DEMOS = [
    ["receipt for the blue sofa", [
      ["PDF", "Northwind_Order_88412.pdf", "Page 2 · sofa, navy, total paid", "k-doc"],
      ["JPG", "IMG_2041.jpg", "Looks like a printed receipt", "k-img"],
      ["XLS", "Living room budget.xlsx", "Row 14 · Sofa $1,240", "k-sheet"]]],
    ["when did we agree the Q3 budget", [
      ["M4A", "Budget sync 2026-09-30.m4a", "Said at 12:05", "k-audio"],
      ["PPT", "Q3 Budget review.pptx", "Slide 7 · budget by region", "k-slide"],
      ["MD", "Q3 planning notes.md", "Line 48 · budget signed off", "k-doc"]]],
    ["dog on the beach at sunset", [
      ["JPG", "PXL_20250812_191422.jpg", "Looks like dog, beach, sunset", "k-img"],
      ["MP4", "Cornwall day 3.mp4", "Shown at 3:42", "k-video"],
      ["DOC", "Cornwall trip plan.docx", "Mentions beach walk with Biscuit", "k-doc"]]]
  ];

  function rowHTML(r, i, alt) {
    var c = BADGE[r[0]] || "#6b7280";
    return '<div class="row ' + r[3] + (i === 0 ? " on" : "") + ' feeditem setup-row' + alt + '">' +
      '<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" style="flex: none"><path d="M8.5 3.5h10l7 7v17a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-23a1 1 0 0 1 1-1z" fill="#f4f5f8"></path><path d="M18.5 3.5v6a1 1 0 0 0 1 1h6" fill="#d5d9e2"></path><rect x="3" y="14" width="18" height="10" rx="2" fill="' + c + '"></rect><text x="12" y="21.5" text-anchor="middle" fill="#fff" style="font: 700 7px Segoe UI, sans-serif">' + r[0] + '</text></svg>' +
      '<div class="txt"><span class="n ellip">' + r[1] + '</span><span class="m ellip">' + r[2] + '</span></div></div>';
  }

  function initWelcome(win) {
    var q = win.querySelector("[data-wq]");
    var rows = win.querySelector("[data-wrows]");
    if (!q || !rows) return;
    var demo = 0, timer = 0, running = false, tick = 0;

    function show(d) {
      var query = DEMOS[d][0], n = 0;
      rows.classList.add("is-stale");
      q.textContent = "";
      (function type() {
        if (!running) return;
        n++;
        q.textContent = query.slice(0, n);
        if (n < query.length) { timer = setTimeout(type, 38 + Math.random() * 40); return; }
        tick++;
        var alt = tick % 2 ? " b" : "";
        rows.innerHTML = DEMOS[d][1].map(function (r, i) { return rowHTML(r, i, alt); }).join("");
        rows.classList.remove("is-stale");
        timer = setTimeout(function () { demo = (d + 1) % DEMOS.length; show(demo); }, 3200);
      })();
    }
    WF.whenActive(win, function (active) {
      if (active && !running) {
        running = true;
        // Start with a pause on the finished first search, which is already on screen.
        timer = setTimeout(function () { demo = (demo + 1) % DEMOS.length; show(demo); }, 2400);
      } else if (!active && running) {
        running = false;
        clearTimeout(timer);
        // Leave a finished search on screen, never a half-typed one.
        q.textContent = DEMOS[demo][0];
        tick++;
        rows.innerHTML = DEMOS[demo][1].map(function (r, i) { return rowHTML(r, i, ""); }).join("");
        rows.classList.remove("is-stale");
      }
    }, { threshold: 0.3 });
  }

  function init() {
    document.querySelectorAll("[data-installing]").forEach(initInstalling);
    document.querySelectorAll("[data-welcome]").forEach(initWelcome);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

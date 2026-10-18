/* WinFynd website: Privacy page only.
   - The Indexing panel in the Settings shot reads files while it is on screen,
     with the same file list and timing as the SettingsPrivacy artboard.
   - Pointing at "Ticked" ticks the box in the uninstall window.
   - Copy buttons for the two data folders (only where the clipboard is available).
   Without JavaScript the page shows the same content, still. */
(function () {
  "use strict";
  var WF = window.WinFynd || {};

  /* ---------- Indexing panel (SettingsPrivacy artboard logic) ---------- */
  var FILES = [
    ["Screenshot 2026-10-18 101422.png", "k-img"], ["Q4 forecast v3.xlsx", "k-sheet"],
    ["Standup 2026-10-18.m4a", "k-audio"], ["INV-20931 Brightline.pdf", "k-doc"],
    ["Onboarding deck.pptx", "k-slide"], ["search.rs", "k-code"],
    ["IMG_20261018_0912.jpg", "k-img"], ["Lease_Renewal_2026_Signed.pdf", "k-doc"],
    ["Demo walkthrough.mp4", "k-video"], ["Meeting notes 18 Oct.md", "k-doc"],
    ["PXL_20261017_184455.jpg", "k-img"], ["Expenses October.csv", "k-sheet"]
  ];
  var TOTAL = 51204, START = 12840;

  function initIndexing() {
    var root = document.querySelector("[data-indexing]");
    if (!root) return;
    var feed = root.querySelector("[data-feed]");
    var queue = root.querySelector("[data-queue]");
    var done = root.querySelector("[data-done]");
    var bar = root.querySelector("[data-bar]");
    if (!feed || !WF.whenActive) return;
    var rows = Array.prototype.slice.call(feed.children);
    var t = 0, timer = null, lead = null;

    // Rows are reused, as the app does: only the newest row slides in and
    // only the file that just finished pops in its kind colour.
    function render() {
      var alt = t % 2 === 1, n = FILES.length;
      rows.forEach(function (row, i) {
        var f = FILES[((t - i) % n + n) % n];
        row.className = "feeditem " + f[1] + (i === 0 && alt ? " b" : "");
        row.firstElementChild.className = "state " + (i === 0 ? "reading" : (i === 1 && alt ? "done b" : "done"));
        row.lastElementChild.textContent = f[0];
      });
      var d = START + t;
      if (queue) queue.textContent = String(18 - (t % 5));
      if (done) done.textContent = WF.fmt ? WF.fmt(d) : String(d);
      if (bar) bar.style.width = Math.round(d / TOTAL * 100) + "%";
    }
    function tick() { t++; render(); }
    // The first file arrives a little sooner than the 1.5 s rhythm, so the
    // panel never sits still for long after it comes into view.
    function start() {
      if (timer || lead) return;
      lead = setTimeout(function () { lead = null; tick(); timer = setInterval(tick, 1500); }, 700);
    }
    function stop() {
      clearTimeout(lead); lead = null;
      clearInterval(timer); timer = null;
    }

    WF.whenActive(root, function (active) {
      root.classList.toggle("is-paused", !active);
      if (active && !(WF.reducedMotion && WF.reducedMotion())) start(); else stop();
    });
  }

  /* ---------- Uninstall: show what the box does ---------- */
  function initUninstall() {
    var check = document.querySelector("[data-check]");
    var on = document.querySelector('[data-outcome="on"]');
    var off = document.querySelector('[data-outcome="off"]');
    if (!check || !on || !off) return;
    function set(ticked) {
      check.classList.toggle("on", ticked);
      on.classList.toggle("is-active", ticked);
      off.classList.toggle("is-active", !ticked);
    }
    set(false);
    on.addEventListener("pointerenter", function () { set(true); });
    on.addEventListener("pointerleave", function () { set(false); });
  }

  /* ---------- Copy the folder paths ---------- */
  function initCopy() {
    if (!navigator.clipboard || !window.isSecureContext) return;
    var live = document.createElement("span");
    live.className = "visually-hidden";
    live.setAttribute("role", "status");
    document.body.appendChild(live);
    document.querySelectorAll("[data-copy]").forEach(function (button) {
      var label = button.querySelector("span");
      var path = button.getAttribute("data-copy");
      var reset = null;
      button.setAttribute("aria-label", "Copy " + path);
      button.hidden = false;
      button.addEventListener("click", function () {
        navigator.clipboard.writeText(path).then(function () {
          button.classList.add("is-done");
          if (label) label.textContent = "Copied";
          live.textContent = "Copied " + path + ". Paste it into File Explorer's address bar.";
          clearTimeout(reset);
          reset = setTimeout(function () {
            button.classList.remove("is-done");
            if (label) label.textContent = "Copy path";
          }, 1800);
        }, function () { /* clipboard refused: leave the button as it is */ });
      });
    });
  }

  function init() { initIndexing(); initUninstall(); initCopy(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

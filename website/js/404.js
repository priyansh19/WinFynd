/* WinFynd website: 404 page only.
   1. With <base href="/404"> (in <head>), "#main" would load /404 again instead of scrolling.
      Point same-page links at this address, whatever the visitor typed.
   2. The search box types its query once, searches, then shows "No files match yet".
      Without JavaScript, or with reduced motion, it simply shows the finished state. */
(function () {
  "use strict";

  /* 1. Same-page links */
  if (document.querySelector("base")) {
    var here = location.href.split("#")[0];
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.setAttribute("href", here + a.getAttribute("href"));
    });
  }

  /* 2. Typing demo */
  var box = document.querySelector("[data-nf]");
  var WF = window.WinFynd;
  if (!box || !WF || WF.reducedMotion()) return;
  var q = box.querySelector("[data-nf-q]");
  var line = box.querySelector("[data-nf-line]");
  var text = q.textContent;
  var started = false;
  var paused = true;
  var i = 0;
  var timer = null;

  q.textContent = "";
  box.classList.add("is-typing");

  function step() {
    timer = null;
    if (paused) return;
    if (i < text.length) {
      i++;
      q.textContent = text.slice(0, i);
      var ch = text.charAt(i - 1);
      timer = setTimeout(step, ch === " " ? 90 : 38 + Math.random() * 46);
      return;
    }
    // Search runs: the app's busy line, then the empty state.
    line.classList.add("busy");
    timer = setTimeout(function () {
      line.classList.remove("busy");
      box.classList.remove("is-typing");
      box.classList.add("is-found");
    }, 620);
  }

  WF.whenActive(box, function (active) {
    paused = !active;
    if (!active) { if (timer) { clearTimeout(timer); timer = null; } return; }
    if (box.classList.contains("is-found")) return;
    if (!started) { started = true; timer = setTimeout(step, 700); }
    else if (!timer) step();
  }, { threshold: 0.4 });
})();

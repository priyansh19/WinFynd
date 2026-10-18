/* WinFynd website: Changelog page only.
   Marks the area you are reading in each release's contents list (the sticky rail).
   Without JavaScript the list is plain links and every note is visible. */
(function () {
  "use strict";
  var groups = [];
  document.querySelectorAll(".release").forEach(function (release) {
    var items = [];
    release.querySelectorAll('.toc a[href^="#"]').forEach(function (a) {
      var el = document.getElementById(a.getAttribute("href").slice(1));
      if (el) items.push({ link: a, target: el });
    });
    if (items.length) groups.push({ items: items, current: null });
  });
  if (!groups.length) return;

  function setActive(group, item) {
    if (group.current === item) return;
    group.current = item;
    group.items.forEach(function (it) {
      var on = it === item;
      it.link.classList.toggle("is-active", on);
      if (on) it.link.setAttribute("aria-current", "location");
      else it.link.removeAttribute("aria-current");
    });
  }

  // The current area is the last one whose top has passed a line 30% down the window,
  // as long as the release itself is still on screen.
  function update() {
    var line = window.innerHeight * 0.3;
    groups.forEach(function (g) {
      var found = null;
      for (var i = 0; i < g.items.length; i++) {
        if (g.items[i].target.getBoundingClientRect().top <= line) found = g.items[i];
      }
      var last = g.items[g.items.length - 1].target.getBoundingClientRect();
      if (found && last.bottom < line * 0.5) found = null;
      setActive(g, found);
    });
  }

  var ticking = false;
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(function () { ticking = false; update(); }); }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
})();

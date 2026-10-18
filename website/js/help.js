/* WinFynd website: Help page.
   - opens a question or fix when its address is visited
   - the table of contents follows the scroll (current group opens, current item marked)
   - the find box filters the page and highlights the words
   - copy buttons for paths, the FFmpeg command and the issue template
   - Open all / Close all for the questions
   - the Settings shot records a new shortcut, key by key, while it is on screen
   Without JavaScript every answer is still on the page and every <details> still opens. */
(function () {
  "use strict";
  var WF = window.WinFynd || {};
  var doc = document;
  var reduced = function () { return WF.reducedMotion ? WF.reducedMotion() : false; };

  /* ---------- Open a question when it is linked to ----------
     The target shows at once (no rise, so the browser's scroll lands where it should),
     a question opens, and once the page has settled the target is lined up under the
     header again, unless the visitor has started scrolling. */
  var userMoved = false;
  ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (type) {
    window.addEventListener(type, function () { userMoved = true; }, { passive: true, capture: true });
  });
  function targetFromHash() {
    var id = "";
    try { id = decodeURIComponent((location.hash || "").slice(1)); } catch (e) { return null; }
    return id ? doc.getElementById(id) : null;
  }
  function showNow(el) {
    var r = el.closest(".reveal");
    while (r) { r.classList.add("is-in"); r = r.parentElement && r.parentElement.closest(".reveal"); }
    el.querySelectorAll(".reveal").forEach(function (x) { x.classList.add("is-in"); });
  }
  function openFromHash(settle) {
    var el = targetFromHash();
    if (!el) return;
    showNow(el);
    if (el.tagName === "DETAILS") el.open = true;
    if (!settle) return;
    userMoved = false;
    setTimeout(function () {
      if (!userMoved && targetFromHash() === el) el.scrollIntoView({ block: "start" });
    }, reduced() ? 60 : 420);
  }
  openFromHash(false);
  window.addEventListener("load", function () { openFromHash(true); });
  window.addEventListener("hashchange", function () { openFromHash(true); });

  /* ---------- Table of contents ---------- */
  var toc = doc.querySelector("[data-toc]");
  var tocLinks = toc ? Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]')) : [];
  var tocTargets = tocLinks.map(function (a) {
    return { link: a, el: doc.getElementById(a.getAttribute("href").slice(1)), group: a.closest("[data-toc-group]"), main: a.parentElement.classList.contains("help-toc__item") };
  }).filter(function (t) { return t.el; });

  function visible(el) { return !!(el.offsetParent || el.getClientRects().length); }

  var lastSub = null, lastGroup = null;
  function updateToc() {
    var line = (parseFloat(getComputedStyle(doc.documentElement).scrollPaddingTop) || 80) + 40;
    var current = null;
    for (var i = 0; i < tocTargets.length; i++) {
      var t = tocTargets[i];
      if (!visible(t.el)) continue;
      if (t.el.getBoundingClientRect().top <= line) current = t;
    }
    if (!current) current = tocTargets[0];
    // At the very bottom, the last section is current even if its top never reaches the line.
    if (window.innerHeight + window.scrollY >= doc.documentElement.scrollHeight - 4) {
      for (var j = tocTargets.length - 1; j >= 0; j--) { if (visible(tocTargets[j].el)) { current = tocTargets[j]; break; } }
    }
    var group = current ? current.group : null;
    var sub = current && !current.main ? current.link : null;
    if (group !== lastGroup) {
      if (lastGroup) lastGroup.classList.remove("is-current");
      if (group) group.classList.add("is-current");
      tocLinks.forEach(function (a) { if (a.parentElement.classList.contains("help-toc__item")) a.removeAttribute("aria-current"); });
      if (group) group.querySelector("a").setAttribute("aria-current", "location");
      lastGroup = group;
    }
    if (sub !== lastSub) {
      if (lastSub) lastSub.removeAttribute("aria-current");
      if (sub) sub.setAttribute("aria-current", "location");
      lastSub = sub;
    }
  }
  if (tocTargets.length) {
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(function () { ticking = false; updateToc(); }); }
    }, { passive: true });
    window.addEventListener("resize", updateToc);
    updateToc();
  }

  /* ---------- Open all / Close all ---------- */
  var qas = Array.prototype.slice.call(doc.querySelectorAll(".help-qa"));
  var allBtn = doc.querySelector("[data-qa-all]");
  var allLabel = allBtn && allBtn.querySelector("[data-qa-all-label]");
  function syncAll() {
    if (!allBtn) return;
    var shown = qas.filter(function (d) { return !d.hidden; });
    var allOpen = shown.length > 0 && shown.every(function (d) { return d.open; });
    allLabel.textContent = allOpen ? "Close all" : "Open all";
    allBtn.setAttribute("aria-expanded", allOpen ? "true" : "false");
  }
  if (allBtn) {
    allBtn.hidden = false;
    allBtn.addEventListener("click", function () {
      var open = allBtn.getAttribute("aria-expanded") !== "true";
      qas.forEach(function (d) { if (!d.hidden) d.open = open; });
      syncAll();
    });
    qas.forEach(function (d) { d.addEventListener("toggle", syncAll); });
    syncAll();
  }

  /* ---------- Copy ---------- */
  var TEMPLATE = [
    "**WinFynd version:** 0.1.0",
    "**Windows version:** ",
    "",
    "**What I did:** ",
    "**What I expected:** ",
    "**What happened:** ",
    "",
    "Log file attached: %LOCALAPPDATA%\\app.winfynd.desktop\\logs\\winfynd.log"
  ].join("\n");

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = doc.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0";
      doc.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
      doc.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error("copy failed"));
    });
  }
  var live = doc.createElement("span");
  live.className = "visually-hidden"; live.setAttribute("aria-live", "polite");
  doc.body.appendChild(live);

  doc.querySelectorAll("[data-copy], [data-copy-template]").forEach(function (btn) {
    var label = btn.querySelector("[data-copy-label]");
    var original = label ? label.textContent : "";
    var timer = null;
    btn.addEventListener("click", function () {
      var text = btn.hasAttribute("data-copy-template") ? TEMPLATE : btn.getAttribute("data-copy");
      copyText(text).then(function () {
        btn.classList.add("is-done");
        if (label) label.textContent = "Copied";
        live.textContent = "Copied to the clipboard";
        clearTimeout(timer);
        timer = setTimeout(function () {
          btn.classList.remove("is-done");
          if (label) label.textContent = original;
          live.textContent = "";
        }, 2000);
      }, function () {
        live.textContent = "Couldn’t copy. Select the text and press Ctrl + C.";
      });
    });
  });

  /* ---------- Find on this page ---------- */
  var input = doc.querySelector("[data-find-input]");
  if (input) {
    var clearBtn = doc.querySelector("[data-find-clear]");
    var status = doc.querySelector("[data-find-status]");
    var empty = doc.querySelector("[data-find-empty]");
    var term = doc.querySelector("[data-find-term]");
    var items = Array.prototype.slice.call(doc.querySelectorAll("[data-find]"));
    var groups = Array.prototype.slice.call(doc.querySelectorAll("[data-find-group]"));
    var sections = Array.prototype.slice.call(doc.querySelectorAll("[data-find-section]"));
    var fold = function (s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").replace(/[“”]/g, '"'); };
    var texts = items.map(function (el) { return fold(el.textContent.replace(/\s+/g, " ")); });
    var canHighlight = !!(window.CSS && CSS.highlights && window.Highlight);
    var openedBySearch = [];
    var tocCounts = toc ? Array.prototype.slice.call(toc.querySelectorAll(".help-toc__count")).map(function (el) {
      var a = el.closest("a");
      return { el: el, original: el.textContent, section: a ? doc.getElementById(a.getAttribute("href").slice(1)) : null };
    }) : [];

    function highlight(words) {
      if (!canHighlight) return;
      CSS.highlights.delete("help-find");
      if (!words.length) return;
      var ranges = [];
      items.forEach(function (el) {
        if (el.hidden) return;
        var walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        var node;
        while ((node = walker.nextNode()) && ranges.length < 400) {
          var text = node.nodeValue.toLowerCase();
          if (!text.trim()) continue;
          words.forEach(function (w) {
            var from = 0, at;
            while ((at = text.indexOf(w, from)) !== -1 && ranges.length < 400) {
              var r = new Range();
              r.setStart(node, at); r.setEnd(node, at + w.length);
              ranges.push(r);
              from = at + w.length;
            }
          });
        }
      });
      if (ranges.length) CSS.highlights.set("help-find", new Highlight(...ranges));
    }

    function run() {
      var raw = input.value.trim();
      var words = fold(raw).split(/\s+/).filter(function (w) { return w.length > 0; });
      if (clearBtn) clearBtn.hidden = raw.length === 0;
      var searching = words.length > 0 && raw.length >= 2;

      // Close what an earlier search opened, so each search starts clean.
      openedBySearch.forEach(function (d) { d.open = false; });
      openedBySearch = [];

      var count = 0;
      items.forEach(function (el, i) {
        var hit = !searching || words.every(function (w) { return texts[i].indexOf(w) !== -1; });
        el.hidden = !hit;
        if (hit && searching) {
          count++;
          if (el.tagName === "DETAILS" && !el.open) { el.open = true; openedBySearch.push(el); }
        }
      });
      groups.forEach(function (g) { g.hidden = searching && !g.querySelector("[data-find]:not([hidden])"); });
      sections.forEach(function (s) { s.hidden = searching && !s.querySelector("[data-find]:not([hidden])"); });
      tocLinks.forEach(function (a) {
        var target = doc.getElementById(a.getAttribute("href").slice(1));
        var li = a.parentElement;
        if (target) li.hidden = !!(searching && target.closest("[hidden]"));
      });
      // While searching, each count in the contents shows that section's matches.
      tocCounts.forEach(function (c) {
        if (!searching) { c.el.textContent = c.original; return; }
        c.el.textContent = String(c.section ? c.section.querySelectorAll("[data-find]:not([hidden])").length : 0);
      });
      if (empty) { empty.hidden = !(searching && count === 0); if (term) term.textContent = raw; }
      if (status) status.textContent = !searching ? "" : count === 0 ? "No matches" : count === 1 ? "1 match below" : count + " matches below";
      highlight(searching ? words.map(function (w) { return w; }) : []);
      syncAll();
      updateToc();
    }

    input.addEventListener("input", run);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ""; run(); }
      if (e.key === "Enter") {
        e.preventDefault();
        var first = items.filter(function (el) { return !el.hidden; })[0];
        if (first && input.value.trim()) first.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
      }
    });
    if (clearBtn) clearBtn.addEventListener("click", function () { input.value = ""; run(); input.focus(); });
    if (input.value) run();
  }

  /* ---------- Settings shot: record a new shortcut, key by key ---------- */
  var rec = doc.querySelector("[data-rec]");
  if (rec && WF.whenActive) {
    var step = 2, timer = null;
    var DELAYS = [900, 650, 1300, 2600]; // empty, Ctrl, Ctrl+Alt, waiting for the last key
    function tick() {
      step = (step + 1) % 4;
      rec.setAttribute("data-step", String(step));
      timer = setTimeout(tick, DELAYS[step]);
    }
    WF.whenActive(rec, function (active) {
      clearTimeout(timer);
      if (active && !reduced()) { timer = setTimeout(tick, 1200); }
      else { step = 2; rec.removeAttribute("data-step"); }
    }, { threshold: 0.4 });
  }
})();

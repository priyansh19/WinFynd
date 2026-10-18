/* WinFynd website: Home page behaviour.
   1. Hero demo: types real queries into the launcher and shows their results.
   2. Live index: the Settings corner feed reads files, dots pop in their kind colour.
   3. Small links: kinds legend <-> bar, Ask citations <-> sources.
   All of it runs only while visible (WinFynd.whenActive) and respects reduced motion. */
(function () {
  "use strict";
  var WF = window.WinFynd || {};
  function reduced() { return WF.reducedMotion ? WF.reducedMotion() : false; }
  function whenActive(el, cb) {
    if (WF.whenActive) WF.whenActive(el, cb); else cb(true);
  }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ================================================================ 1. Hero demo */
  function initDemo() {
    var root = document.querySelector("[data-demo]");
    if (!root) return;
    var stage = root.querySelector(".demo-stage");
    var launcher = root.querySelector("[data-launcher]");
    var qbox = root.querySelector("[data-qbox]");
    var q = root.querySelector("[data-q]");
    var ph = root.querySelector("[data-ph]");
    var line = root.querySelector("[data-line]");
    var scenes = all("[data-scene]", root);
    var chips = all("[data-demo-chip]", root);
    var pauseBtn = root.querySelector("[data-demo-pause]");
    var pauseLabel = root.querySelector("[data-pause-label]");
    var status = root.querySelector("[data-demo-status]");
    var HOLD = 5600;
    var st = { gen: 0, active: false, hover: false, focus: false, user: false, started: false };

    /* Stagger: list rows, then the preview, as in "Results arrive" (250 ms). */
    scenes.forEach(function (s) {
      var d = 0;
      all(".llist > .lgroup, .llist > .row", s).forEach(function (el) { el.style.setProperty("--d", d); d += 26; });
      all(".demo-grid .thumb", s).forEach(function (el, k) { el.style.setProperty("--d", 30 + k * 34); });
      var pd = 80;
      all(".lpreview > *", s).forEach(function (el) { el.style.setProperty("--d", pd); pd += 50; });
      var ad = 40;
      all(".ask-answer p, .ask-sources > .small, .src, .ask-note", s).forEach(function (el) {
        el.style.setProperty("--d", ad);
        ad += el.tagName === "P" ? 300 : 70;
      });
      var f = s.querySelector(".lfoot");
      if (f) f.style.setProperty("--d", 100);
      s._sel = all(".row.on, .demo-sel.is-sel", s);
    });

    /* A clock that only runs while the demo is on screen and the tab is visible.
       "hold" waits also stop while the visitor hovers, focuses or pauses the demo. */
    var waiters = [], raf = 0, last = 0;
    function loop(now) {
      var dt = last ? Math.min(now - last, 80) : 16;
      last = now;
      var running = st.active;
      var holding = running && !st.hover && !st.focus && !st.user;
      var resolved = false;
      for (var k = waiters.length - 1; k >= 0; k--) {
        var w = waiters[k];
        if (w.hold ? holding : running) {
          w.left -= dt;
          if (w.progress) w.progress(Math.min(1, 1 - w.left / w.ms));
        }
        if (w.left <= 0) { waiters.splice(k, 1); w.resolve(true); resolved = true; }
      }
      // Keep the clock running for one more frame after a wait ends: the next wait
      // is usually queued right after, and its time should count from now.
      if ((waiters.length || resolved) && st.active) raf = requestAnimationFrame(loop);
      else { raf = 0; last = 0; }
    }
    function kick() { if (!raf && waiters.length && st.active) { last = 0; raf = requestAnimationFrame(loop); } }
    function wait(ms, opt) {
      return new Promise(function (resolve) {
        waiters.push({ ms: ms, left: ms, hold: !!(opt && opt.hold), progress: opt && opt.progress, resolve: resolve });
        kick();
      });
    }
    function cancelAll() { var w = waiters; waiters = []; w.forEach(function (x) { x.resolve(false); }); }

    function setQuery(text) {
      q.textContent = text;
      ph.hidden = text.length > 0;
      qbox.scrollLeft = qbox.scrollWidth;
    }
    function setChip(i) {
      chips.forEach(function (c, k) {
        c.setAttribute("aria-pressed", k === i ? "true" : "false");
        c.style.setProperty("--p", "0");
      });
    }
    function clearSel(s) { s._sel.forEach(function (el) { el.classList.remove("on", "is-sel"); }); }
    function applySel(s) { s._sel.forEach(function (el) { el.classList.add(el.classList.contains("demo-sel") ? "is-sel" : "on"); }); }
    function typeDelay(ch, len) {
      var base = len > 34 ? 28 : 40;
      if (ch === " ") return base + 34;
      return base + ((ch.charCodeAt(0) * 7) % 26);
    }

    function showScene(i) {
      // Re-showing a scene from display:none restarts its "results arrive" animations.
      scenes.forEach(function (x) { x.hidden = true; clearSel(x); });
      void launcher.offsetWidth;
      scenes[i].hidden = false;
    }
    function showStatic(i) {
      var s = scenes[i];
      launcher.classList.toggle("is-ask", s.getAttribute("data-mode") === "ask");
      launcher.classList.remove("is-stale");
      setQuery(s.getAttribute("data-query"));
      showScene(i);
      applySel(s);
    }
    function announce(i) {
      var s = scenes[i];
      var ask = s.getAttribute("data-mode") === "ask";
      status.textContent = (ask ? "Showing the answer to: " : "Showing results for: ") + s.getAttribute("data-query");
    }

    /* Hold a scene on screen (the chip's bar fills), then move on to the next one. */
    async function hold(i, my) {
      var ask = scenes[i].getAttribute("data-mode") === "ask";
      var chip = chips[i];
      var held = await wait(ask ? HOLD + 2400 : HOLD, {
        hold: true,
        progress: function (p) { chip.style.setProperty("--p", p.toFixed(3)); }
      });
      if (!held || my !== st.gen) return;
      run((i + 1) % scenes.length, false);
    }

    async function run(i, say) {
      var my = ++st.gen;
      cancelAll();
      setChip(i);
      var s = scenes[i];
      var query = s.getAttribute("data-query");
      var ask = s.getAttribute("data-mode") === "ask";
      function alive(ok) { return ok && my === st.gen; }
      if (say) status.textContent = "";

      if (reduced()) {
        showStatic(i);
        if (say) announce(i);
        return;
      }

      // Select the old query, then type over it. The old results stay, dimmed.
      q.classList.add("is-selected");
      qbox.classList.add("is-selecting");
      if (!alive(await wait(380))) return;
      q.classList.remove("is-selected");
      qbox.classList.remove("is-selecting");
      setQuery("");
      launcher.classList.add("is-stale");
      if (ask !== launcher.classList.contains("is-ask")) {
        launcher.classList.toggle("is-ask", ask);
        if (!alive(await wait(320))) return;
      } else if (!alive(await wait(220))) return;

      for (var k = 1; k <= query.length; k++) {
        setQuery(query.slice(0, k));
        if (!alive(await wait(typeDelay(query.charAt(k - 1), query.length)))) return;
      }
      if (!alive(await wait(200))) return;
      line.classList.add("busy");
      var ok = await wait(ask ? 900 : 320);
      line.classList.remove("busy");
      if (!alive(ok)) return;

      launcher.classList.remove("is-stale");
      showScene(i);
      if (!alive(await wait(250))) return;
      applySel(s);
      if (say) announce(i);
      hold(i, my);
    }

    // Start fully open on the first search, so the launcher is never shown empty.
    launcher.classList.add("is-live");
    showStatic(0);
    if (reduced() && pauseBtn) pauseBtn.hidden = true;

    whenActive(stage, function (active) {
      st.active = active;
      if (active && !st.started) {
        st.started = true;
        if (!reduced()) hold(0, st.gen);
      }
      kick();
    });

    chips.forEach(function (c, k) {
      c.addEventListener("click", function () { run(k, true); });
    });

    root.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") st.hover = true; });
    root.addEventListener("pointerleave", function () { st.hover = false; });
    root.addEventListener("focusin", function (e) {
      var t = e.target;
      try { st.focus = t.matches(":focus-visible"); } catch (err) { st.focus = true; }
    });
    root.addEventListener("focusout", function (e) { if (!root.contains(e.relatedTarget)) st.focus = false; });

    if (pauseBtn) {
      pauseBtn.addEventListener("click", function () {
        st.user = !st.user;
        pauseBtn.setAttribute("aria-pressed", st.user ? "true" : "false");
        pauseLabel.textContent = st.user ? "Play" : "Pause";
        root.classList.toggle("is-paused", st.user);
      });
    }
  }

  /* ================================================================ 2. Live index feed */
  var FILES = [
    ["Screenshot 2026-10-18 101422.png", "k-img"], ["Q4 forecast v3.xlsx", "k-sheet"], ["Standup 2026-10-18.m4a", "k-audio"],
    ["INV-20931 Brightline.pdf", "k-doc"], ["Onboarding deck.pptx", "k-slide"], ["search.rs", "k-code"],
    ["IMG_20261018_0912.jpg", "k-img"], ["Lease_Renewal_2026_Signed.pdf", "k-doc"], ["Demo walkthrough.mp4", "k-video"],
    ["Meeting notes 18 Oct.md", "k-doc"], ["PXL_20261017_184455.jpg", "k-img"], ["Expenses October.csv", "k-sheet"]
  ];
  var KINDS = ["k-doc", "k-img", "k-code", "k-sheet", "k-slide", "k-audio", "k-video", "k-other"];

  function initLive() {
    var win = document.querySelector("[data-live]");
    if (!win) return;
    var feed = win.querySelector("[data-feed]");
    var doneEls = all("[data-done]", win);
    var queueEl = win.querySelector("[data-queue]");
    var barEl = win.querySelector("[data-bar]");
    var ringEl = win.querySelector("[data-ring]");
    var pctEl = win.querySelector("[data-pct]");
    var chips = {};
    all(".live-chips .chip", win).forEach(function (c) {
      var n = c.querySelector("[data-count]");
      chips[c.getAttribute("data-kind")] = { el: c, num: n, value: parseInt(n.textContent.replace(/,/g, ""), 10) };
    });
    var t = 0, timer = 0;

    function kindOf(el) {
      for (var i = 0; i < KINDS.length; i++) if (el.classList.contains(KINDS[i])) return KINDS[i];
      return "";
    }
    function bump(kind) {
      var c = chips[kind];
      if (!c) return;
      c.value += 1;
      c.num.textContent = fmt(c.value);
      c.el.classList.remove("is-flash");
      void c.el.offsetWidth; // restart the flash
      c.el.classList.add("is-flash");
    }
    function step() {
      t += 1;
      var top = feed.firstElementChild;
      if (top) {
        var s = top.querySelector(".state");
        s.classList.remove("reading");
        s.classList.add("done");
        bump(kindOf(top));
      }
      var f = FILES[t % FILES.length];
      var item = document.createElement("div");
      item.className = "feeditem " + f[1];
      var state = document.createElement("span");
      state.className = "state reading";
      var name = document.createElement("span");
      name.className = "ellip";
      name.textContent = f[0];
      item.appendChild(state);
      item.appendChild(name);
      feed.insertBefore(item, feed.firstChild);
      while (feed.children.length > 5) feed.removeChild(feed.lastElementChild);

      var done = 12840 + t;
      doneEls.forEach(function (el) { el.textContent = fmt(done); });
      queueEl.textContent = String(18 - (t % 5));
      var share = done / 51204;
      var deg = Math.round(share * 360);
      pctEl.textContent = Math.round(share * 100) + "%";
      barEl.style.width = (share * 100).toFixed(2) + "%";
      ringEl.style.background = "conic-gradient(#5b9bff 0deg, #9a7bff " + Math.round(deg * 0.36) + "deg, #ff6fb5 " +
        Math.round(deg * 0.7) + "deg, #ff9548 " + deg + "deg, var(--track) " + deg + "deg)";
    }
    whenActive(win, function (active) {
      if (active && !reduced()) {
        if (!timer) timer = window.setInterval(step, 1500);
      } else if (timer) {
        window.clearInterval(timer);
        timer = 0;
      }
    });
  }

  /* ================================================================ 3. Small links */
  function initKinds() {
    var panel = document.querySelector(".kinds-panel");
    if (!panel) return;
    var segs = all(".kinds-bar i", panel);
    var items = all(".kinds-legend li", panel);
    function focus(kind) {
      panel.classList.toggle("is-focus", !!kind);
      segs.concat(items).forEach(function (el) { el.classList.toggle("is-hot", el.getAttribute("data-kind") === kind); });
    }
    items.concat(segs).forEach(function (el) {
      el.addEventListener("pointerenter", function () { focus(el.getAttribute("data-kind")); });
      el.addEventListener("pointerleave", function () { focus(""); });
    });
  }

  function initCites() {
    all(".ask-launcher, [data-scene='ask']").forEach(function (box) {
      var cites = all(".cite", box);
      var srcs = all(".src", box);
      function hot(n) {
        cites.forEach(function (c) { c.classList.toggle("is-hot", c.getAttribute("data-cite") === n); });
        srcs.forEach(function (s) { s.classList.toggle("is-hot", s.getAttribute("data-src") === n); });
      }
      cites.forEach(function (c) {
        c.addEventListener("pointerenter", function () { hot(c.getAttribute("data-cite")); });
        c.addEventListener("pointerleave", function () { hot(""); });
      });
      srcs.forEach(function (s) {
        s.addEventListener("pointerenter", function () { hot(s.getAttribute("data-src")); });
        s.addEventListener("pointerleave", function () { hot(""); });
      });
    });
  }

  function init() { initDemo(); initLive(); initKinds(); initCites(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

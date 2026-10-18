// WinFynd site: a working launcher demo over a Windows desktop, plus the
// small moving parts in each section. No dependencies.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  /** Size a canvas to its box at device resolution; returns a ctx in CSS pixels. */
  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [ctx, r.width, r.height];
  }

  function grain(ctx, w, h, amount = 0.05, seed = 7) {
    const r = rng(seed);
    for (let i = 0; i < (w * h) / 26; i++) {
      ctx.fillStyle = r() > 0.5 ? `rgba(255,255,255,${amount * r()})` : `rgba(0,0,0,${amount * 1.4 * r()})`;
      ctx.fillRect(r() * w, r() * h, 1, 1);
    }
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  // ---------- Painted "photos" and frames ----------

  function dog(ctx, x, y, s, running) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = "#170f1c";
    ctx.strokeStyle = "#170f1c";
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.ellipse(0, 0, 34, 14, running ? -0.08 : 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-30, running ? -16 : -20, 12, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-44, running ? -12 : -16, 10, 5.5, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-28, -28); ctx.lineTo(-22, -40); ctx.lineTo(-20, -26); ctx.fill();
    ctx.lineWidth = 7;
    const legs = running ? [[-24, 8, -44, 26], [-12, 10, -4, 30], [18, 8, 6, 30], [28, 6, 50, 22]] : [[-22, 8, -24, 34], [-10, 10, -10, 34], [18, 8, 20, 34], [28, 6, 30, 34]];
    for (const [a, b, c, d] of legs) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(32, -4); ctx.quadraticCurveTo(48, running ? -26 : -14, 54, running ? -30 : -6); ctx.stroke();
    ctx.restore();
  }

  function paintSunset(ctx, w, h, { running = false, seed = 3, dogX = 0.36 } = {}) {
    const hz = h * 0.56;
    let g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, "#232565"); g.addColorStop(0.45, "#a2477a"); g.addColorStop(0.8, "#f08a55"); g.addColorStop(1, "#ffcf87");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, hz);
    const r = rng(seed);
    ctx.fillStyle = "rgba(255,190,150,0.35)";
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(r() * w, hz * (0.25 + r() * 0.45), w * (0.12 + r() * 0.18), h * 0.012, 0, 0, Math.PI * 2); ctx.fill(); }
    const sx = w * 0.64, sy = hz - h * 0.02, sr = Math.min(w, h) * 0.075;
    g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 5);
    g.addColorStop(0, "rgba(255,240,200,0.95)"); g.addColorStop(0.18, "rgba(255,200,120,0.6)"); g.addColorStop(1, "rgba(255,150,90,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff4d6"; ctx.beginPath(); ctx.arc(sx, sy, sr, Math.PI, 0); ctx.fill();
    g = ctx.createLinearGradient(0, hz, 0, h * 0.74);
    g.addColorStop(0, "#6a4d7d"); g.addColorStop(1, "#d98a62");
    ctx.fillStyle = g; ctx.fillRect(0, hz, w, h * 0.74 - hz);
    for (let i = 0; i < 70; i++) {
      const y = hz + r() * (h * 0.74 - hz), spread = (y - hz) * 1.4 + 8;
      ctx.fillStyle = `rgba(255,225,170,${0.25 + r() * 0.5})`;
      ctx.fillRect(sx - spread / 2 + r() * spread, y, 6 + r() * 26, 1.4);
    }
    g = ctx.createLinearGradient(0, h * 0.74, 0, h);
    g.addColorStop(0, "#c4825c"); g.addColorStop(0.2, "#9a6448"); g.addColorStop(1, "#4a2f27");
    ctx.fillStyle = g; ctx.fillRect(0, h * 0.74, w, h);
    ctx.fillStyle = "rgba(255,210,160,0.25)"; ctx.fillRect(0, h * 0.74, w, h * 0.025);
    dog(ctx, w * dogX, h * 0.83, h / 330, running);
    ctx.fillStyle = "rgba(20,12,24,0.35)"; ctx.beginPath(); ctx.ellipse(w * dogX, h * 0.83 + (h / 330) * 36, (h / 330) * 44, (h / 330) * 5, 0, 0, Math.PI * 2); ctx.fill();
    grain(ctx, w, h, 0.06, seed);
  }

  function paintReceiptPhoto(ctx, w, h) {
    let g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#5b3b26"); g.addColorStop(1, "#3a2416");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(${r() > 0.5 ? "255,220,180" : "20,10,5"},${0.05 + r() * 0.08})`;
      ctx.lineWidth = 1 + r() * 2;
      const y0 = r() * h;
      ctx.beginPath(); ctx.moveTo(0, y0);
      for (let x = 0; x <= w; x += 20) ctx.lineTo(x, y0 + Math.sin(x / 60 + i) * 4);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(w * 0.52, h * 0.52); ctx.rotate(-0.09);
    const pw = Math.min(w * 0.46, h * 0.6), ph = h * 1.05;
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#f6f3ec"; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#2a2a2a"; ctx.textAlign = "center";
    ctx.font = `700 ${pw * 0.09}px Geist, sans-serif`; ctx.fillText("NORTHWIND", 0, -ph / 2 + pw * 0.2);
    ctx.font = `500 ${pw * 0.045}px Geist Mono, monospace`; ctx.fillText("HOME FURNISHINGS", 0, -ph / 2 + pw * 0.27);
    ctx.textAlign = "left";
    const rows = [["HARLOW SOFA NAVY", "1240.00"], ["CUSHION SET x2", "86.00"], ["DELIVERY", "59.00"], ["TAX 8.25%", "114.26"]];
    ctx.font = `500 ${pw * 0.052}px Geist Mono, monospace`;
    rows.forEach(([a, b], i) => {
      const y = -ph / 2 + pw * (0.46 + i * 0.1);
      if (i === 0) { ctx.fillStyle = "rgba(255,159,67,0.35)"; ctx.fillRect(-pw * 0.42, y - pw * 0.06, pw * 0.84, pw * 0.08); }
      ctx.fillStyle = "#333"; ctx.fillText(a, -pw * 0.4, y); ctx.textAlign = "right"; ctx.fillText(b, pw * 0.4, y); ctx.textAlign = "left";
    });
    ctx.font = `700 ${pw * 0.06}px Geist Mono, monospace`;
    const ty = -ph / 2 + pw * 0.92;
    ctx.fillText("TOTAL", -pw * 0.4, ty); ctx.textAlign = "right"; ctx.fillText("$1,499.26", pw * 0.4, ty);
    ctx.fillStyle = "#bbb";
    for (let i = 0; i < 6; i++) ctx.fillRect(-pw * 0.4, ty + pw * (0.12 + i * 0.07), pw * (0.3 + r() * 0.5), pw * 0.025);
    ctx.restore();
    g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(255,230,190,0.18)"); g.addColorStop(0.5, "rgba(255,230,190,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.05, 11);
  }

  function paintRouter(ctx, w, h) {
    let g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#2d2f36"); g.addColorStop(0.62, "#3b3e47"); g.addColorStop(0.63, "#6b5642"); g.addColorStop(1, "#45362a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w * 0.5, h * 0.48); ctx.rotate(0.04);
    const bw = w * 0.62, bh = h * 0.42;
    ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
    ctx.fillStyle = "#ececef"; ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 14); ctx.fill();
    ctx.shadowColor = "transparent";
    g = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    g.addColorStop(0, "rgba(255,255,255,0.6)"); g.addColorStop(1, "rgba(0,0,0,0.12)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 14); ctx.fill();
    const lx = -bw / 2 + 22;
    ["#4ade80", "#4ade80", "#60a5fa", "#4ade80"].forEach((c, i) => { ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(lx + i * 16, bh / 2 - 18, 3, 0, Math.PI * 2); ctx.fill(); });
    ctx.shadowColor = "transparent";
    const sw = bw * 0.56, sh = bh * 0.62, sx = bw / 2 - sw - 18, sy = -bh / 2 + 16;
    ctx.fillStyle = "#fffdf6"; ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = "#cfcac0"; ctx.strokeRect(sx, sy, sw, sh);
    ctx.fillStyle = "#222";
    const f = sh * 0.13;
    ctx.font = `700 ${f}px Geist, sans-serif`; ctx.fillText("Wi-Fi", sx + 10, sy + f * 1.4);
    ctx.font = `500 ${f * 0.82}px Geist Mono, monospace`;
    ctx.fillText("SSID: Cabin-5G", sx + 10, sy + f * 2.7);
    ctx.fillStyle = "rgba(255,159,67,0.4)"; ctx.fillRect(sx + 6, sy + f * 3.2, sw - 12, f * 1.15);
    ctx.fillStyle = "#222"; ctx.fillText("Key: pinecone-2291", sx + 10, sy + f * 4);
    ctx.fillStyle = "#999"; ctx.fillText("S/N 7H2X-0418-KQ", sx + 10, sy + f * 5.3);
    ctx.restore();
    grain(ctx, w, h, 0.06, 19);
  }

  function person(ctx, x, y, s, shirt) {
    ctx.fillStyle = "#e9c6a5"; ctx.beginPath(); ctx.arc(x, y - s * 0.55, s * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2b1d15"; ctx.beginPath(); ctx.arc(x, y - s * 0.62, s * 0.33, Math.PI, 0); ctx.fill();
    ctx.fillStyle = shirt; ctx.beginPath(); ctx.ellipse(x, y + s * 0.25, s * 0.62, s * 0.42, 0, Math.PI, 0); ctx.fill();
  }

  function paintMeeting(ctx, w, h) {
    ctx.fillStyle = "#1f1f24"; ctx.fillRect(0, 0, w, h);
    const pad = w * 0.02, sideW = w * 0.24, mainW = w - sideW - pad * 3;
    ctx.fillStyle = "#fbfbfd"; ctx.fillRect(pad, pad, mainW, h - pad * 2);
    ctx.fillStyle = "#13284f"; ctx.fillRect(pad, pad, mainW, h * 0.16);
    ctx.fillStyle = "#fff"; ctx.font = `600 ${h * 0.07}px Geist, sans-serif`; ctx.fillText("Q3 budget", pad + 14, pad + h * 0.11);
    const vals = [142, 156, 180, 175], max = 200, bx = pad + mainW * 0.1, base = h - pad - h * 0.12, bw = mainW * 0.14;
    vals.forEach((v, i) => {
      const bh = (v / max) * h * 0.5;
      ctx.fillStyle = i === 2 ? "#ff9f43" : "#3f6fd1";
      ctx.fillRect(bx + i * bw * 1.5, base - bh, bw, bh);
      ctx.fillStyle = "#555"; ctx.font = `500 ${h * 0.04}px Geist Mono, monospace`;
      ctx.fillText(["Q1", "Q2", "Q3", "Q4"][i], bx + i * bw * 1.5 + bw * 0.3, base + h * 0.06);
    });
    const tiles = [["#3b4a6b", "Priya Shah", true], ["#4b3b5e", "Marco Rossi", false], ["#2f4f46", "You", false]];
    const th = (h - pad * 4) / 3;
    tiles.forEach(([bg, name, active], i) => {
      const x = w - sideW - pad, y = pad + i * (th + pad);
      ctx.fillStyle = bg; ctx.fillRect(x, y, sideW, th);
      person(ctx, x + sideW / 2, y + th * 0.72, th * 0.55, ["#d8dde8", "#e7c7a0", "#9fc3b3"][i]);
      if (active) { ctx.strokeStyle = "#8fb6ff"; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, sideW - 3, th - 3); }
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(x + 6, y + th - 22, ctx.measureText(name).width + 16, 16);
      ctx.fillStyle = "#fff"; ctx.font = `500 10px Geist, sans-serif`; ctx.fillText(name, x + 14, y + th - 10);
    });
  }

  function paintWave(ctx, w, h, seed, played) {
    const r = rng(seed), n = Math.floor(w / 4), mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = 0.35 + 0.65 * Math.abs(Math.sin(t * 9 + seed)) * (0.6 + 0.4 * Math.sin(t * 31));
      const a = Math.max(2, env * (0.4 + r() * 0.6) * (h * 0.42));
      ctx.fillStyle = t < played ? "#ff9f43" : "rgba(255,255,255,0.28)";
      ctx.fillRect(i * 4, mid - a, 2.2, a * 2);
    }
    ctx.fillStyle = "#fff"; ctx.fillRect(played * w - 1, 4, 2, h - 8);
  }

  // ---------- Previews ----------

  const PAINT = {
    sunset: (ctx, w, h) => paintSunset(ctx, w, h),
    sunsetRun: (ctx, w, h) => paintSunset(ctx, w, h, { running: true, seed: 5, dogX: 0.5 }),
    receipt: paintReceiptPhoto,
    router: paintRouter,
    meeting: paintMeeting,
  };

  const DOCS = {
    invoice: `<div class="page">
      <h4>Northwind Home Furnishings</h4>
      <div class="muted">Order confirmation · No. 88412 · Placed 2 March 2026</div>
      <div class="rule"></div>
      <div class="muted">Ship to: 22 Alder St, Apt 4B, Portland OR 97209 · Delivery Fri 14 March</div>
      <table>
        <tr class="hit"><td>Harlow 3-seat <mark>sofa, navy blue</mark> velvet</td><td>1</td><td>$1,240.00</td></tr>
        <tr><td>Cushion set, rust</td><td>2</td><td>$86.00</td></tr>
        <tr><td>White-glove delivery</td><td>1</td><td>$59.00</td></tr>
        <tr><td>Sales tax 8.25%</td><td></td><td>$114.26</td></tr>
        <tr class="total"><td>Total paid · Visa •••• 4417</td><td></td><td>$1,499.26</td></tr>
      </table>
      <div class="rule"></div>
      <div class="bar mid"></div><div class="bar"></div><div class="bar short"></div>
    </div>`,
    budget: `<div class="page">
      <h4>Living room refresh</h4>
      <div class="muted">Budget · last edited 28 Feb 2026</div>
      <div class="rule"></div>
      <table>
        <tr class="hit"><td>Sofa (Harlow, <mark>blue</mark>)</td><td>Ordered</td><td>$1,240</td></tr>
        <tr><td>Wool rug 8×10</td><td>Shortlist</td><td>$320</td></tr>
        <tr><td>Floor lamp</td><td>Bought</td><td>$145</td></tr>
        <tr><td>Paint, 2 gal</td><td>Bought</td><td>$96</td></tr>
        <tr class="total"><td>Total</td><td></td><td>$1,801</td></tr>
      </table>
      <div class="rule"></div><div class="bar"></div><div class="bar short"></div>
    </div>`,
  };

  function preview(item) {
    const el = h(`<div class="pv"></div>`);
    const p = item.pv;
    if (p.type === "doc") {
      el.append(h(`<div class="doc">${DOCS[p.doc]}</div>`), h(`<span class="pagenum">${p.page}</span>`));
    } else if (p.type === "photo") {
      el.append(h(`<canvas></canvas>`), h(`<span class="pv-badge">${p.badge}</span>`));
      requestAnimationFrame(() => { const [ctx, w, hh] = fit($("canvas", el)); PAINT[p.paint](ctx, w, hh); });
    } else if (p.type === "audio") {
      const lines = p.lines.map(([t, who, text, now]) => `<p class="${now ? "now" : ""}"><time>${t}</time><span><b>${who}</b> ${text}</span></p>`).join("");
      el.append(h(`<div class="audio"><canvas></canvas><div class="transcript">${lines}</div></div>`));
      requestAnimationFrame(() => {
        const c = $("canvas", el), [ctx, w, hh] = fit(c);
        if (calm) return paintWave(ctx, w, hh, p.seed, p.at);
        const t0 = performance.now();
        const step = (t) => { const k = Math.min(1, (t - t0) / 900); paintWave(ctx, w, hh, p.seed, p.at * (1 - Math.pow(1 - k, 3))); if (k < 1 && c.isConnected) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      });
    } else if (p.type === "video") {
      const ticks = Array.from({ length: 48 }, (_, i) => `<i class="${i === p.frame ? "hit" : ""}" style="left:${(i / 47) * 100}%"></i>`).join("");
      el.append(h(`<div class="video"><canvas></canvas><div class="scrub"><span>${p.time}</span><div class="track"><div class="played" style="width:0"></div>${ticks}</div><span>${p.length}</span></div></div>`), h(`<span class="pv-badge" style="bottom:50px">${p.badge}</span>`));
      requestAnimationFrame(() => {
        const [ctx, w, hh] = fit($("canvas", el)); PAINT[p.paint](ctx, w, hh);
        requestAnimationFrame(() => ($(".played", el).style.width = `${(p.frame / 47) * 100}%`));
      });
    } else if (p.type === "slide") {
      el.append(h(`<div class="doc" style="background:#24242a"><div class="slide"><h5>Q3 budget review</h5><span class="sub">Finance sync · 30 Sep 2026 · $k</span>
        <div class="bars"><div style="height:62%"><span>142</span><em>Q1</em></div><div style="height:70%;animation-delay:.08s"><span>156</span><em>Q2</em></div><div class="hl" style="height:82%;animation-delay:.16s"><span>180</span><em>Q3</em></div><div style="height:78%;animation-delay:.24s"><span>175</span><em>Q4 plan</em></div></div>
        <div class="callout">Agreed: Q3 budget of $180k, approved in the 30 Sep sync</div></div></div>`), h(`<span class="pagenum">Slide 12 of 18</span>`));
    } else if (p.type === "note") {
      el.append(h(`<div class="note">${p.html}</div>`));
    }
    return el;
  }

  // ---------- Demo scenes (illustrative files) ----------

  const KIND = { PDF: "#d9483b", DOCX: "#2b6fd6", JPG: "#2f9e5a", M4A: "#d68a1f", MP4: "#8a4fd8", PPTX: "#d0612a", MD: "#5f6b7a" };
  const AUDIO = { type: "audio", seed: 4, at: 0.52, lines: [
    ["11:48", "Marco", "the vendor quote came back at one ninety.", false],
    ["11:57", "Priya", "That's over. Can we hold design at forty?", false],
    ["12:05", "Priya", "Okay, so <mark>we're agreed on 180 for the Q3 budget</mark>. I'll send final numbers Friday.", true],
    ["12:14", "Marco", "Works for me. Let's close it.", false],
  ] };
  const SCENES = [
    { chip: "receipt for the blue sofa", q: "receipt for the blue sofa", ms: 38, groups: [
      ["Documents", [
        { k: "PDF", name: "Order-88412-Northwind.pdf", path: "Documents\\Receipts\\2026", why: "Meaning match on <b>page 2</b>", score: "0.91", pv: { type: "doc", doc: "invoice", page: "Page 2 of 3" } },
        { k: "DOCX", name: "Living room budget.docx", path: "Documents\\Home", why: "Exact words <b>sofa, blue</b>", score: "0.74", pv: { type: "doc", doc: "budget", page: "Page 1 of 1" } },
      ]],
      ["Photos", [
        { k: "JPG", name: "IMG_2041.jpg", path: "Pictures\\Camera Roll", why: "Looks like <b>a printed receipt</b>", score: "0.69", pv: { type: "photo", paint: "receipt", badge: "Looks like: <b>receipt, Northwind, sofa</b>" } },
      ]],
    ] },
    { chip: "dog on the beach at sunset", q: "dog on the beach at sunset", ms: 44, groups: [
      ["Photos", [
        { k: "JPG", name: "PXL_20250812_191422.jpg", path: "Pictures\\Cornwall 2025", why: "Looks like <b>dog, beach, sunset</b>", score: "0.88", pv: { type: "photo", paint: "sunset", badge: "Looks like: <b>dog, beach, sunset</b>" } },
        { k: "JPG", name: "PXL_20250812_191530.jpg", path: "Pictures\\Cornwall 2025", why: "Looks like <b>dog running on sand</b>", score: "0.84", pv: { type: "photo", paint: "sunsetRun", badge: "Looks like: <b>dog running, shoreline</b>" } },
      ]],
      ["Video", [
        { k: "MP4", name: "Cornwall day 3.mp4", path: "Videos", why: "Shown at <b>03:42</b>", score: "0.79", pv: { type: "video", paint: "sunsetRun", frame: 31, time: "03:42", length: "05:58", badge: "Frame 32 of 48 · <b>03:42</b>" } },
      ]],
    ] },
    { chip: "when did we agree the Q3 budget", q: "when did we agree the Q3 budget", ms: 52, groups: [
      ["Recordings", [
        { k: "M4A", name: "Finance sync 2026-09-30.m4a", path: "Documents\\Recordings", why: "Said at <b>12:05</b>", score: "0.93", pv: AUDIO },
      ]],
      ["Video", [
        { k: "MP4", name: "Q3 planning (Teams).mp4", path: "Videos\\Meetings", why: "Said at <b>41:18</b>", score: "0.81", pv: { type: "video", paint: "meeting", frame: 33, time: "41:18", length: "58:40", badge: "Said at <b>41:18</b>" } },
      ]],
      ["Documents", [
        { k: "PPTX", name: "Q3 budget review.pptx", path: "Desktop", why: "Meaning match on <b>slide 12</b>", score: "0.77", pv: { type: "slide" } },
      ]],
    ] },
    { chip: "Ask: when does my lease end?", q: "when does my apartment lease end?", ask: true, ms: 1180,
      answer: "Your lease at 22 Alder St, Apt 4B ends on <b>31 August 2027</b>.<sup>1</sup> You need to give 60 days' written notice, so by 2 July 2027.<sup>1</sup> If you renew, rent goes up to $2,340 a month.<sup>2</sup>",
      sources: [
        { k: "PDF", name: "Lease_Agreement_2025.pdf", why: "<b>[1]</b> Page 4, section 3" },
        { k: "PDF", name: "Renewal offer 2027.pdf", why: "<b>[2]</b> Page 1" },
        { k: "MD", name: "Apartment notes.md", why: "Mentions <b>move-out</b>" },
      ] },
    { chip: "wifi password for the cabin", q: "wifi password for the cabin", ms: 29, groups: [
      ["Notes", [
        { k: "MD", name: "cabin-notes.md", path: "Documents\\Notes", why: "Exact words <b>Wi-Fi, cabin</b>", score: "0.86", pv: { type: "note", html: `<span class="h"># Cabin, Lake Tahoe</span>\nCheck-in after 4pm, lockbox code 0418\nHot tub cover: clips on the left side\n\n<span class="h">## <mark>Wi-Fi</mark></span>\nNetwork: Cabin-5G\n<mark>Password: pinecone-2291</mark>\n\nTrash pickup: Tuesday morning\nNearest groceries: Raley's, 12 min` } },
      ]],
      ["Photos", [
        { k: "JPG", name: "IMG_1187.jpg", path: "Pictures\\Tahoe", why: "Looks like <b>a router label</b>", score: "0.72", pv: { type: "photo", paint: "router", badge: "Looks like: <b>router, Wi-Fi sticker</b>" } },
      ]],
    ] },
  ];

  // ---------- Launcher demo ----------

  const body = $("#body"), qEl = $("#q"), stats = $("#stats"), chipsEl = $("#chips");
  let gen = 0, sceneIndex = 0, autoplay = !calm, resumeTimer = 0;

  const chips = SCENES.map((s, i) => {
    const b = h(`<button type="button" class="chip" aria-pressed="false">${esc(s.chip)}<span class="fill"></span></button>`);
    b.addEventListener("click", () => { pauseAuto(); play(i); });
    chipsEl.append(b);
    return b;
  });

  function pauseAuto() {
    autoplay = false;
    chipsEl.classList.add("paused");
    clearTimeout(resumeTimer);
    if (!calm) resumeTimer = setTimeout(() => { autoplay = true; chipsEl.classList.remove("paused"); next(); }, 16000);
  }

  function select(scene, list, idx) {
    const items = $$(".l-item", list);
    const item = items[idx];
    if (!item) return;
    const sel = $(".l-sel", list);
    sel.style.transform = `translateY(${item.offsetTop - 8}px)`;
    sel.style.opacity = 1;
    const pane = $(".l-preview", body);
    const data = item._data;
    pane.replaceChildren(preview(data), h(`<div class="pv-meta"><span>C:\\Users\\alex\\${esc(data.path)}\\${esc(data.name)}</span><span>${esc(data.score)}</span></div>`));
    list._idx = idx;
  }

  function renderResults(scene) {
    const list = h(`<div class="l-results"><div class="l-sel" style="opacity:0"></div></div>`);
    const pane = h(`<div class="l-preview"></div>`);
    let n = 0, delay = 0;
    for (const [group, items] of scene.groups) {
      list.append(h(`<div class="l-group">${group}</div>`));
      for (const it of items) {
        const row = h(`<div class="l-item" style="animation-delay:${delay}ms"><span class="l-ico" style="background:${KIND[it.k]}">${it.k}</span><span class="l-txt"><span class="l-name">${esc(it.name)}</span><span class="l-why">${it.why}</span></span><span class="l-score">${it.score}</span></div>`);
        row._data = it;
        const idx = n++;
        row.addEventListener("mouseenter", () => { if (list._idx !== idx) { pauseAuto(); select(scene, list, idx); } });
        row.addEventListener("click", () => { pauseAuto(); select(scene, list, idx); });
        list.append(row);
        delay += 70;
      }
    }
    body.replaceChildren(list, pane);
    list._count = n;
    select(scene, list, 0);
    stats.textContent = `${n} results · ${scene.ms} ms · 51,204 files`;
    return list;
  }

  async function streamAnswer(el, html, my) {
    const parts = html.split(/(<[^>]+>[^<]*<\/[^>]+>|\s+)/).filter(Boolean);
    for (const part of parts) {
      if (my !== gen) return;
      el.insertAdjacentHTML("beforeend", part);
      if (!calm && part.trim()) await sleep(part.startsWith("<sup") ? 60 : 38);
    }
  }

  async function renderAsk(scene, my) {
    const box = h(`<div class="ask"><div class="ask-model">gemma4 on this PC · reading 3 sources</div><p class="ask-a"></p><div class="ask-src"></div></div>`);
    body.replaceChildren(box);
    stats.textContent = `Answered in 1.2 s · nothing sent online`;
    await streamAnswer($(".ask-a", box), scene.answer, my);
    if (my !== gen) return;
    scene.sources.forEach((s, i) => {
      $(".ask-src", box).append(h(`<div class="src" style="animation-delay:${i * 90}ms"><span class="l-ico" style="background:${KIND[s.k]}">${s.k}</span><span class="l-txt"><span class="l-name">${esc(s.name)}</span><span class="l-why">${s.why}</span></span></div>`));
    });
  }

  const swapItems = $$("#swapper > span");
  function swapTo(i) {
    swapItems.forEach((s, j) => {
      s.classList.toggle("out", s.classList.contains("on") && j !== i);
      s.classList.toggle("on", j === i);
    });
    setTimeout(() => swapItems.forEach((s) => s.classList.remove("out")), 650);
  }

  async function play(i) {
    const my = ++gen;
    sceneIndex = i;
    const scene = SCENES[i];
    chips.forEach((c, j) => { c.setAttribute("aria-pressed", String(j === i)); c.style.setProperty("--dur", "8.5s"); });
    // Restart the progress bar on the active chip.
    const fill = $(".fill", chips[i]); fill.style.animation = "none"; void fill.offsetWidth; fill.style.animation = "";
    swapTo(i);
    $("#mode-search").classList.toggle("on", !scene.ask);
    $("#mode-ask").classList.toggle("on", !!scene.ask);
    if (calm) {
      qEl.textContent = scene.q;
      scene.ask ? renderAsk(scene, my) : renderResults(scene);
      return;
    }
    const old = qEl.textContent;
    for (let n = old.length; n >= 0; n -= 2) { if (my !== gen) return; qEl.textContent = old.slice(0, n); await sleep(12); }
    body.style.transition = "opacity .25s"; body.style.opacity = "0.25";
    for (let n = 1; n <= scene.q.length; n++) { if (my !== gen) return; qEl.textContent = scene.q.slice(0, n); await sleep(34 + Math.random() * 40); }
    await sleep(220);
    if (my !== gen) return;
    body.style.opacity = "1";
    if (scene.ask) {
      await renderAsk(scene, my);
    } else {
      const list = renderResults(scene);
      for (let k = 1; k < list._count; k++) {
        await sleep(2000);
        if (my !== gen || !autoplay) return;
        select(scene, list, k);
      }
    }
    await sleep(2400);
    if (my === gen && autoplay) next();
  }
  function next() { play((sceneIndex + 1) % SCENES.length); }

  // Start once the stage is on screen.
  play(0);

  // ---------- Wallpaper: slow Bloom-style ribbons ----------

  const wall = $("#wall");
  let wallCtx, ww, wh, wallOn = true;
  function sizeWall() { [wallCtx, ww, wh] = fit(wall); }
  function drawWall(t) {
    const ctx = wallCtx;
    const g = ctx.createLinearGradient(0, 0, 0, wh);
    g.addColorStop(0, "#030616"); g.addColorStop(1, "#0a1a44");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = g; ctx.fillRect(0, 0, ww, wh);
    ctx.globalCompositeOperation = "lighter";
    const cx = ww * 0.5, cy = wh * 0.78;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.36 + Math.sin(t / 5200 + i) * 0.06;
      const len = Math.max(ww, wh) * (0.62 + 0.06 * Math.sin(t / 4000 + i * 2));
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(a);
      const gr = ctx.createLinearGradient(0, 0, len, 0);
      const hue = i === 5 ? "255,150,80" : i % 2 ? "70,140,255" : "40,90,230";
      gr.addColorStop(0, `rgba(${hue},0)`); gr.addColorStop(0.35, `rgba(${hue},0.32)`); gr.addColorStop(1, `rgba(${hue},0)`);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.ellipse(len * 0.5, 0, len * 0.5, len * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  function wallLoop(t) { if (wallOn) drawWall(t); if (!calm) requestAnimationFrame(wallLoop); }
  sizeWall(); drawWall(0);
  if (!calm) requestAnimationFrame(wallLoop);
  addEventListener("resize", () => { sizeWall(); drawWall(performance.now()); });
  new IntersectionObserver(([e]) => (wallOn = e.isIntersecting)).observe(wall);

  // ---------- Live index feed ----------

  const FEED = [
    ["+", "Invoice_NW-88412.pdf", "3 pages · 9 passages"],
    ["I", "PXL_20261018_093958.jpg", "photo · 1 vector"],
    ["~", "Q4 forecast v3.xlsx", "4 sheets · 31 passages"],
    ["T", "Finance sync 2026-10-17.m4a", "transcribed 38:12"],
    ["+", "Lease_Agreement_2025.pdf", "12 pages · 41 passages"],
    ["I", "Screenshot 2026-10-18 094102.png", "photo · 1 vector"],
    ["~", "thesis-draft.docx", "3 passages changed"],
    ["V", "Cornwall day 3.mp4", "48 frames · speech"],
    ["+", "Boarding pass LIS.pdf", "1 page · 2 passages"],
    ["+", "banana-bread.md", "note · 4 passages"],
    ["I", "IMG_1187.jpg", "photo · 1 vector"],
    ["~", "main.rs", "code · 18 passages"],
  ];
  const KCOL = { "+": "var(--ok)", "~": "var(--bloom-2)", I: "var(--ember)", T: "var(--ember)", V: "var(--ember)" };
  const log = $("#log"), countEl = $("#count");
  let fi = 0, files = 51204, secs = 9 * 3600 + 41 * 60;
  function feed() {
    const [k, f, m] = FEED[fi++ % FEED.length];
    secs += 1 + Math.floor(Math.random() * 3);
    const t = `${String(Math.floor(secs / 3600)).padStart(2, "0")}:${String(Math.floor(secs / 60) % 60).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
    log.prepend(h(`<div><time>${t}</time><span class="k" style="color:${KCOL[k]}">${k}</span><span class="f">${esc(f)}</span><span class="m">${m}</span></div>`));
    while (log.children.length > 16) log.lastElementChild.remove();
    if (k !== "~") files++;
    countEl.textContent = `${files.toLocaleString("en-US")} files`;
  }
  for (let i = 0; i < 9; i++) feed();
  let feedOn = false;
  new IntersectionObserver(([e]) => (feedOn = e.isIntersecting)).observe(log);
  if (!calm) setInterval(() => feedOn && feed(), 1300);

  const flowSteps = $$("#flow .flow-step");
  let lit = -1;
  if (calm) flowSteps.forEach((s) => s.classList.add("lit"));
  else setInterval(() => {
    if (!feedOn) return;
    lit = (lit + 1) % (flowSteps.length + 2);
    flowSteps.forEach((s, i) => s.classList.toggle("lit", i <= lit && lit < flowSteps.length + 1));
  }, 800);

  // ---------- Formats tabs ----------

  const TABS = [
    { label: "Documents", text: "PDFs, Word, PowerPoint, Excel and notes, labelled by page and slide.", ext: "PDF · DOCX · PPTX · XLSX · CSV · ODT · MD · HTML", item: SCENES[0].groups[0][1][0] },
    { label: "Photos", text: "Found by what's in the frame. The file name can be anything.", ext: "JPG · PNG · WEBP · GIF · BMP", item: SCENES[1].groups[0][1][0] },
    { label: "Recordings", text: "Transcribed by Whisper on your PC and searched by what was said.", ext: "MP3 · M4A · WAV · FLAC · OGG", item: SCENES[2].groups[0][1][0] },
    { label: "Video", text: "Speech plus 48 sampled frames per video, so you can find a moment by sight.", ext: "MP4 · MKV · MOV with FFmpeg", item: SCENES[1].groups[1][1][0] },
  ];
  const tabList = $("#tabs .tab-list"), tabView = $("#tab-view"), tabsEl = $("#tabs");
  let tabIdx = 0, tabTimer = 0, tabsSeen = false;
  const tabBtns = TABS.map((t, i) => {
    const b = h(`<button type="button" class="tab" role="tab" aria-selected="false"><strong>${t.label}</strong><span>${t.text}</span><code>${t.ext}</code><i class="prog"></i></button>`);
    b.addEventListener("click", () => { tabsEl.classList.add("paused"); clearInterval(tabTimer); showTab(i); });
    tabList.append(b);
    return b;
  });
  function showTab(i) {
    tabIdx = i;
    tabBtns.forEach((b, j) => b.setAttribute("aria-selected", String(j === i)));
    const p = $(".prog", tabBtns[i]); p.style.animation = "none"; void p.offsetWidth; p.style.animation = "";
    tabView.replaceChildren(preview(TABS[i].item));
  }
  showTab(0);
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !tabsSeen && !calm) {
      tabsSeen = true;
      showTab(0);
      tabTimer = setInterval(() => showTab((tabIdx + 1) % TABS.length), 6000);
    }
  }, { threshold: 0.4 }).observe(tabsEl);
  addEventListener("resize", () => showTab(tabIdx));

  // ---------- Keycaps press in sequence ----------

  $$("[data-combo]").forEach((combo, n) => {
    const caps = $$(".cap", combo);
    let on = false;
    new IntersectionObserver(([e]) => (on = e.isIntersecting), { threshold: 0.6 }).observe(combo);
    if (calm) return;
    setTimeout(() => setInterval(async () => {
      if (!on) return;
      for (const c of caps) { c.classList.add("down"); await sleep(110); }
      await sleep(420);
      caps.slice().reverse().forEach((c) => c.classList.remove("down"));
    }, 3600), n * 700);
  });

  // ---------- Setup carousel ----------

  const steps = $$("#setup-flow .step"), shots = $$("#shots img"), setupEl = $("#setup-flow");
  let stepIdx = 0, stepTimer = 0, setupSeen = false;
  function showStep(i) {
    shots.forEach((s, j) => { s.classList.toggle("gone", j === stepIdx && j !== i); s.classList.toggle("on", j === i); });
    setTimeout(() => shots.forEach((s) => s.classList.remove("gone")), 650);
    steps.forEach((s, j) => (j === i ? s.setAttribute("aria-current", "step") : s.removeAttribute("aria-current")));
    const p = $(".prog", steps[i]); p.style.animation = "none"; void p.offsetWidth; p.style.animation = "";
    stepIdx = i;
  }
  steps.forEach((s, i) => s.addEventListener("click", () => { setupEl.classList.add("paused"); clearInterval(stepTimer); showStep(i); }));
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !setupSeen && !calm) {
      setupSeen = true;
      showStep(0);
      stepTimer = setInterval(() => showStep((stepIdx + 1) % steps.length), 5000);
    }
  }, { threshold: 0.35 }).observe(setupEl);

  // ---------- FAQ ----------

  $$(".qa").forEach((qa) => {
    const b = $("button", qa);
    b.addEventListener("click", () => {
      const open = !qa.hasAttribute("data-open");
      qa.toggleAttribute("data-open", open);
      b.setAttribute("aria-expanded", String(open));
    });
  });

  // ---------- Header and reveals ----------

  const bar = $("#top-bar");
  const onScroll = () => bar.classList.toggle("scrolled", scrollY > 12);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (!calm && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.remove("pre"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    $$(".rv").forEach((el) => {
      if (el.getBoundingClientRect().top > innerHeight) { el.classList.add("pre"); io.observe(el); }
    });
  }
})();

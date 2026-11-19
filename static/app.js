/* Lab Console frontend — vanilla JS, no build step. */
"use strict";

const CY = "#3fd8ff", AM = "#ffc94d", AL = "#ff5a2a", GR = "#1a3a8f", VI = "#b06cff";
const OK = "#57e0b8";   // --ok, the palette's success hue; alert red stays fault-only
const CYCLE_MS = 10000;   // each panel holds a face for 10s (owner's call; was 8s)
const CELEBRATE_MS = 45000;
const REST_KINDS = ["orbit", "radar", "scan"];

let fleet = [];            // latest printer views from the server
let ws = null, wsUp = false;
let camHolder = 0, tick = 0;
let currentView = { name: "fleet", id: null }; // or {name:"detail", id}
let pendingModal = null;
const celebrateUntil = new Map();  // printer id -> ms timestamp the flourish ends
const prevSeen = new Map();        // printer id -> {state, percent} from the last push

/* ================= websocket ================= */
function connect() {
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onopen = () => { wsUp = true; renderLink(); };
  ws.onclose = () => { wsUp = false; renderLink(); setTimeout(connect, 2500); };
  ws.onerror = () => ws.close();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "fleet") {
      fleet = msg.printers;
      noteCompletions();
      document.getElementById("demobadge").classList.toggle("hidden", !msg.demo);
      onFleetUpdate();
    }
    else if (msg.type === "address_result") addressResult(msg);
    else if (msg.type === "error") toast(msg.detail, true);
  };
}
// A finished job is a printing -> idle transition. Requires a previously observed
// state, so a page load or reconnect never fires a stale celebration, and requires
// the job to have been near the end, so a cancelled print doesn't celebrate.
function noteCompletions() {
  fleet.forEach(p => {
    const was = prevSeen.get(p.id);
    if (was && was.state === "printing" && p.state === "idle" && (was.percent ?? 0) >= 90)
      celebrateUntil.set(p.id, Date.now() + CELEBRATE_MS);
    prevSeen.set(p.id, { state: p.state, percent: p.percent });
  });
}
const celebrating = id => (celebrateUntil.get(id) || 0) > Date.now();

function send(cmd) {
  if (!wsUp) { toast("LINK DOWN — COMMAND NOT SENT", true); return; }
  ws.send(JSON.stringify(cmd));
}

/* ================= canvas instruments (shared with mockups) ================= */
function fit(cv) {
  const r = cv.getBoundingClientRect();
  cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio;
  const c = cv.getContext("2d"); c.scale(devicePixelRatio, devicePixelRatio);
  return [c, r.width, r.height];
}
function loop(cv, draw) { (function f() { if (!cv.isConnected) return; draw(); requestAnimationFrame(f); })(); }

function radar(cv) {
  const [c, w, h] = fit(cv); if (w < 10 || h < 10) return;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 14; let a = 0;
  loop(cv, () => {
    c.clearRect(0, 0, w, h); c.lineWidth = 1;
    c.strokeStyle = GR;
    for (let i = 1; i <= 3; i++) { c.beginPath(); c.arc(cx, cy, R * i / 3, 0, 7); c.stroke(); }
    c.strokeStyle = CY; c.globalAlpha = .9; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R);
    c.globalAlpha = .35; c.stroke(); c.globalAlpha = 1;
    if (c.createConicGradient) {
      // The sweep turns clockwise (a grows), and a conic gradient also runs clockwise from
      // its start angle, so start it a twelfth of a turn BEHIND the line and brighten up to
      // it: the glow trails the sweep instead of running ahead of it (issue #4).
      const TRAIL = .12, g = c.createConicGradient(a - TRAIL * 2 * Math.PI, cx, cy);
      g.addColorStop(0, "rgba(63,216,255,0)"); g.addColorStop(TRAIL, "rgba(63,216,255,.35)");
      g.addColorStop(TRAIL + .001, "rgba(63,216,255,0)"); g.addColorStop(1, "rgba(63,216,255,0)");
      c.fillStyle = g; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, 0, 7); c.fill();
    }
    c.strokeStyle = CY; c.beginPath(); c.moveTo(cx, cy);
    c.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a)); c.stroke();
    [[.6, 1.2], [.35, 3.9], [.82, 5.1]].forEach(([rr, aa], i) => {
      const bl = (Math.sin(Date.now() / 500 + i * 2) + 1) / 2;
      c.fillStyle = i === 1 ? AL : AM; c.globalAlpha = .3 + bl * .7;
      c.beginPath(); c.arc(cx + R * rr * Math.cos(aa), cy + R * rr * Math.sin(aa), 2.5, 0, 7); c.fill();
      c.globalAlpha = 1;
    });
    a += 0.02;
  });
}
function orbit(cv) {
  const [c, w, h] = fit(cv); if (w < 10 || h < 10) return; let t = 0;
  loop(cv, () => {
    c.clearRect(0, 0, w, h); const cx = w * .38, cy = h * .55;
    c.strokeStyle = GR; c.lineWidth = 1;
    for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(cx, cy, 26 + i * 22, (26 + i * 22) * .62, -.5, 0, 7); c.globalAlpha = .6; c.stroke(); }
    c.globalAlpha = 1; c.strokeStyle = AM; c.beginPath(); c.moveTo(-10, h * .9); c.quadraticCurveTo(w * .5, h * .2, w + 10, h * .55); c.stroke();
    c.strokeStyle = CY; c.beginPath(); c.moveTo(-10, h * .15); c.lineTo(w + 10, h * .75); c.globalAlpha = .5; c.stroke(); c.globalAlpha = 1;
    c.strokeStyle = AM; c.lineWidth = 1.4; c.beginPath(); c.arc(cx, cy, 15, 0, 7); c.stroke();
    c.strokeStyle = AL; c.globalAlpha = .85; c.beginPath(); c.arc(cx, cy, 18, 0, 7); c.stroke(); c.globalAlpha = 1;
    c.beginPath(); c.moveTo(cx - 9, cy + 3); c.bezierCurveTo(cx - 3, cy - 9, cx + 6, cy + 9, cx + 11, cy - 4); c.strokeStyle = AM; c.stroke();
    const ox = cx + 70 * Math.cos(t), oy = cy + 70 * .62 * Math.sin(t);
    c.fillStyle = CY; c.beginPath(); c.arc(ox, oy, 3, 0, 7); c.fill();
    c.strokeStyle = CY; c.globalAlpha = .5; c.beginPath(); c.arc(ox, oy, 7, 0, 7); c.stroke(); c.globalAlpha = 1;
    t += .012;
  });
}
function scan(cv) {
  const [c, w, h] = fit(cv); if (w < 10 || h < 10) return;
  const n = 16, bw = (w - 40) / n; let t = 0;
  loop(cv, () => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = GR; c.beginPath(); c.moveTo(18, h - 22); c.lineTo(w - 18, h - 22); c.stroke();
    for (let i = 0; i < n; i++) {
      const v = (Math.sin(t + i * .7) + 1) / 2 * (h - 56) + 8;
      c.fillStyle = i % 5 === 4 ? AM : CY; c.globalAlpha = .85;
      c.fillRect(20 + i * bw, h - 24 - v, bw * .55, v); c.globalAlpha = 1;
    }
    c.strokeStyle = AM; c.beginPath();
    for (let x = 0; x <= w - 36; x += 4) { const y = h - 70 - Math.sin(t * 2 + x * .05) * 10; x ? c.lineTo(18 + x, y) : c.moveTo(18, y); }
    c.stroke(); t += .03;
  });
}
function wedge(cv, pct, col) {
  const [c, w, h] = fit(cv); if (w < 10 || h < 10) return;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 3;
  c.strokeStyle = GR; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
  c.fillStyle = col; c.globalAlpha = .28; c.beginPath(); c.moveTo(cx, cy);
  c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + pct * 2 * Math.PI / 100); c.fill();
  c.globalAlpha = 1; c.strokeStyle = col; c.beginPath(); c.moveTo(cx, cy);
  c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + pct * 2 * Math.PI / 100); c.closePath(); c.stroke();
}
/* Open-arc progress reticle shown on large status faces (mockups/large-panel-options-mockup.html,
   option C). Same vocabulary as the print-complete sequence: tapered segments on an open arc,
   filled in steps rather than eased. Static: redrawn when the status face re-renders. */
function reticle(cv, pct, col, label) {
  const [c, w, h] = fit(cv); if (w < 10 || h < 10) return;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 4;
  const N = 30, a0 = Math.PI * 0.75, span = Math.PI * 1.5, lit = Math.round(pct / 100 * N);
  for (let i = 0; i < N; i++) {
    const s = a0 + span * i / N + 0.012, e = a0 + span * (i + 1) / N - 0.012;
    const ro = R, ri = R * (i % 5 === 4 ? 0.74 : 0.80);
    c.beginPath(); c.arc(cx, cy, ro, s, e); c.arc(cx, cy, ri, e, s, true); c.closePath();
    c.fillStyle = i < lit ? col : GR; c.globalAlpha = i < lit ? 0.9 : 0.55; c.fill();
  }
  c.globalAlpha = 1; c.strokeStyle = GR; c.lineWidth = 1;
  c.beginPath(); c.arc(cx, cy, R * 0.66, a0, a0 + span); c.stroke();
  c.strokeStyle = col; c.globalAlpha = .5;
  c.beginPath(); c.arc(cx, cy, R * 0.66, a0, a0 + span * pct / 100); c.stroke(); c.globalAlpha = 1;
  c.fillStyle = col; c.textAlign = "center"; c.textBaseline = "middle";
  c.font = `${Math.round(R * 0.42)}px ui-monospace, Menlo, Consolas, monospace`;
  c.fillText(pct + "%", cx, cy - R * 0.04);
  c.fillStyle = "#5f7ea6"; c.font = `${Math.max(8, Math.round(R * 0.09))}px ui-monospace, Menlo, Consolas, monospace`;
  c.fillText(label, cx, cy + R * 0.32);
}
function camDemo(cv) {
  const [c, w, h] = fit(cv); if (w < 10 || h < 10) return; let t = 0;
  loop(cv, () => {
    c.fillStyle = "#050910"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(63,216,255,.75)"; c.lineWidth = 1;
    c.strokeRect(w * .2, h * .18, w * .6, h * .66);
    c.beginPath(); c.moveTo(w * .2, h * .18); c.lineTo(w * .28, h * .08);
    c.lineTo(w * .72, h * .08); c.lineTo(w * .8, h * .18); c.stroke();
    const gy = h * .62 + Math.sin(t) * 4;
    c.strokeStyle = AM; c.beginPath(); c.moveTo(w * .24, gy); c.lineTo(w * .76, gy); c.stroke();
    c.fillStyle = AM; c.fillRect(w * .24 + ((Math.sin(t * 3) + 1) / 2) * (w * .5), gy - 7, 10, 7);
    c.strokeStyle = "rgba(63,216,255,.4)"; c.strokeRect(w * .33, h * .66, w * .34, h * .12);
    c.fillStyle = "rgba(255,255,255,.05)";
    for (let i = 0; i < 90; i++) c.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
    t += .03;
  });
}
/* ---------- print-complete instrument ----------
   Ported from mockups/print-complete-celebration.html (option C, INSPECTION).
   Vocabulary comes from the Galaxy's Edge panel references: tapered wedge meters
   under a tick comb with an amber end cap, an open-arc reticle (arcs top and
   bottom, gaps at the sides) around the part, a dotted ladder with a triangle
   marker, and a hexagonal seal that draws itself. Amber and mint lead; AL is
   never used here — red means a fault and nothing else. */
const MET = [["EXTR", .92], ["BED", .78], ["SURF", .99]];
const cEase = t => 1 - Math.pow(1 - t, 3);
const cStep = (t, hz) => Math.floor(t * hz) / hz;   // prop panels move in steps
const cClamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const cRnd = s => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };

function cText(c, txt, x, y, size, col, alpha, sp, align) {
  c.save();
  c.globalAlpha = alpha; c.fillStyle = col;
  c.font = `700 ${size}px ui-monospace,'SF Mono',Consolas,monospace`;
  c.textBaseline = "middle"; c.textAlign = "left";
  c.shadowColor = col; c.shadowBlur = size * .9;
  let total = -sp;
  for (const ch of txt) total += c.measureText(ch).width + sp;
  let sx = align === "right" ? x - total : align === "left" ? x : x - total / 2;
  for (const ch of txt) { c.fillText(ch, sx, y); sx += c.measureText(ch).width + sp; }
  c.restore();
}
function cGlyphs(c, x, y, n, size, seed, col, alpha) {
  c.save();
  c.strokeStyle = col; c.globalAlpha = alpha; c.lineWidth = 1.2;
  const gap = size * 1.6, total = (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    const gx = x - total / 2 + i * gap, s = size / 2, k = Math.floor(cRnd(seed + i * 3.7) * 6);
    c.beginPath();
    if (k === 0) { c.moveTo(gx - s, y - s); c.lineTo(gx - s, y + s); c.lineTo(gx + s, y + s); }
    else if (k === 1) { c.rect(gx - s, y - s, s * 2, s * 1.25); }
    else if (k === 2) { c.moveTo(gx - s, y + s); c.lineTo(gx, y - s); c.lineTo(gx + s, y + s); }
    else if (k === 3) { c.moveTo(gx - s, y - s); c.lineTo(gx + s, y - s); c.moveTo(gx, y - s); c.lineTo(gx, y + s); }
    else if (k === 4) { c.moveTo(gx - s, y - s); c.lineTo(gx + s, y + s); c.moveTo(gx + s, y - s); c.lineTo(gx - s, y - s); }
    else { c.moveTo(gx - s, y + s); c.lineTo(gx + s, y + s); c.moveTo(gx - s, y); c.lineTo(gx + s * .4, y); }
    c.stroke();
  }
  c.restore();
}
function cWedge(c, x, y, w, h, frac, col) {
  const fw = w * cClamp(frac, 0, 1);
  c.save();
  c.beginPath();
  c.moveTo(x, y + h / 2 - 1); c.lineTo(x + fw, y);
  c.lineTo(x + fw, y + h); c.lineTo(x, y + h / 2 + 1); c.closePath();
  c.fillStyle = col; c.globalAlpha = .42; c.fill();
  c.globalAlpha = .9; c.lineWidth = 1; c.strokeStyle = col; c.stroke();
  c.globalAlpha = .75; c.strokeStyle = OK;
  for (let i = 0; i < 9; i++) {                       // tick comb over the full track
    const px = x + (i / 8) * w, hh = h * (.3 + (i / 8) * .7);
    c.beginPath(); c.moveTo(px, y + h / 2 - hh / 2); c.lineTo(px, y + h / 2 + hh / 2); c.stroke();
  }
  if (frac > .01) {                                   // amber end cap at the fill point
    c.globalAlpha = 1; c.strokeStyle = AM; c.lineWidth = 2;
    c.shadowColor = AM; c.shadowBlur = 7;
    c.beginPath(); c.moveTo(x + fw, y - 2); c.lineTo(x + fw, y + h + 2); c.stroke();
  }
  c.restore();
}
function cReticle(c, cx, cy, r, alpha, rot) {
  c.save();
  c.strokeStyle = CY; c.globalAlpha = alpha; c.lineWidth = 1.4;
  c.shadowColor = CY; c.shadowBlur = 6;
  const span = Math.PI * .62;
  for (const base of [-Math.PI / 2, Math.PI / 2]) {
    c.beginPath(); c.arc(cx, cy, r, base - span / 2 + rot, base + span / 2 + rot); c.stroke();
  }
  c.globalAlpha = alpha * .6; c.lineWidth = 1;
  for (const base of [-Math.PI / 2, Math.PI / 2]) {
    c.beginPath(); c.arc(cx, cy, r * .72, base - span * .35 + rot, base + span * .35 + rot); c.stroke();
  }
  c.restore();
}
function cLadder(c, x, y, h, frac) {
  c.save();
  for (let i = 0; i < 12; i++) {
    const py = y + h - (i / 11) * h, on = (i / 11) <= frac + 1e-6;
    c.globalAlpha = on ? .95 : .2; c.fillStyle = on ? OK : GR;
    c.fillRect(x - 3, py - 1.5, 6, 3);
  }
  const my = y + h - frac * h;
  c.globalAlpha = 1; c.fillStyle = AM; c.shadowColor = AM; c.shadowBlur = 6;
  c.beginPath(); c.moveTo(x - 10, my); c.lineTo(x - 6, my - 3.5); c.lineTo(x - 6, my + 3.5);
  c.closePath(); c.fill();
  c.restore();
}
function complete(cv) {
  const [c, w, h] = fit(cv); if (w < 10 || h < 10) return;
  // anchored to the celebration start, not to mount, so a remount resumes in place
  const t0 = +cv.dataset.t0 || Date.now();
  const mx = w * .05, mw = w * .32;
  const rx = w * .70, ry = h * .44, rr = Math.min(w, h) * .30;
  const pr = rr * .5, ph = pr;

  const part = theta => {
    const out = [];
    for (let s = 0; s < 2; s++)
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2, px = Math.cos(a) * pr, pz = Math.sin(a) * pr;
        const vx = px * Math.cos(theta) - pz * Math.sin(theta);
        const vz = px * Math.sin(theta) + pz * Math.cos(theta);
        const f = 250 / (250 + vz);
        out.push([rx + vx * f, ry + (s ? ph / 2 : -ph / 2) * f * .86]);
      }
    return out;
  };

  loop(cv, () => {
    const t = (Date.now() - t0) / 1000;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = GR; c.globalAlpha = .16; c.lineWidth = 1;
    for (let x = (w * .5) % 24; x < w; x += 24) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = (h * .5) % 24; y < h; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.globalAlpha = 1;

    let capped = 0;
    MET.forEach((m, i) => {
      const st = .3 + i * .7;
      const p = cClamp(cStep(t - st, 18) / 1.1, 0, 1) * m[1];
      if (p >= m[1] - 1e-3) capped++;
      const y = h * (.20 + i * .26), al = cClamp((t - st) / .2, 0, 1);
      cText(c, m[0], mx, y - h * .085, 7.5, CY, al * .9, 1.2, "left");
      cWedge(c, mx, y - 5, mw, 11, p, CY);
    });

    cReticle(c, rx, ry, rr, .85, Math.sin(t * .35) * .12);

    const v = part(t * .5);
    const sweepOn = t > .9 && t < 4.2;
    const sweepY = ry + ph * .8 - cClamp((t - .9) / 3, 0, 1) * ph * 1.9;
    const edge = (i, j) => {
      const a = v[i], b = v[j];
      const near = sweepOn && Math.abs((a[1] + b[1]) / 2 - sweepY) < 7;
      c.strokeStyle = near ? OK : CY; c.globalAlpha = near ? 1 : .8;
      c.lineWidth = near ? 1.7 : 1.1;
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    };
    for (let i = 0; i < 6; i++) edge(i, (i + 1) % 6);
    for (let i = 0; i < 6; i++) edge(6 + i, 6 + (i + 1) % 6);
    for (let i = 0; i < 6; i++) edge(i, 6 + i);
    c.globalAlpha = 1;

    if (sweepOn) {
      c.save();
      c.strokeStyle = OK; c.globalAlpha = .9; c.lineWidth = 1.3;
      c.shadowColor = OK; c.shadowBlur = 10;
      c.beginPath(); c.moveTo(rx - rr, sweepY); c.lineTo(rx + rr, sweepY); c.stroke();
      c.restore();
    }

    if (t > 3.6) {                                    // segmented rings converge and lock
      const e = cEase(cClamp((t - 3.6) / 2.2, 0, 1));
      for (let i = 0; i < 2; i++) {
        const from = Math.min(w, h) * .9 - i * 8, to = rr * (1.30 + i * .18);
        const rad = from + (to - from) * e, segs = i ? 18 : 24;
        c.save();
        c.strokeStyle = i ? AM : CY; c.globalAlpha = .26 + .45 * e; c.lineWidth = 1.3;
        for (let s = 0; s < segs; s++) {
          const a0 = s / segs * Math.PI * 2;
          c.beginPath(); c.arc(rx, ry, rad, a0, a0 + (Math.PI * 2 / segs) * .62); c.stroke();
        }
        c.restore();
      }
    }

    if (t > 6) {                                      // hexagonal seal draws itself
      const p = cClamp((t - 6) / 1.1, 0, 1), sr = rr * .95;
      c.save();
      c.strokeStyle = OK; c.globalAlpha = .95; c.lineWidth = 1.8;
      c.shadowColor = OK; c.shadowBlur = 9;
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const f = cClamp(p * 6 - i, 0, 1);
        if (f <= 0) break;
        const a0 = i / 6 * Math.PI * 2 - Math.PI / 2, a1 = (i + 1) / 6 * Math.PI * 2 - Math.PI / 2;
        if (i === 0) c.moveTo(rx + Math.cos(a0) * sr, ry + Math.sin(a0) * sr);
        const aa = a0 + (a1 - a0) * f;
        c.lineTo(rx + Math.cos(aa) * sr, ry + Math.sin(aa) * sr);
      }
      c.stroke(); c.restore();
    }

    cLadder(c, w - 9, h * .18, h * .56, cClamp(t / 3, 0, 1));

    if (t > 7.1 && capped === MET.length) {           // FINISHED stamps last
      const p = cClamp(cStep(t - 7.1, 24) / .4, 0, 1), sc = 1.5 + (1 - 1.5) * cEase(p);
      c.save();
      c.globalAlpha = p * .82; c.fillStyle = "rgba(6,13,30,.86)";
      c.fillRect(0, h * .86 - 13, w, 26);
      c.restore();
      cText(c, "FINISHED", w / 2, h * .86, Math.max(11, Math.min(16, w * .062)) * sc, OK, p, 4);
    }
    cGlyphs(c, w * .30, h - 8, 6, 5, 55, AM, .5);
  });
}

/* ---- layer stack (v1.5): completed layers as glowing cyan blocks, the layer being
   printed pulsing amber (violet while paused). Reads live layer data from `fleet` by
   printer id each frame, so telemetry updates never tear the face down. Finished blocks
   are drawn once to an offscreen cache; per frame only the current block and the border
   are redrawn, which keeps a Pi 3 comfortable. ---- */
const STACK_MIN_PITCH = 7;   // px: below this, blocks get bucketed (N layers per block)
const STACK_MAX_PITCH = 34;  // px: cap so short jobs don't render giant blocks
function stackLayout(w, h, total) {
  const m = { l: 14, r: 14, t: 14, b: 26 }, pad = 7;
  const aw = w - m.l - m.r - 2 * pad, ah = h - m.t - m.b - 2 * pad;
  if (aw < 20 || ah < 20 || !(total > 0)) return null;
  let per = 1, fitL = null;
  for (;;) {
    const n = Math.ceil(total / per);
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols), s = Math.min(aw / cols, ah / rows);
      if (!best || s > best.s) best = { cols, rows, s, n };
    }
    if (best.s >= STACK_MIN_PITCH || per >= 64) { fitL = { ...best, per }; break; }
    per++;
  }
  const s = Math.min(fitL.s, STACK_MAX_PITCH), gw = fitL.cols * s, gh = fitL.rows * s;
  const gx = m.l + pad + (aw - gw) / 2, gy = m.t + pad + (ah - gh) / 2;
  return { ...fitL, s, q: s * 0.72, gx, gy, gw, gh,
           border: { x: gx - pad, y: gy - pad, w: gw + 2 * pad, h: gh + 2 * pad } };
}
function stackBlock(L, i) {
  const row = Math.floor(i / L.cols), col = i % L.cols, off = (L.s - L.q) / 2;
  return { x: L.gx + col * L.s + off, y: L.gy + L.gh - (row + 1) * L.s + off, q: L.q };
}
function rrect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
function layerStack(cv) {
  const [c, w, h] = fit(cv); if (w < 10 || h < 10) return;
  const pid = cv.dataset.pid, root = cv.parentElement;
  const readout = root.querySelector(".stackread"), bucket = root.querySelector(".stackbucket");
  const d = devicePixelRatio || 1;
  const cache = document.createElement("canvas");
  cache.width = cv.width; cache.height = cv.height;
  const cc = cache.getContext("2d"); cc.setTransform(d, 0, 0, d, 0, 0);
  let L = null, total = 0, doneDrawn = -1, lastCur = -1, flash = { i: -1, t: 0 };
  let layer = 0, state = "printing", pct = null, lastText = "", lastBucket = null;

  function drawDone(ctx, i) {
    const b = stackBlock(L, i), r = Math.max(1, b.q * 0.14);
    ctx.save();
    ctx.shadowColor = "rgba(63,216,255,.85)"; ctx.shadowBlur = Math.max(3, b.q * 0.6);
    rrect(ctx, b.x, b.y, b.q, b.q, r);
    ctx.fillStyle = "rgba(63,216,255,.22)"; ctx.fill();
    ctx.lineWidth = Math.max(1, b.q * 0.12); ctx.strokeStyle = CY; ctx.stroke();
    ctx.restore();
  }
  function rebuild(doneBlocks) {
    cc.clearRect(0, 0, w, h);
    cc.strokeStyle = "rgba(63,216,255,.11)"; cc.lineWidth = 1;   // ghost slots for layers still to come
    for (let i = doneBlocks; i < L.n; i++) {
      const b = stackBlock(L, i);
      rrect(cc, b.x + .5, b.y + .5, b.q - 1, b.q - 1, Math.max(1, b.q * 0.14)); cc.stroke();
    }
    for (let i = 0; i < doneBlocks; i++) drawDone(cc, i);
    doneDrawn = doneBlocks;
  }

  loop(cv, () => {
    const now = performance.now();
    const p = fleet.find(x => x.id === pid);
    // Hold the last known values if the printer leaves printing/paused before the next face change.
    if (p && (p.state === "printing" || p.state === "paused") && p.total_layers > 0) {
      layer = p.layer || 0; state = p.state; pct = p.percent;
      if (p.total_layers !== total) { total = p.total_layers; L = stackLayout(w, h, total); doneDrawn = -1; lastCur = -1; }
    }
    if (!L) return;
    const live = p && (p.state === "printing" || p.state === "paused");
    const doneLayers = Math.max(0, Math.min(layer - 1, total));
    const doneBlocks = Math.floor(doneLayers / L.per);
    const cur = Math.min(doneBlocks, L.n - 1);

    if (doneBlocks !== doneDrawn) {
      if (doneDrawn >= 0 && doneBlocks === doneDrawn + 1) { drawDone(cc, doneDrawn); doneDrawn = doneBlocks; }
      else rebuild(doneBlocks);
    }
    if (lastCur >= 0 && cur === lastCur + 1) flash = { i: lastCur, t: now };
    lastCur = cur;

    c.clearRect(0, 0, w, h);
    c.drawImage(cache, 0, 0, w, h);

    // dashed job envelope; dashes march while printing
    const B = L.border, printing = live && state === "printing";
    c.save();
    rrect(c, B.x, B.y, B.w, B.h, Math.min(12, L.s * 0.9 + 4));
    c.setLineDash([7, 5]);
    c.lineDashOffset = printing ? -(now / 90) % 12 : 0;
    c.lineWidth = 1.3; c.strokeStyle = "rgba(63,216,255,.7)";
    c.shadowColor = "rgba(63,216,255,.6)"; c.shadowBlur = 6;
    c.stroke();
    c.restore();

    // current layer: halo + pulsing fill + dashed outline. Amber = printing, violet = paused.
    if (live) {
      const b = stackBlock(L, cur), col = state === "paused" ? VI : AM;
      const pulse = state === "paused" ? 0.55 : 0.55 + 0.45 * Math.sin(now / 280);
      const cx = b.x + b.q / 2, cy = b.y + b.q / 2;
      c.save();
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, b.q * 1.9);
      g.addColorStop(0, hexA(col, 0.30 * pulse)); g.addColorStop(1, hexA(col, 0));
      c.fillStyle = g; c.fillRect(cx - b.q * 2, cy - b.q * 2, b.q * 4, b.q * 4);
      c.shadowColor = col; c.shadowBlur = 4 + b.q * 1.2 * pulse;
      rrect(c, b.x, b.y, b.q, b.q, Math.max(1, b.q * 0.14));
      c.fillStyle = hexA(col, 0.22 + 0.4 * pulse); c.fill();
      c.lineWidth = Math.max(1.2, b.q * 0.14); c.strokeStyle = col;
      if (b.q >= 9) c.setLineDash([Math.max(2, b.q * 0.24), Math.max(1.5, b.q * 0.13)]);
      c.stroke();
      c.restore();
    }

    // completion flash: white, fading into the settled cyan block over 450 ms
    const dt = now - flash.t;
    if (flash.i >= 0 && dt < 450) {
      const b = stackBlock(L, flash.i), a = 1 - dt / 450;
      c.save();
      c.shadowColor = "#ffffff"; c.shadowBlur = 6 + b.q * a;
      rrect(c, b.x, b.y, b.q, b.q, Math.max(1, b.q * 0.14));
      c.fillStyle = `rgba(255,255,255,${0.75 * a})`; c.fill();
      c.restore();
    }

    // overlays: touch the DOM only when the text changes
    const shownPct = pct != null ? pct : Math.floor(doneLayers / total * 100);
    const text = `LAYER <b>${layer}</b> / ${total} · ${shownPct}%`;
    if (text !== lastText && readout) { readout.innerHTML = text; lastText = text; }
    const bt = L.per > 1 ? `1 BLOCK = ${L.per} LAYERS` : "";
    if (bt !== lastBucket && bucket) { bucket.textContent = bt; lastBucket = bt; }
  });
}
/* ---- progress cube: a tapered wedge meter for the job's progress beside a spinning,
   glowing wireframe cube in isometric view (35.26 deg tilt, 45 deg rest yaw), in a reticle.
   Modelled on the owner's Galaxy's Edge reference photo; approved as option A of
   mockups/progress-cube-mockup.html. Printing spins the cube, paused holds it in the
   isometric hexagon with violet markers, idle shows STANDBY and drifts slowly. Glow is
   stacked strokes rather than shadowBlur, which is cheaper on a Pi 3. Reads `fleet` by
   printer id every frame, like the layer stack, so pushes never tear it down. ---- */
const CUBE_PITCH = Math.atan(1 / Math.SQRT2);
const CUBE_YAW0 = Math.PI / 4;
const CUBE_V = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const CUBE_E = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
function glowLine(c, pts, col, w) {
  for (const [lw, a] of [[w * 5, .10], [w * 2.4, .28], [w, 1]]) {   // halo, glow, core
    c.globalAlpha = a; c.lineWidth = lw; c.strokeStyle = col; c.beginPath();
    pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
    c.stroke();
  }
  c.globalAlpha = 1;
}
function drawCube(c, cx, cy, s, yaw, col) {
  yaw += CUBE_YAW0;
  const cp = Math.cos(CUBE_PITCH), sp = Math.sin(CUBE_PITCH), cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const P = CUBE_V.map(([x, y, z]) => {
    const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;     // yaw about the vertical axis
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;        // fixed isometric tilt
    return [cx + x1 * s, cy + y2 * s, z2];
  });
  CUBE_E.forEach(([a, b]) => {
    if ((P[a][2] + P[b][2]) / 2 < -0.35) {                    // edges facing away: dim, no glow
      c.globalAlpha = .28; c.lineWidth = 1; c.strokeStyle = col; c.beginPath();
      c.moveTo(P[a][0], P[a][1]); c.lineTo(P[b][0], P[b][1]); c.stroke(); c.globalAlpha = 1;
    } else glowLine(c, [P[a], P[b]], col, Math.max(1.1, s * 0.035));
  });
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, s * 1.1);
  g.addColorStop(0, "rgba(63,216,255,.22)"); g.addColorStop(1, "rgba(63,216,255,0)");
  c.fillStyle = g; c.fillRect(cx - s * 1.2, cy - s * 1.2, s * 2.4, s * 2.4);
}
function wedgeMeter(c, x, y, w, h, frac, live, mark) {
  const ticks = 10, base = y + h, tip = h * 0.22, topAt = t => base - (tip + (h - tip) * t);
  c.strokeStyle = "rgba(63,216,255,.55)"; c.lineWidth = 1;
  for (let i = 0; i <= ticks; i++) { const tx = x + w * i / ticks; c.beginPath(); c.moveTo(tx, y); c.lineTo(tx, base); c.stroke(); }
  if (frac > 0) {
    const fx = x + w * frac;
    c.fillStyle = "rgba(108,200,255,.78)"; c.beginPath();
    c.moveTo(x, base); c.lineTo(x, topAt(0)); c.lineTo(fx, topAt(frac)); c.lineTo(fx, base); c.closePath(); c.fill();
  }
  const cap = Math.max(6, w * .035);
  glowLine(c, [[x + cap, y], [x, y], [x, base], [x + cap, base]], CY, 1.4);
  glowLine(c, [[x + w + cap * 2, y], [x + w + cap * 3, y], [x + w + cap * 3, base], [x + w + cap * 2, base]], CY, 1.4);
  if (live) {
    const fx = x + w * Math.max(0, Math.min(1, frac)), tz = Math.max(6, h * .13);
    glowLine(c, [[fx, y - h * .06], [fx, base + h * .06]], mark, 2.2);
    c.fillStyle = CY; c.beginPath(); c.moveTo(fx, base + h * .16);
    c.lineTo(fx - tz * .7, base + h * .16 + tz); c.lineTo(fx + tz * .7, base + h * .16 + tz); c.closePath(); c.fill();
  }
}
function sideScale(c, x, y, h, frac, mark) {
  c.strokeStyle = "rgba(63,216,255,.7)"; c.lineWidth = 1.2;
  for (let i = 0; i <= 16; i++) { const ty = y + h * i / 16, len = i % 4 === 0 ? 9 : 5; c.beginPath(); c.moveTo(x, ty); c.lineTo(x + len, ty); c.stroke(); }
  if (frac != null) { const ty = y + h * (1 - frac), tz = 7;
    c.fillStyle = mark; c.beginPath(); c.moveTo(x - 3, ty); c.lineTo(x - 3 - tz * 1.4, ty - tz); c.lineTo(x - 3 - tz * 1.4, ty + tz); c.closePath(); c.fill(); }
}
function reticleRing(c, cx, cy, r) {
  c.strokeStyle = "rgba(63,216,255,.16)"; c.lineWidth = Math.max(2, r * .09);
  for (const [a0, a1] of [[-2.6, -0.55], [0.55, 2.6]]) { c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke(); }
  c.strokeStyle = "rgba(63,216,255,.28)"; c.lineWidth = 1; c.setLineDash([2, 4]);
  c.beginPath(); c.moveTo(cx - r * 1.15, cy); c.lineTo(cx + r * 1.15, cy); c.moveTo(cx, cy - r * 1.15); c.lineTo(cx, cy + r * 1.15); c.stroke();
  c.setLineDash([]); c.beginPath(); c.arc(cx, cy, r * .42, 0, 7); c.stroke();
}
function progressCube(cv) {
  const [c, w, h] = fit(cv); if (w < 10 || h < 10) return;
  const pid = cv.dataset.pid; let yaw = 0, last = performance.now();
  loop(cv, () => {
    const now = performance.now(), dt = now - last; last = now;
    const p = fleet.find(x => x.id === pid); if (!p) return;
    const printing = p.state === "printing", paused = p.state === "paused", live = printing || paused;
    yaw += (printing ? .0011 : paused ? 0 : .00035) * dt;
    const mark = paused ? VI : AM, pct = live ? (p.percent ?? 0) : 0, frac = pct / 100;
    c.clearRect(0, 0, w, h);
    const padX = w * .05, rowH = h * .84, y0 = h * .08, fs = Math.max(9, Math.min(22, rowH * .1));
    const mh = rowH * .34, my = y0 + rowH * .3, mw = w * .44, font = k => `${fs * k}px ui-monospace, Menlo, Consolas, monospace`;
    // 4-digit readout above the meter, like the reference's "0065"
    c.font = font(1); c.textBaseline = "alphabetic";
    c.fillStyle = live ? CY : "#3a5a86"; c.fillText(String(Math.round(pct)).padStart(4, "0"), padX, my - fs * .55);
    c.fillStyle = "#5f7ea6"; c.font = font(.62); c.fillText("PROGRESS", padX + fs * 3.4, my - fs * .55);
    wedgeMeter(c, padX, my, mw, mh, frac, live, mark);
    // small bracket with an inward marker between the meter and the reticle
    const bx = padX + mw + w * .07, bcy = my + mh / 2;
    glowLine(c, [[bx + 8, bcy - mh * .45], [bx, bcy - mh * .3], [bx, bcy + mh * .3], [bx + 8, bcy + mh * .45]], CY, 1.4);
    c.fillStyle = mark; c.beginPath(); c.moveTo(bx + 6, bcy); c.lineTo(bx + 16, bcy - 6); c.lineTo(bx + 16, bcy + 6); c.closePath(); c.fill();
    c.fillStyle = "#5f7ea6"; c.font = font(.62); c.fillText(live ? `${Math.round(pct)}%` : "STANDBY", bx - 2, bcy + mh * .45 + fs * .95);
    const rcx = w * .76, rr = Math.min(rowH * .36, w * .14);
    reticleRing(c, rcx, bcy, rr);
    drawCube(c, rcx, bcy, rr * .46, yaw, CY);
    sideScale(c, w - padX * .9, y0 + rowH * .12, rowH * .76, live ? frac : null, mark);
  });
}
function mountAnims(root) {
  root.querySelectorAll("canvas[data-anim]").forEach(cv => {
    ({ radar, orbit, scan, camdemo: camDemo, complete, stack: layerStack, cube: progressCube })[cv.dataset.anim]?.(cv);
  });
  root.querySelectorAll("canvas.wedge").forEach(cv =>
    wedge(cv, +cv.dataset.pct || 0, cv.dataset.col === "al" ? AL : AM));
  // only drawn where CSS shows it (the two-across layout); a hidden canvas measures 0 and skips
  root.querySelectorAll("canvas.reticle").forEach(cv =>
    reticle(cv, +cv.dataset.pct || 0, { al: AL, vi: VI }[cv.dataset.col] || AM, cv.dataset.label));
}

/* ================= helpers ================= */
const esc = s => String(s ?? "").replace(/[&<>"']/g, m =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const fmtEta = m => m == null ? "—" :
  (m >= 60 ? `${Math.floor(m / 60)}H ${m % 60}M` : `${m}M`);
const stateWord = { idle: "IDLE", printing: "PRINTING", paused: "PAUSED", error: "ERROR", offline: "OFFLINE" };
function hmsCode(h) {
  const a = (h.attr >>> 0).toString(16).padStart(8, "0"), c = (h.code >>> 0).toString(16).padStart(8, "0");
  return `HMS ${a.slice(0, 4).toUpperCase()}-${a.slice(4).toUpperCase()}-${c.slice(0, 4).toUpperCase()}-${c.slice(4).toUpperCase()}`;
}
let toastTimer = null;
function toast(msg, isErr) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : ""); t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3500);
}

/* ================= panel faces ================= */
function faceStatus(p) {
  const s = p.state;
  if (s === "printing" || s === "paused") {
    const pct = p.percent ?? 0;
    return `
      <div class="statword ${s}">${stateWord[s]}</div>
      <div class="fname">${esc(p.file) || "—"}</div>
      <div class="kv"><span>LAYER</span><b>${p.layer ?? "—"} / ${p.total_layers ?? "—"}</b></div>
      <div class="kv"><span>NOZZLE / BED</span><b class="warm">${p.nozzle ?? "—"}° / ${p.bed ?? "—"}°</b></div>
      <div class="kv"><span>TIME LEFT</span><b class="warm">${fmtEta(p.remaining_min)}</b></div>
      <div class="progrow">
        <canvas class="wedge" data-pct="${pct}" width="34" height="34" style="width:34px;height:34px"></canvas>
        <div class="pbar"><i style="width:${pct}%"></i></div><span class="ppct">${pct}%</span>
      </div>
      <canvas class="reticle" data-pct="${pct}" ${s === "paused" ? 'data-col="vi" data-label="PAUSED"' : 'data-label="COMPLETE"'}></canvas>
      <span class="facechip">STATUS</span>`;
  }
  if (s === "error") {
    const pct = p.percent ?? 0;
    const lines = p.hms.length ? p.hms.map(h => hmsCode(h)).join("<br>")
      : `PRINT ERROR 0x${(p.print_error >>> 0).toString(16).toUpperCase()}`;
    return `
      <div class="statword error">ERROR</div>
      <div class="errline">${lines}<br>CHECK PRINTER, CLEAR FAULT, THEN RESUME.</div>
      <div class="kv"><span>JOB HELD AT</span><b>${pct}%</b></div>
      <div class="progrow">
        <canvas class="wedge" data-pct="${pct}" data-col="al" width="34" height="34" style="width:34px;height:34px"></canvas>
        <div class="pbar errbar"><i style="width:${pct}%"></i></div>
        <span class="ppct" style="color:var(--alert)">${pct}%</span>
      </div>
      <canvas class="reticle" data-pct="${pct}" data-col="al" data-label="HELD"></canvas>
      <span class="facechip">STATUS</span>`;
  }
  if (s === "offline" && p.address?.mode === "ask") return faceAsk(p);
  if (s === "offline" && p.address?.mode === "auto") return faceSearch(p);
  if (s === "offline") {
    return `
      <div class="statword offline">OFFLINE</div>
      <div class="kv"><span>LINK</span><b>NO MQTT CONNECTION</b></div>
      <div class="kv"><span>HINT</span><b>CHECK POWER / LAN / DEV MODE</b></div>
      <span class="facechip">STATUS</span>`;
  }
  return `
    <div class="statword idle">IDLE</div>
    <div class="kv"><span>NOZZLE / BED</span><b>${p.nozzle ?? "—"}° / ${p.bed ?? "—"}°</b></div>
    <div class="kv"><span>LAST JOB</span><b>${esc(p.file) || "—"}</b></div>
    <div class="kv"><span>READY</span><b class="warm">AWAITING ASSIGNMENT</b></div>
    <span class="facechip">STATUS</span>`;
}
function faceComplete(p) {
  const t0 = (celebrateUntil.get(p.id) || Date.now()) - CELEBRATE_MS;
  return `<canvas class="bganim" data-anim="complete" data-t0="${t0}"></canvas>
    <span class="facechip">COMPLETE</span>`;
}
function faceStack(p) {
  return `<canvas class="bganim" data-anim="stack" data-pid="${esc(p.id)}"></canvas>
    <span class="stackread"></span><span class="stackbucket"></span>
    <span class="facechip">LAYER STACK</span>`;
}
// A printer with a job that has layer data can show the layer stack on its animation turn.
const hasLayers = p => (p.state === "printing" || p.state === "paused") && p.total_layers > 0;
const animTurns = new Map();  // printer id -> {tick, n}: animation turns this panel has shown
function faceCube(p) {
  return `<canvas class="bganim" data-anim="cube" data-pid="${esc(p.id)}"></canvas>
    <span class="facechip">PROGRESS · CUBE</span>`;
}
function faceRest(kind) {
  return `<canvas class="bganim" data-anim="${kind}"></canvas><span class="facechip">SCANNER · RESTING</span>`;
}
function faceCam(p) {
  if (p.camera === "none" || p.state === "offline")
    return `<canvas class="bganim" data-anim="scan"></canvas>
      <span class="camtag nosig">NO SIGNAL</span>
      <span class="camfoot">LIVEVIEW UNAVAILABLE</span>`;
  if (p.camera === "demo")
    return `<canvas class="bganim" data-anim="camdemo"></canvas>
      <span class="camtag rec">LIVE · DEMO</span>
      <span class="camfoot">SIMULATED FEED</span>`;
  const foot = p.camera === "chamber" ? "CHAMBER IMAGE · ~1 FPS" : "RTSPS :322 RELAY";
  return `<img class="camimg" src="/cam/${p.id}?t=${Date.now()}" alt="">
    <span class="camtag rec">LIVE</span><span class="camfoot">${foot}</span>`;
}

/* ================= fleet view ================= */
const elFleet = document.getElementById("fleet");
const elDetail = document.getElementById("detail");
const grid = document.getElementById("grid");
const panelEls = new Map();

function ensurePanels() {
  fleet.forEach(p => {
    if (panelEls.has(p.id)) return;
    const el = document.createElement("div");
    el.className = "ppanel";
    el.innerHTML = `<div class="crt">
      <div class="phead"><span class="lamp"></span><span class="pname nameglow"></span><span class="pmodel"></span></div>
      <div class="pbody"></div></div>`;
    el.addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return openDetail(p.id);
      e.stopPropagation();
      if (b.dataset.act === "addr") addressModal(p.id);
      else if (b.dataset.act === "auto") send({ type: "cmd", id: p.id, action: "auto_find" });
    });
    grid.appendChild(el);
    panelEls.set(p.id, el);
  });
}
function panelFaceFor(p, idx) {
  const n = fleet.length;
  // a finished job takes the panel for CELEBRATE_MS - but never over a fault,
  // which keeps its own face plus the blinking lamp and flashing bezel
  if (celebrating(p.id) && p.state !== "error" && p.state !== "offline")
    return ["complete", faceComplete(p)];
  // ERROR / OFFLINE panels never rest: the fault text stays up between camera turns.
  const frozen = p.state === "error" || p.state === "offline";
  // With a multi-printer fleet the camera hops from panel to panel, so only one
  // relay is ever open. A solo printer has no one to hand off to, so it gets the
  // camera on one turn in three instead (idx === camHolder % 1 would pin it there).
  // A lost printer that's asking for an address, or being searched for, holds its face:
  // the ENTER ADDRESS button mustn't vanish on a camera turn (there's no picture anyway).
  if (p.state === "offline" && needsAddress(p)) return ["status", faceStatus(p)];
  const camTurn = n > 1 ? idx === camHolder % n : tick % 3 === 2;
  if (camTurn) return ["cam", faceCam(p)];
  if (frozen) return ["status", faceStatus(p)];
  // Status alternates with a resting instrument for every printer that isn't in a
  // fault, printing included. Period 3, not 2: camHolder advances with tick, so at
  // two printers a tick % 2 test lands every rest turn exactly where the status turn
  // should be and the readout never shows. 3 is coprime with that rotation.
  const phase = n > 1 ? (((tick - idx) % 3) + 3) % 3 : tick % 3;
  if (phase === 1) {
    // `turn` grows by exactly one between a panel's animation turns (they come every 3
    // ticks), so it advances the instrument and a panel doesn't show the same one forever.
    // tick only moves on the 10s cycle, so the face stays put between renders and telemetry
    // pushes don't swap it mid-view.
    // Count the animation turns this panel actually got. The camera rotation takes some of
    // them, and at two printers it takes every other one, so any formula on `tick` would
    // show one panel only some of the faces and the other the rest.
    let r = animTurns.get(p.id);
    if (!r || r.tick !== tick) { r = { tick, n: r ? r.n + 1 : idx }; animTurns.set(p.id, r); }
    if (hasLayers(p)) {
      // Printing/paused panels cycle the layer stack, the progress cube, and one of the
      // ambient instruments (mockups/layer-stack-mockup.html, progress-cube-mockup.html):
      // the data faces are in addition to the instruments, not instead of them.
      const k = r.n % 3;
      if (k === 0) return ["stack", faceStack(p)];
      if (k === 1) return ["cube", faceCube(p)];
      const kind = REST_KINDS[((r.n - 2) / 3) % REST_KINDS.length];
      return ["rest-" + kind, faceRest(kind)];
    }
    // Idle panels: the three instruments plus the cube in STANDBY.
    const k = r.n % (REST_KINDS.length + 1);
    if (k === REST_KINDS.length) return ["cube", faceCube(p)];
    return ["rest-" + REST_KINDS[k], faceRest(REST_KINDS[k])];
  }
  return ["status", faceStatus(p)];
}
function renderFleet(forceFaces) {
  ensurePanels();
  fleet.forEach((p, i) => {
    const el = panelEls.get(p.id);
    el.className = "ppanel" + (p.state === "error" ? " error" : "");
    el.querySelector(".lamp").className = "lamp " + p.state;
    el.querySelector(".pname").textContent = p.name;
    el.querySelector(".pmodel").textContent = p.model;
    const body = el.querySelector(".pbody");
    const [faceKey, html] = panelFaceFor(p, i);
    // re-render if the face kind changed, or refresh data on a status face.
    // A live camera face is left alone: rebuilding it mints a new ?t= URL, which
    // drops and reopens the relay — at ~1 FPS that can cost every frame.
    if (body.dataset.face !== faceKey ||
        (faceKey === "status" && body.dataset.stamp !== stamp(p)) ||
        (forceFaces && faceKey !== "cam" && faceKey !== "complete")) {
      body.dataset.face = faceKey; body.dataset.stamp = stamp(p);
      body.innerHTML = html; mountAnims(body);
    }
  });
  renderStatusbar();
}
const stamp = p => [p.state, p.percent, p.layer, p.nozzle, p.bed, p.file, p.remaining_min,
  JSON.stringify(p.address || {}, (k, v) => k === "offline_s" || k === "ask_left_s" ? undefined : v)].join("|");

function renderStatusbar() {
  const counts = { idle: 0, printing: 0, paused: 0, error: 0, offline: 0 };
  fleet.forEach(p => counts[p.state]++);
  const asking = fleet.filter(p => p.state === "offline" && p.address?.mode === "ask").length;
  document.getElementById("chips").innerHTML = `
    <span class="fleetchip"><span class="dot idle"></span>${counts.idle} IDLE</span>
    <span class="fleetchip"><span class="dot print"></span>${counts.printing + counts.paused} PRINTING</span>
    <span class="fleetchip"><span class="dot err"></span>${counts.error} ERROR</span>
    <span class="fleetchip"><span class="dot off"></span>${counts.offline} OFFLINE</span>`
    + (asking ? `<span class="fleetchip needchip"><span class="dot"></span>${asking} NEEDS ADDRESS</span>` : "");
}
function renderLink() {
  const el = document.getElementById("link");
  el.textContent = wsUp ? "LINK OK" : "LINK DOWN";
  el.className = "linkstate" + (wsUp ? "" : " down");
}

/* face cycling */
setInterval(() => {
  if (currentView.name !== "fleet" || document.hidden || !fleet.length) return;
  tick++; camHolder = (camHolder + 1) % fleet.length;
  renderFleet(true);
}, CYCLE_MS);

/* ================= detail view ================= */
function openDetail(id) {
  currentView = { name: "detail", id };
  elFleet.classList.add("hidden"); elDetail.classList.remove("hidden");
  renderDetail(true);
}
function closeDetail() {
  currentView = { name: "fleet", id: null };
  elDetail.classList.add("hidden"); elFleet.classList.remove("hidden");
  clearTimeout(celebTimer); detailCeleb = null;
  elDetail.innerHTML = ""; // drop the camera <img> so the relay closes
  renderFleet(true);
}
let detailCeleb = null;   // what the current detail DOM was built for
let celebTimer = null;    // one-shot swap back when the flourish expires

function renderDetail(full) {
  const p = fleet.find(x => x.id === currentView.id);
  if (!p) { closeDetail(); return; }
  // the detail view only rebuilds on `full`, so force one when the flourish
  // starts or ends - otherwise it would never appear, or never leave
  const celeb = celebrating(p.id) && p.state !== "error" && p.state !== "offline";
  if (celeb !== detailCeleb) full = true;
  if (full || !elDetail.firstChild) {
    detailCeleb = celeb;
    clearTimeout(celebTimer);
    if (celeb) {
      // fleet panels get swapped by the 10s cycle; the detail view has no such
      // tick, so schedule the hand-back explicitly
      celebTimer = setTimeout(() => {
        if (currentView.name === "detail" && currentView.id === p.id) renderDetail(true);
      }, Math.max(250, (celebrateUntil.get(p.id) || 0) - Date.now() + 120));
    }
    const camHtml = celeb
      ? `<canvas class="bganim" data-anim="complete" data-t0="${(celebrateUntil.get(p.id) || Date.now()) - CELEBRATE_MS}" style="width:100%;height:250px"></canvas>`
      : (p.camera === "none" || p.state === "offline")
      ? `<canvas class="bganim" data-anim="radar" style="width:100%;height:250px"></canvas>
         <span class="camtag nosig">NO SIGNAL</span>`
      : p.camera === "demo"
      ? `<canvas class="bganim" data-anim="camdemo" style="width:100%;height:250px"></canvas>
         <span class="camtag rec">LIVE · DEMO</span>`
      : `<img src="/cam/${p.id}?t=${Date.now()}" alt="">
         <span class="camtag rec">LIVE · ${p.camera === "chamber" ? "CHAMBER ~1FPS" : "RTSPS"}</span>`;
    elDetail.innerHTML = `
      <div class="dhead">
        <button class="backbtn" id="back">◂ FLEET OVERVIEW</button>
        <span class="lamp ${p.state}" id="dlamp"></span>
        <span class="dname nameglow">${esc(p.name)}</span>
        <span style="color:var(--text-dim);font-size:9px;letter-spacing:.25em">${esc(p.model)}</span>
        <span class="dstate" id="dstate"></span>
      </div>
      <div class="detailgrid">
        <div class="dblock">
          <div class="dcrt cam">${camHtml}</div>
          <div class="ctrls">
            <button class="cbtn warn" id="btn-pause"></button>
            <button class="cbtn stop" id="btn-stop">■ STOP</button>
            <button class="cbtn" id="btn-light">☼ LIGHT</button>
            <button class="cbtn wide" id="btn-start">▲ START PRINT…</button>
          </div>
        </div>
        <div class="dblock"><div class="dcrt" id="telem"></div></div>
      </div>
      <button class="fleetfab" id="fab" title="Back to the fleet overview (Esc)">▦ FLEET</button>`;
    document.getElementById("back").onclick = closeDetail;
    document.getElementById("fab").onclick = closeDetail;
    document.getElementById("btn-stop").onclick = () => confirmStop(p.id);
    document.getElementById("btn-start").onclick = () => startPrintModal(p.id);
    document.getElementById("btn-light").onclick = () => {
      const cur = fleet.find(x => x.id === p.id);
      send({ type: "cmd", id: p.id, action: "light", on: cur?.light !== "on" });
    };
    document.getElementById("btn-pause").onclick = () => {
      const cur = fleet.find(x => x.id === p.id);
      send({ type: "cmd", id: p.id, action: cur?.state === "paused" ? "resume" : "pause" });
    };
    mountAnims(elDetail);
  }
  // live-updating parts
  // the header is only built on a full render, so keep its lamp in step with the state
  document.getElementById("dlamp").className = "lamp " + p.state;
  document.getElementById("dstate").textContent =
    stateWord[p.state] + (p.percent != null && (p.state === "printing" || p.state === "paused") ? ` · ${p.percent}%` : "");
  const bp = document.getElementById("btn-pause");
  bp.textContent = p.state === "paused" ? "▶ RESUME" : "⏸ PAUSE";
  bp.disabled = !(p.state === "printing" || p.state === "paused" || p.state === "error");
  document.getElementById("btn-stop").disabled = !(p.state === "printing" || p.state === "paused" || p.state === "error");
  const bs = document.getElementById("btn-start");
  if (p.state === "offline" && p.address) {
    bs.textContent = "⌨ SET ADDRESS…"; bs.className = "cbtn wide addr"; bs.disabled = false;
    bs.onclick = () => addressModal(p.id);
  } else {
    bs.textContent = "▲ START PRINT…"; bs.className = "cbtn wide"; bs.disabled = p.state === "printing";
    bs.onclick = () => startPrintModal(p.id);
  }
  if (p.state === "offline" && p.address?.last_ip)
    document.getElementById("dstate").textContent = `OFFLINE · LAST SEEN ${p.address.last_ip}`;
  const slots = (p.ams || []).slice(0, 4);
  // On a wide screen a progress block heads this column: the fleet panels' reticle beside
  // file, time left and layer, which then drop out of the grid below (CSS hides the
  // .inprog cells). Elsewhere the block is hidden and the grid shows them as before.
  // Approved as option B of mockups/detail-view-mockup.html (issue #6).
  const busy = p.state === "printing" || p.state === "paused" || p.state === "error";
  const tint = { paused: "vi", error: "al" }[p.state] || "";
  const progress = busy ? `
    <div class="dprog">
      <canvas class="reticle" data-pct="${p.percent ?? 0}"${tint ? ` data-col="${tint}"` : ""}
        data-label="${{ printing: "COMPLETE", paused: "PAUSED", error: "HELD" }[p.state]}"></canvas>
      <div>
        <div class="tl">FILE</div><div class="file">${esc(p.file) || "—"}</div>
        <div class="tl">TIME LEFT</div><div class="big ${tint}">${p.state === "printing" ? fmtEta(p.remaining_min) : "HELD"}</div>
        <div class="tl">LAYER</div><div class="mid">${p.layer ?? "—"}<small> / ${p.total_layers ?? "—"}</small></div>
      </div>
    </div>` : `
    <div class="dprog noret"><div>
      <div class="tl">LAST JOB</div><div class="file">${esc(p.file) || "—"}</div>
      <div class="tl">STATUS</div><div class="big ${p.state}">${p.state === "offline" ? "OFFLINE" : "READY"}</div>
    </div></div>`;
  document.getElementById("telem").innerHTML = `${progress}
    <div class="telem">
      <div class="tcell inprog"><div class="tl">FILE</div><div class="tv file">${esc(p.file) || "—"}</div></div>
      <div class="tcell inprog"><div class="tl">TIME LEFT</div><div class="tv warm">${fmtEta(p.remaining_min)}</div></div>
      <div class="tcell inprog"><div class="tl">LAYER</div><div class="tv">${p.layer ?? "—"}<small> / ${p.total_layers ?? "—"}</small></div></div>
      <div class="tcell"><div class="tl">SPEED</div><div class="tv">${esc(p.speed) || "—"}</div></div>
      <div class="tcell"><div class="tl">NOZZLE</div><div class="tv warm">${p.nozzle ?? "—"}°<small> / ${p.nozzle_target ?? "—"}°</small></div></div>
      <div class="tcell"><div class="tl">BED</div><div class="tv warm">${p.bed ?? "—"}°<small> / ${p.bed_target ?? "—"}°</small></div></div>
      <div class="tcell"><div class="tl">CHAMBER</div><div class="tv">${p.chamber ?? "—"}°</div></div>
      <div class="tcell"><div class="tl">PART FAN</div><div class="tv">${p.fan ?? "—"}<small>%</small></div></div>
    </div>
    ${p.hms?.length ? `<div class="hmsbox">${p.hms.map(hmsCode).join("<br>")}</div>` : ""}
    ${slots.length ? `<div class="amslbl">AMS · ${slots.length} SLOTS</div>
      <div class="ams">${slots.map(t => `
        <div class="slot"><i style="${t.color ? `background:${esc(t.color)}` : ""}"></i>${esc(t.type) || "—"}</div>`).join("")}
      </div>` : ""}`;
  // redrawn with each push; hidden (zero-size) outside the wide layout, where fit() skips it
  document.querySelectorAll("#telem canvas.reticle").forEach(cv =>
    reticle(cv, +cv.dataset.pct || 0, { al: AL, vi: VI }[cv.dataset.col] || AM, cv.dataset.label));
}

/* ================= lost printers: address prompt + search (v1.8) =================
   Approved in mockups/address-prompt-mockup.html. When a printer has been offline for
   discovery.rediscover_after_s, the server sets address.mode to "ask"; after AUTO-FIND (or
   discovery.ask_timeout_s with no answer) it becomes "auto" while rediscovery searches. */
const needsAddress = p => p.address && p.address.mode !== "normal";
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, "0")}`;
// Server times arrive as seconds-at-push; count locally from then. data-up counts up,
// data-down counts down, both from data-t0 (the moment the face was rendered).
function timer(sec, dir) {
  return sec == null ? "—" :
    `<b data-${dir}="${sec}" data-t0="${Date.now()}">${mmss(sec)}</b>`;
}
setInterval(() => {
  const now = Date.now();
  document.querySelectorAll("[data-up],[data-down]").forEach(e => {
    const dt = (now - +e.dataset.t0) / 1000;
    e.textContent = mmss(e.dataset.up != null ? +e.dataset.up + dt : Math.max(0, +e.dataset.down - dt));
  });
}, 1000);
function faceAsk(p) {
  const a = p.address;
  const where = a.last_ip ? `NO ANSWER AT <b>${esc(a.last_ip)}</b> FOR ${timer(a.offline_s, "up")}<br>
    ITS ADDRESS MAY HAVE CHANGED.` : `NO ADDRESS YET — NOT IN CONFIG.JSON<br>AND NOT ANNOUNCED ON THE LAN.`;
  const clock = a.ask_left_s != null
    ? `AUTO-FIND STARTS IN ${timer(a.ask_left_s, "down")} IF NOBODY ANSWERS`
    : `WAITING FOR AN ANSWER`;
  return `
    <div class="statword offline">OFFLINE</div>
    <div class="askline">${where}</div>
    <div class="askrow">
      <button class="cbtn addr" data-act="addr">⌨ ENTER ADDRESS</button>
      <button class="cbtn" data-act="auto">⌖ AUTO-FIND</button>
    </div>
    <div class="askclock">${clock}</div>`;
}
function faceSearch(p) {
  const a = p.address, s = a.search || {};
  const how = s.scan_stopped
    ? `SSDP SEARCH ONLY · SUBNET SCAN STOPPED<br>AFTER ${s.scans} EMPTY PASSES`
    : s.subnets?.length ? `SSDP SEARCH, THEN SCAN OF ${s.subnets.map(esc).join(", ")}` : `SSDP SEARCH`;
  const clock = s.next_s == null ? `SEARCHING…`
    : (s.scan_limit && !s.scan_stopped ? `SEARCH ${s.scans + 1} OF ${s.scan_limit} · ` : ``)
      + `NEXT IN ${timer(s.next_s, "down")}`;
  return `
    <canvas class="searchbox" data-anim="radar"></canvas>
    <div class="statword offline">OFFLINE</div>
    <div class="askline"><b>SEARCHING THE NETWORK…</b><br>${how}
      ${a.last_ip ? `<br>LAST SEEN AT ${esc(a.last_ip)}` : ""}</div>
    <div class="askrow"><button class="cbtn addr" data-act="addr">⌨ ENTER ADDRESS</button></div>
    <div class="askclock">${clock}</div>`;
}
const validIp = s => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s);
let addrDialog = null;   // {id, show(msg)} while the address dialog is open
function addressModal(id) {
  const p = fleet.find(x => x.id === id); if (!p) return;
  closeModal();
  const last = p.address?.last_ip || p.address?.ip || "";
  let addr = last.replace(/\d+$/, ""), remember = true, busy = false;
  const dim = document.createElement("div"); dim.className = "dim";
  dim.innerHTML = `<div class="modal cyanline addrmodal"><div class="inner">
    <h3>⌨ SET ADDRESS — ${esc(p.name)}</h3>
    <p>${last ? `${esc(p.name)} stopped answering at <span style="color:#bfe9ff">${esc(last)}</span>.`
              : `${esc(p.name)} has no address yet.`}
      Type its current address. It's on the printer's screen under Settings → Network.
      Or let the console search for it.</p>
    <div class="addrshow" id="as"></div>
    <div class="addrhint" id="ah"></div>
    <div class="keypad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-k="${n}">${n}</button>`).join("")}
      <button data-k=".">.</button><button data-k="0">0</button><button data-k="bs" class="fn">⌫</button></div>
    <div class="remember" id="rm"><span class="box">✓</span>SAVE TO CONFIG.JSON</div>
    <div id="res"></div>
    <div class="row">
      <button class="cbtn addr" style="flex:1.2" id="go">CONNECT</button>
      <button class="cbtn" style="flex:1" id="af">⌖ AUTO-FIND</button>
      <button class="cbtn later" style="flex:.8" id="later">LATER</button>
    </div></div></div>`;
  document.body.appendChild(dim); pendingModal = dim;
  const $ = q => dim.querySelector(q);
  const close = () => { addrDialog = null; closeModal(); };
  function draw() {
    $("#as").innerHTML = (esc(addr) || '<span style="color:#33507c">0.0.0.0</span>') + '<span class="cur"></span>';
    const tooBig = addr.split(".").some(x => x !== "" && +x > 255);
    $("#as").classList.toggle("bad", tooBig);
    $("#ah").className = "addrhint" + (tooBig ? " bad" : "");
    $("#ah").textContent = tooBig ? "EACH PART MUST BE 0–255" : validIp(addr) ? "" : "FOUR NUMBERS SEPARATED BY DOTS";
    $("#go").disabled = !validIp(addr) || busy;
  }
  function key(k) {
    if (busy) return;
    if (k === "bs") addr = addr.slice(0, -1);
    else if (k === ".") { if (addr && !addr.endsWith(".") && addr.split(".").length < 4) addr += "."; }
    else if (addr.split(".").pop().length < 3 && addr.length < 15) addr += k;
    $("#res").innerHTML = ""; draw();
  }
  dim.querySelectorAll("[data-k]").forEach(b => b.onclick = () => key(b.dataset.k));
  // Consume the keys the dialog handles. Without this, Enter also "clicks" whatever button
  // still has focus (the panel's ENTER ADDRESS button), reopening a fresh dialog.
  document.activeElement?.blur?.();
  const onKey = e => {
    if (!dim.isConnected) return document.removeEventListener("keydown", onKey, true);
    if (/^[0-9.]$/.test(e.key)) key(e.key);
    else if (e.key === "Backspace") key("bs");
    else if (e.key === "Enter") { if (!$("#go").disabled) $("#go").click(); }
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  document.addEventListener("keydown", onKey, true);
  $("#rm").onclick = () => { remember = !remember; $("#rm .box").textContent = remember ? "✓" : ""; };
  $("#later").onclick = close;
  $("#af").onclick = () => {
    send({ type: "cmd", id, action: "auto_find" });
    close(); toast(`SEARCHING THE NETWORK FOR ${p.name}`);
  };
  $("#go").onclick = () => {
    if (!wsUp) { $("#res").innerHTML = `<div class="result warn">LINK TO THE CONSOLE IS DOWN — TRY AGAIN IN A MOMENT.</div>`; return; }
    busy = true; draw();
    $("#res").innerHTML = `<div class="result testing"><span class="spin"></span>TESTING ${esc(addr)} — LOGGING IN WITH ${esc(p.name)}'S ACCESS CODE…</div>`;
    send({ type: "cmd", id, action: "set_address", ip: addr, save: remember });
  };
  addrDialog = {
    id,
    show(msg) {
      busy = false;
      if (msg.result === "ok") {
        const saved = msg.saved ? " SAVED TO CONFIG.JSON."
          : msg.save_error ? ` COULD NOT SAVE (${esc(msg.save_error)}); USING IT UNTIL RESTART.`
          : " THIS SESSION ONLY.";
        $("#res").innerHTML = `<div class="result ok">✓ CONNECTED — ${esc(p.name)} IS AT ${esc(msg.ip)}.${saved}</div>`;
        setTimeout(() => { if (addrDialog?.id === id) close(); }, msg.save_error ? 4000 : 1800);
      } else if (msg.result === "refused") {
        $("#res").innerHTML = `<div class="result warn">A PRINTER ANSWERED AT ${esc(msg.ip)}, BUT IT ISN'T ${esc(p.name)} — IT REFUSED THIS PRINTER'S ACCESS CODE. CHECK THE ADDRESS ON ${esc(p.name)}'S OWN SCREEN.</div>`;
      } else {
        $("#res").innerHTML = `<div class="result warn">NOTHING ANSWERED AT ${esc(msg.ip)}. CHECK THE NUMBER, OR TRY AUTO-FIND.</div>`;
      }
      draw();
    },
  };
  draw();
}
function addressResult(msg) {
  if (addrDialog && addrDialog.id === msg.id) addrDialog.show(msg);
  else if (msg.result === "ok") toast(`${msg.id.toUpperCase()} CONNECTED AT ${msg.ip}`);
}

/* ================= modals ================= */
addEventListener("keydown", e => {
  if (e.key === "Escape" && currentView.name === "detail" && !pendingModal) closeDetail();
});
function closeModal() { pendingModal?.remove(); pendingModal = null; }
function confirmStop(id) {
  const p = fleet.find(x => x.id === id); if (!p) return;
  closeModal();
  const dim = document.createElement("div"); dim.className = "dim";
  dim.innerHTML = `<div class="modal"><div class="inner">
    <h3>■ STOP PRINT?</h3>
    <p>${esc(p.name)} is ${p.percent ?? 0}% through <span style="color:#bfe9ff">${esc(p.file) || "the current job"}</span>.
       Stopping cannot be resumed — the job restarts from zero.</p>
    <div class="row">
      <button class="cbtn stop" style="flex:1" id="mm-yes">CONFIRM STOP</button>
      <button class="cbtn" style="flex:1" id="mm-no">KEEP PRINTING</button>
    </div></div></div>`;
  document.body.appendChild(dim); pendingModal = dim;
  dim.querySelector("#mm-no").onclick = closeModal;
  dim.querySelector("#mm-yes").onclick = () => { send({ type: "cmd", id, action: "stop" }); closeModal(); toast("STOP SENT"); };
}
async function startPrintModal(id) {
  const p = fleet.find(x => x.id === id); if (!p) return;
  closeModal();
  const dim = document.createElement("div"); dim.className = "dim";
  dim.innerHTML = `<div class="modal cyanline"><div class="inner">
    <h3>▲ START PRINT — ${esc(p.name)}</h3>
    <div class="upl" id="mm-upl">⇪ DROP A SLICED .3MF HERE OR TAP TO UPLOAD</div>
    <input type="file" id="mm-file" accept=".3mf,.gcode" style="display:none">
    <ul class="flist" id="mm-list"><li class="empty">READING SD CARD…</li></ul>
    <div class="row">
      <button class="cbtn" style="flex:1;border-color:var(--amber);color:var(--amber)" id="mm-go" disabled>START</button>
      <button class="cbtn" style="flex:1" id="mm-cancel">CANCEL</button>
    </div></div></div>`;
  document.body.appendChild(dim); pendingModal = dim;
  const list = dim.querySelector("#mm-list"), go = dim.querySelector("#mm-go"),
        upl = dim.querySelector("#mm-upl"), fileInput = dim.querySelector("#mm-file");
  let selected = null;
  dim.querySelector("#mm-cancel").onclick = closeModal;
  go.onclick = () => {
    if (!selected) return;
    send({ type: "cmd", id, action: "start_print", file: selected });
    closeModal(); toast("PRINT COMMAND SENT — " + selected);
  };
  function fillList(files) {
    list.innerHTML = files.length
      ? files.map(f => `<li data-n="${esc(f.name)}">${esc(f.name)}<span>${f.size ? (f.size / 1048576).toFixed(1) + " MB" : ""}</span></li>`).join("")
      : `<li class="empty">NO .3MF / .GCODE FILES ON SD CARD</li>`;
    list.querySelectorAll("li[data-n]").forEach(li => li.onclick = () => {
      list.querySelectorAll("li").forEach(x => x.classList.remove("sel"));
      li.classList.add("sel"); selected = li.dataset.n;
      go.disabled = false; go.textContent = "START · " + selected.replace(/\.(3mf|gcode)$/i, "");
    });
  }
  async function refresh() {
    try {
      const r = await fetch(`/api/${id}/files`);
      if (!r.ok) throw new Error(await r.text());
      fillList((await r.json()).files);
    } catch (e) { list.innerHTML = `<li class="empty">SD LIST FAILED — ${esc(e.message)}</li>`; }
  }
  refresh();
  upl.onclick = () => fileInput.click();
  fileInput.onchange = () => fileInput.files[0] && doUpload(fileInput.files[0]);
  upl.ondragover = e => { e.preventDefault(); };
  upl.ondrop = e => { e.preventDefault(); e.dataTransfer.files[0] && doUpload(e.dataTransfer.files[0]); };
  async function doUpload(file) {
    upl.textContent = "UPLOADING " + file.name.toUpperCase() + "…"; upl.classList.add("busy");
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await fetch(`/api/${id}/upload`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(await r.text());
      const { name } = await r.json();
      upl.textContent = "UPLOADED — " + name.toUpperCase();
      await refresh();
      const li = list.querySelector(`li[data-n="${CSS.escape(name)}"]`); li?.click();
    } catch (e) { upl.textContent = "UPLOAD FAILED — " + e.message; }
    finally { upl.classList.remove("busy"); }
  }
}

/* ================= glue ================= */
function onFleetUpdate() {
  if (currentView.name === "fleet") renderFleet(false);
  else renderDetail(false);
}
setInterval(() => {
  document.getElementById("clock").textContent = new Date().toTimeString().slice(0, 8);
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentView.name === "fleet") renderFleet(true);
});
connect();

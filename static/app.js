/* Lab Console frontend — vanilla JS, no build step. */
"use strict";

const CY = "#3fd8ff", AM = "#ffc94d", AL = "#ff5a2a", GR = "#1a3a8f", VI = "#b06cff";
const CYCLE_MS = 8000;
const REST_KINDS = ["orbit", "radar", "scan"];

let fleet = [];            // latest printer views from the server
let ws = null, wsUp = false;
let camHolder = 0, tick = 0;
let currentView = { name: "fleet", id: null }; // or {name:"detail", id}
let pendingModal = null;

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
      document.getElementById("demobadge").classList.toggle("hidden", !msg.demo);
      onFleetUpdate();
    }
    else if (msg.type === "error") toast(msg.detail, true);
  };
}
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
      const g = c.createConicGradient(a, cx, cy);
      g.addColorStop(0, "rgba(63,216,255,.35)"); g.addColorStop(.12, "rgba(63,216,255,0)"); g.addColorStop(1, "rgba(63,216,255,0)");
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
function mountAnims(root) {
  root.querySelectorAll("canvas[data-anim]").forEach(cv => {
    ({ radar, orbit, scan, camdemo: camDemo })[cv.dataset.anim]?.(cv);
  });
  root.querySelectorAll("canvas.wedge").forEach(cv =>
    wedge(cv, +cv.dataset.pct || 0, cv.dataset.col === "al" ? AL : AM));
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
      <span class="facechip">STATUS</span>`;
  }
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
function faceRest(kind) {
  return `<canvas class="bganim" data-anim="${kind}"></canvas><span class="facechip">SCANNER · RESTING</span>`;
}
function faceCam(p) {
  if (p.camera === "none" || p.state === "offline")
    return `<canvas class="bganim" data-anim="scan"></canvas>
      <span class="camtag dim">NO SIGNAL</span>
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
      <div class="phead"><span class="lamp"></span><span class="pname"></span><span class="pmodel"></span></div>
      <div class="pbody"></div></div>`;
    el.addEventListener("click", () => openDetail(p.id));
    grid.appendChild(el);
    panelEls.set(p.id, el);
  });
}
function panelFaceFor(p, idx) {
  if (idx === camHolder % fleet.length) return ["cam", faceCam(p)];
  if (p.state === "error" || p.state === "offline") return ["status", faceStatus(p)];
  if (tick % 2 === 1 && (p.state === "idle"))
    return ["rest-" + REST_KINDS[idx % REST_KINDS.length], faceRest(REST_KINDS[idx % REST_KINDS.length])];
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
    // re-render if the face kind changed, or refresh data on a status face
    if (forceFaces || body.dataset.face !== faceKey ||
        (faceKey === "status" && body.dataset.stamp !== stamp(p))) {
      body.dataset.face = faceKey; body.dataset.stamp = stamp(p);
      body.innerHTML = html; mountAnims(body);
    }
  });
  renderStatusbar();
}
const stamp = p => [p.state, p.percent, p.layer, p.nozzle, p.bed, p.file, p.remaining_min].join("|");

function renderStatusbar() {
  const counts = { idle: 0, printing: 0, paused: 0, error: 0, offline: 0 };
  fleet.forEach(p => counts[p.state]++);
  document.getElementById("chips").innerHTML = `
    <span class="fleetchip"><span class="dot idle"></span>${counts.idle} IDLE</span>
    <span class="fleetchip"><span class="dot print"></span>${counts.printing + counts.paused} PRINTING</span>
    <span class="fleetchip"><span class="dot err"></span>${counts.error} ERROR</span>
    <span class="fleetchip"><span class="dot off"></span>${counts.offline} OFFLINE</span>`;
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
  elDetail.innerHTML = ""; // drop the camera <img> so the relay closes
  renderFleet(true);
}
function renderDetail(full) {
  const p = fleet.find(x => x.id === currentView.id);
  if (!p) { closeDetail(); return; }
  if (full || !elDetail.firstChild) {
    const camHtml = (p.camera === "none" || p.state === "offline")
      ? `<canvas class="bganim" data-anim="radar" style="width:100%;height:250px"></canvas>
         <span class="camtag dim">NO SIGNAL</span>`
      : p.camera === "demo"
      ? `<canvas class="bganim" data-anim="camdemo" style="width:100%;height:250px"></canvas>
         <span class="camtag rec">LIVE · DEMO</span>`
      : `<img src="/cam/${p.id}?t=${Date.now()}" alt="">
         <span class="camtag rec">LIVE · ${p.camera === "chamber" ? "CHAMBER ~1FPS" : "RTSPS"}</span>`;
    elDetail.innerHTML = `
      <div class="dhead">
        <button class="backbtn" id="back">◂ FLEET</button>
        <span class="lamp ${p.state}"></span>
        <span style="color:var(--cyan)">${esc(p.name)}</span>
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
      </div>`;
    document.getElementById("back").onclick = closeDetail;
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
  document.getElementById("dstate").textContent =
    stateWord[p.state] + (p.percent != null && (p.state === "printing" || p.state === "paused") ? ` · ${p.percent}%` : "");
  const bp = document.getElementById("btn-pause");
  bp.textContent = p.state === "paused" ? "▶ RESUME" : "⏸ PAUSE";
  bp.disabled = !(p.state === "printing" || p.state === "paused" || p.state === "error");
  document.getElementById("btn-stop").disabled = !(p.state === "printing" || p.state === "paused" || p.state === "error");
  document.getElementById("btn-start").disabled = (p.state === "printing" || p.state === "offline");
  const slots = (p.ams || []).slice(0, 4);
  document.getElementById("telem").innerHTML = `
    <div class="telem">
      <div class="tcell"><div class="tl">FILE</div><div class="tv file">${esc(p.file) || "—"}</div></div>
      <div class="tcell"><div class="tl">TIME LEFT</div><div class="tv warm">${fmtEta(p.remaining_min)}</div></div>
      <div class="tcell"><div class="tl">LAYER</div><div class="tv">${p.layer ?? "—"}<small> / ${p.total_layers ?? "—"}</small></div></div>
      <div class="tcell"><div class="tl">SPEED</div><div class="tv">${esc(p.speed) || "—"}</div></div>
      <div class="tcell"><div class="tl">NOZZLE</div><div class="tv warm">${p.nozzle ?? "—"}°<small> / ${p.nozzle_target ?? "—"}°</small></div></div>
      <div class="tcell"><div class="tl">BED</div><div class="tv warm">${p.bed ?? "—"}°<small> / ${p.bed_target ?? "—"}°</small></div></div>
      <div class="tcell"><div class="tl">CHAMBER</div><div class="tv">${p.chamber ?? "—"}°</div></div>
      <div class="tcell"><div class="tl">PART FAN</div><div class="tv">${p.fan ?? "—"}<small>%</small></div></div>
    </div>
    ${slots.length ? `<div class="amslbl">AMS · ${slots.length} SLOTS</div>
      <div class="ams">${slots.map(t => `
        <div class="slot"><i style="${t.color ? `background:${esc(t.color)}` : ""}"></i>${esc(t.type) || "—"}</div>`).join("")}
      </div>` : ""}
    ${p.hms?.length ? `<div class="hmsbox">${p.hms.map(hmsCode).join("<br>")}</div>` : ""}`;
}

/* ================= modals ================= */
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

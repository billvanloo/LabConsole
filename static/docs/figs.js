/* Live figures for the Technical Archive. Small, self-contained copies of the
   console's canvas instruments so docs pages animate without loading app.js. */
"use strict";
(function () {
  const CY = "#3fd8ff", AM = "#ffc94d", AL = "#ff5a2a", GR = "#1a3a8f";

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
      c.strokeStyle = AM; c.lineWidth = 1.4; c.beginPath(); c.arc(cx, cy, 15, 0, 7); c.stroke();
      c.strokeStyle = AL; c.globalAlpha = .85; c.beginPath(); c.arc(cx, cy, 18, 0, 7); c.stroke(); c.globalAlpha = 1;
      const ox = cx + 70 * Math.cos(t), oy = cy + 70 * .62 * Math.sin(t);
      c.fillStyle = CY; c.beginPath(); c.arc(ox, oy, 3, 0, 7); c.fill();
      t += .012;
    });
  }
  function camdemo(cv) {
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
      c.fillStyle = "rgba(255,255,255,.05)";
      for (let i = 0; i < 90; i++) c.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
      t += .03;
    });
  }
  document.querySelectorAll("canvas[data-fig]").forEach(cv => {
    ({ radar, orbit, camdemo })[cv.dataset.fig]?.(cv);
  });
})();

'use strict';
/* Aparat Pro – 21 funkcji, działa w całości w przeglądarce */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CDN = {
  tf: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  esr: s => `https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-slim@1.0.0/models/x${s}/model.json`,
  jsqr: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  mp: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
  mpWasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  seg: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
};

const S = {
  stream: null, track: null, caps: {}, facing: 'environment',
  vw: 0, vh: 0, mode: 'photo',
  stab: false, hstab: false, grid: false, level: false, histo: false, peaking: false, zebra: false, torch: false,
  timer: 0, zoom: 1, hwZoom: 1, digital: 1, zMin: 1, zMax: 50,
  off: { x: 0, y: 0 }, path: { x: 0, y: 0 }, smooth: { x: 0, y: 0 }, prevProf: null,
  busy: false, recorder: null, recChunks: [], recStart: 0, tl: null,
  tilt: null, qr: null, segmenter: null, segMask: null, gallery: [], imageCapture: null,
  frameNo: 0
};

const video = $('#video'), view = $('#view'), fx = $('#fx'), hud = $('#hud');
const vctx = view.getContext('2d'), fxctx = fx.getContext('2d'), hctx = hud.getContext('2d');
const ana = document.createElement('canvas'), actx = ana.getContext('2d', { willReadFrequently: true });
const stabC = document.createElement('canvas'), sctx = stabC.getContext('2d', { willReadFrequently: true });
// mały kanwas GPU: wideo jest najpierw zmniejszane na GPU, dopiero mała klatka idzie do CPU (bez kopiowania całej klatki 1080p/4K)
const gpuC = document.createElement('canvas'), gctx = gpuC.getContext('2d');
function downscale(dst, dctx, src, sx, sy, sw, sh, w, h) {
  if (dst.width !== w || dst.height !== h) { dst.width = w; dst.height = h; }
  if (src instanceof HTMLVideoElement) {
    if (gpuC.width !== w || gpuC.height !== h) { gpuC.width = w; gpuC.height = h; }
    gctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h); dctx.drawImage(gpuC, 0, 0);
  } else dctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
}

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
function busy(on, text = 'Przetwarzanie…', p = null) {
  $('#busy').classList.toggle('hidden', !on);
  $('#busyText').textContent = text;
  $('#busyBar').style.width = p == null ? '0' : Math.round(p * 100) + '%';
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = res; s.onerror = () => rej(new Error('Nie udało się pobrać ' + src)); document.head.appendChild(s);
  });
}
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function canvasBlob(c, type = 'image/jpeg', q = 0.95) { return new Promise(r => c.toBlob(r, type, q)); }
function nextFrame() {
  return new Promise(r => {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => r());
    else setTimeout(r, 45);
  });
}

/* ================= KAMERA ================= */
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(location.protocol !== 'https:' ? 'Aparat działa tylko przez HTTPS.' : 'Ta przeglądarka nie obsługuje dostępu do aparatu.');
  }
  stopCamera();
  const tries = [
    // podgląd w 1080p/30 kl./s (płynnie); pełna rozdzielczość tylko przy zdjęciu MAX RES
    { video: { facingMode: { ideal: S.facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false },
    { video: { facingMode: { ideal: S.facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: true, audio: false }
  ];
  let err;
  for (const c of tries) { try { S.stream = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { err = e; } }
  if (!S.stream) throw err;
  S.track = S.stream.getVideoTracks()[0];
  video.srcObject = S.stream;
  await video.play().catch(() => {});
  await new Promise(r => { if (video.videoWidth) r(); else video.onloadedmetadata = () => r(); });
  S.vw = video.videoWidth; S.vh = video.videoHeight;
  S.caps = (S.track.getCapabilities && S.track.getCapabilities()) || {};
  S.imageCapture = ('ImageCapture' in window) ? new ImageCapture(S.track) : null;
  const z = S.caps.zoom;
  S.zMin = z && z.min < 1 ? z.min : 1;
  S.zMax = Math.max(50, z ? z.max : 1);
  S.torch = false; S.zoom = 1; setZoom(1);
  $('#frame').classList.toggle('mirror', S.facing === 'user');
  resetStab(); resetHStab(); buildZoomPills(); updateButtons(); buildPro();
}
function stopCamera() { if (S.stream) S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }

async function applyAdv(obj) {
  if (!S.track) return false;
  try { await S.track.applyConstraints({ advanced: [obj] }); return true; } catch (e) { return false; }
}

/* ================= ZOOM ================= */
let zTimer = null;
function setZoom(z) {
  S.zoom = clamp(z, S.zMin, S.zMax);
  const c = S.caps.zoom;
  if (c) {
    const hw = clamp(S.zoom, c.min, c.max);
    if (Math.abs(hw - S.hwZoom) > 0.01) {
      S.hwZoom = hw; clearTimeout(zTimer);
      zTimer = setTimeout(() => applyAdv({ zoom: S.hwZoom }), 40);
    }
  } else S.hwZoom = 1;
  S.digital = Math.max(1, S.zoom / S.hwZoom);
  $('#zoomVal').textContent = (S.zoom < 10 ? S.zoom.toFixed(1) : Math.round(S.zoom)) + '×';
  const t = Math.log(S.zoom / S.zMin) / Math.log(S.zMax / S.zMin);
  $('#zoomSlider').value = Math.round(t * 1000);
  layoutVideo();
  document.querySelectorAll('#zoomPills button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.z - S.zoom) < 0.05));
}
function buildZoomPills() {
  const zs = [S.zMin < 1 ? S.zMin : null, 1, 2, 5, 10, 50].filter(v => v && v <= S.zMax);
  const box = $('#zoomPills'); box.innerHTML = '';
  for (const z of zs) {
    const b = document.createElement('button'); b.dataset.z = z;
    b.textContent = (z < 1 ? z.toFixed(1) : z) + '×'; b.onclick = () => setZoom(z); box.appendChild(b);
  }
}
$('#zoomSlider').addEventListener('input', e => setZoom(S.zMin * Math.pow(S.zMax / S.zMin, e.target.value / 1000)));
// pinch
const ptrs = new Map(); let pinch0 = null;
$('#stage').addEventListener('pointerdown', e => { ptrs.set(e.pointerId, e); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: S.zoom }; } });
$('#stage').addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e);
  if (ptrs.size === 2 && pinch0) { const [a, b] = [...ptrs.values()]; setZoom(pinch0.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch0.d); }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('#stage').addEventListener(ev, e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; }));
$('#stage').addEventListener('wheel', e => { e.preventDefault(); setZoom(S.zoom * Math.exp(-e.deltaY * 0.002)); }, { passive: false });

/* ================= STABILIZACJA ================= */
const STAB_MARGIN = 1.18, AW = 192, SR = 14;
function resetStab() { S.off = { x: 0, y: 0 }; S.path = { x: 0, y: 0 }; S.smooth = { x: 0, y: 0 }; S.prevProf = null; }
function profiles(data, w, h) {
  const col = new Float32Array(w), row = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let rs = 0;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const l = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11; col[x] += l; rs += l; }
    row[y] = rs;
  }
  for (const a of [col, row]) { let m = 0; for (const v of a) m += v; m /= a.length; let sd = 0; for (let i = 0; i < a.length; i++) { a[i] -= m; sd += a[i] * a[i]; } sd = Math.sqrt(sd / a.length) || 1; for (let i = 0; i < a.length; i++) a[i] /= sd; }
  // gradient makes it robust to lighting
  for (const a of [col, row]) { for (let i = a.length - 1; i > 0; i--) a[i] = a[i] - a[i - 1]; a[0] = 0; }
  return { col, row };
}
function bestShift(cur, prev, R) {
  let best = 0, bestE = Infinity; const n = cur.length;
  for (let s = -R; s <= R; s++) {
    let e = 0, c = 0;
    for (let i = Math.max(R, s + R); i < Math.min(n - R, n + s - R); i++) { const d = cur[i] - prev[i - s]; e += d * d; c++; }
    e /= c || 1; if (e < bestE) { bestE = e; best = s; }
  }
  // sub-pixel refine (parabola)
  return best;
}
function estimateMotion(src, sx, sy, sw, sh, R = SR, store = true, ref = null) {
  const ah = Math.round(AW * sh / sw);
  downscale(stabC, sctx, src, sx, sy, sw, sh, AW, ah);
  const p = profiles(sctx.getImageData(0, 0, AW, ah).data, AW, ah);
  const prev = ref || S.prevProf; let dx = 0, dy = 0;
  if (prev && prev.col.length === p.col.length && prev.row.length === p.row.length) {
    dx = bestShift(p.col, prev.col, R); dy = bestShift(p.row, prev.row, R);
  }
  if (store) S.prevProf = p;
  return { dx: dx * sw / AW, dy: dy * sh / ah, prof: p };
}
function updateStab() {
  if (!S.stab) { S.off.x = S.off.y = 0; return; }
  const d = Math.min(S.digital, 4);
  const rw = S.vw / d, rh = S.vh / d;
  const m = estimateMotion(video, (S.vw - rw) / 2, (S.vh - rh) / 2, rw, rh);
  if (Math.abs(m.dx) > rw * 0.25 || Math.abs(m.dy) > rh * 0.25) { resetStab(); return; }
  S.path.x += m.dx; S.path.y += m.dy;
  const k = 0.07;
  S.smooth.x += (S.path.x - S.smooth.x) * k; S.smooth.y += (S.path.y - S.smooth.y) * k;
  const { cw, ch } = cropSize();
  const mx = (S.vw - cw) / 2, my = (S.vh - ch) / 2;
  let ox = S.path.x - S.smooth.x, oy = S.path.y - S.smooth.y;
  if (Math.abs(ox) > mx) { S.smooth.x = S.path.x - Math.sign(ox) * mx; ox = Math.sign(ox) * mx; }
  if (Math.abs(oy) > my) { S.smooth.y = S.path.y - Math.sign(oy) * my; oy = Math.sign(oy) * my; }
  S.off.x = ox; S.off.y = oy;
}
function cropSize() {
  if (S.hstab && HZ.cw) return { cw: HZ.cw, ch: HZ.ch };
  const f = S.digital * (S.stab ? STAB_MARGIN : 1);
  return { cw: S.vw / f, ch: S.vh / f };
}
function cropRect(W = S.vw, H = S.vh) {
  const { cw, ch } = cropSize(); const kx = W / S.vw, ky = H / S.vh;
  const x = clamp((S.vw - cw) / 2 + S.off.x, 0, S.vw - cw), y = clamp((S.vh - ch) / 2 + S.off.y, 0, S.vh - ch);
  return { x: x * kx, y: y * ky, w: cw * kx, h: ch * ky };
}

/* ================= HORYZONT + SUPER STABILIZACJA ================= */
// Blokada horyzontu (czujnik grawitacji + żyroskop) + bardzo mocna stabilizacja (analiza obrazu, duży zapas kadru)
const H_MARGIN = 1.38, HAW = 256, HSR = 18;
const HZ = {
  roll: null, accRoll: null, lastMotion: 0, lastT: 0, hasSensor: false, warned: false,
  cxy: 0, cxx: 1e-6, cyy: 1e-6, prevAcc: null, beta: null, betaT: 0,
  ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  flipVote: 0, gs: 0, gLP: null, aLP: null,
  zoomK: 1, cw: 0, ch: 0, ox: 0, oy: 0, rot: 0,
  path: { x: 0, y: 0, r: 0 }, s1: { x: 0, y: 0, r: 0 }, s2: { x: 0, y: 0, r: 0 }, prevQ: null
};
HZ.flipVote = HZ.ios ? 20 : -20;
const wrap180 = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };
const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.orientation || 0));
function resetHStab() {
  HZ.path = { x: 0, y: 0, r: 0 }; HZ.s1 = { x: 0, y: 0, r: 0 }; HZ.s2 = { x: 0, y: 0, r: 0 };
  HZ.prevQ = null; HZ.ox = HZ.oy = 0; HZ.zoomK = 1;
}
// próbka "w górę" w układzie urządzenia (x w prawo, y do góry ekranu) -> przechył względem ekranu
function feedUp(x, y, now, gyro) {
  const mag = Math.hypot(x, y); HZ.hasSensor = true;
  const dt = HZ.lastT ? clamp((now - HZ.lastT) / 1000, 0.001, 0.1) : 0.016; HZ.lastT = now;
  let acc = null;
  if (mag > 2.5) acc = wrap180(Math.atan2(-x, y) * 180 / Math.PI + screenAngle()); // telefon nie leży płasko
  if (HZ.roll == null) { if (acc != null) HZ.roll = acc; HZ.prevAcc = acc; return; }
  // automatyczne dopasowanie znaku żyroskopu (różne przeglądarki) przez korelację z akcelerometrem
  let useGyro = false, gs = 1;
  if (gyro != null && isFinite(gyro)) {
    HZ.gLP = HZ.gLP == null ? gyro : HZ.gLP + (gyro - HZ.gLP) * 0.15;
    if (acc != null) {
      const prevLP = HZ.aLP; HZ.aLP = HZ.aLP == null ? acc : wrap180(HZ.aLP + wrap180(acc - HZ.aLP) * 0.15);
      if (prevLP != null) {
        const dA = wrap180(HZ.aLP - prevLP) / dt;
        if (Math.abs(dA) < 400) { HZ.cxy = HZ.cxy * 0.99 + HZ.gLP * dA; HZ.cxx = HZ.cxx * 0.99 + HZ.gLP * HZ.gLP; HZ.cyy = HZ.cyy * 0.99 + dA * dA; }
      }
    }
    const r = HZ.cxy / Math.sqrt(HZ.cxx * HZ.cyy);
    if (Math.abs(r) > 0.5 && HZ.cyy > 2000) HZ.gs = r > 0 ? 1 : -1; // znak zapamiętany (poprawiany przy wyraźnym ruchu)
    if (HZ.gs) { useGyro = true; gs = HZ.gs; }
  }
  HZ.prevAcc = acc;
  if (useGyro) {
    HZ.roll = wrap180(HZ.roll + gs * gyro * dt);
    if (acc != null) HZ.roll = wrap180(HZ.roll + wrap180(acc - HZ.roll) * 0.03);
  } else if (acc != null) HZ.roll = wrap180(HZ.roll + wrap180(acc - HZ.roll) * 0.12);
}
function onHMotion(e) {
  const g = e.accelerationIncludingGravity; if (!g || g.x == null || g.y == null) return;
  // znak osi różni się między przeglądarkami (iOS) – sprawdzamy go kątem beta z deviceorientation
  if (HZ.beta != null && performance.now() - HZ.betaT < 1000 && Math.abs(Math.sin(HZ.beta * Math.PI / 180)) > 0.5 && Math.abs(g.y) > 4)
    HZ.flipVote = clamp(HZ.flipVote + (g.y * Math.sin(HZ.beta * Math.PI / 180) < 0 ? 1 : -1), -60, 60);
  HZ.ios = HZ.flipVote > 0;
  let x = g.x, y = g.y; if (HZ.ios) { x = -x; y = -y; }
  const rr = e.rotationRate; const gyro = rr && rr.alpha != null ? -rr.alpha : null; // obrót wokół osi ekranu
  HZ.lastMotion = performance.now(); feedUp(x, y, HZ.lastMotion, gyro);
}
function onHOrient(e) {
  if (e.beta != null) { HZ.beta = e.beta; HZ.betaT = performance.now(); }
  if (performance.now() - HZ.lastMotion < 600 || e.beta == null || e.gamma == null) return; // zapas: gdy brak devicemotion
  const b = e.beta * Math.PI / 180, gm = e.gamma * Math.PI / 180;
  feedUp(-Math.cos(b) * Math.sin(gm) * 9.81, Math.sin(b) * 9.81, performance.now(), null);
}
async function enableHorizon() {
  // iOS: zgoda musi być poproszona w kliknięciu
  try {
    const reqs = [];
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) reqs.push(DeviceMotionEvent.requestPermission());
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) reqs.push(DeviceOrientationEvent.requestPermission());
    const res = await Promise.all(reqs);
    if (res.some(r => r !== 'granted')) toast('Brak zgody na czujniki ruchu – działa tylko stabilizacja z obrazu.', 3500);
  } catch (e) { toast('Brak zgody na czujniki ruchu – działa tylko stabilizacja z obrazu.', 3500); }
  if (!HZ.listening) {
    HZ.listening = true;
    window.addEventListener('devicemotion', onHMotion);
    window.addEventListener('deviceorientation', onHOrient);
  }
  setTimeout(() => {
    if (S.hstab && !HZ.hasSensor && !HZ.warned) { HZ.warned = true; toast('Brak czujników ruchu (np. komputer) – horyzont z analizy obrazu, stabilizacja działa.', 4000); }
  }, 1500);
}
function subShift(cur, prev, R) {
  const n = cur.length, E = new Float32Array(2 * R + 1); let best = 0, bestE = Infinity;
  for (let s = -R; s <= R; s++) {
    let e = 0, c = 0;
    for (let i = Math.max(R, s + R); i < Math.min(n - R, n + s - R); i++) { const d = cur[i] - prev[i - s]; e += d * d; c++; }
    e /= c || 1; E[s + R] = e; if (e < bestE) { bestE = e; best = s; }
  }
  const i = best + R;
  if (i > 0 && i < 2 * R) { const a = E[i - 1], b = E[i], c = E[i + 1], den = a - 2 * b + c; if (den > 1e-9) return best + clamp(0.5 * (a - c) / den, -0.5, 0.5); }
  return best;
}
// ruch w 4 ćwiartkach -> przesunięcie + obrót klatki
function estimateRigid(src, sx, sy, sw, sh) {
  const ah = Math.round(HAW * sh / sw);
  downscale(stabC, sctx, src, sx, sy, sw, sh, HAW, ah);
  const qw = HAW >> 1, qh = ah >> 1, Q = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) Q.push({ p: profiles(sctx.getImageData(i * qw, j * qh, qw, qh).data, qw, qh), cx: (i + 0.5) * qw - HAW / 2, cy: (j + 0.5) * qh - ah / 2 });
  const prev = HZ.prevQ; HZ.prevQ = Q;
  if (!prev || prev[0].p.col.length !== Q[0].p.col.length || prev[0].p.row.length !== Q[0].p.row.length) return null;
  let tx = 0, ty = 0; const v = [];
  for (let k = 0; k < 4; k++) { const dx = subShift(Q[k].p.col, prev[k].p.col, HSR), dy = subShift(Q[k].p.row, prev[k].p.row, HSR); v.push([dx, dy]); tx += dx; ty += dy; }
  tx /= 4; ty /= 4;
  let num = 0, den = 0;
  for (let k = 0; k < 4; k++) { const px = Q[k].cx, py = Q[k].cy; num += px * (v[k][1] - ty) - py * (v[k][0] - tx); den += px * px + py * py; }
  let th = den ? num / den : 0; // rad, + = zgodnie z zegarem
  if (Math.abs(th) > 0.05) th = 0;
  const k = sw / HAW;
  return { dx: tx * k, dy: ty * k, dr: th * 180 / Math.PI };
}
function hGeometry() {
  const d = S.digital, cw0 = S.vw / (d * H_MARGIN), ch0 = S.vh / (d * H_MARGIN);
  const t = HZ.rot * Math.PI / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const need = Math.min(1, (S.vw * 0.47) / ((cw0 * c + ch0 * s) / 2), (S.vh * 0.47) / ((cw0 * s + ch0 * c) / 2));
  // natychmiast przybliż, gdy trzeba (żadnych czarnych rogów), oddalaj powoli
  HZ.zoomK = need < HZ.zoomK ? need : HZ.zoomK + (need - HZ.zoomK) * 0.04;
  HZ.cw = cw0 * HZ.zoomK; HZ.ch = ch0 * HZ.zoomK;
  const bx = (HZ.cw * c + HZ.ch * s) / 2, by = (HZ.cw * s + HZ.ch * c) / 2;
  return { mx: Math.max(0, S.vw / 2 - bx), my: Math.max(0, S.vh / 2 - by) };
}
function updateHStab() {
  const dd = Math.min(S.digital, 4), rw = S.vw / dd, rh = S.vh / dd;
  const m = estimateRigid(video, (S.vw - rw) / 2, (S.vh - rh) / 2, rw, rh);
  if (m && (Math.abs(m.dx) > rw * 0.2 || Math.abs(m.dy) > rh * 0.2)) { resetHStab(); }
  else if (m) { HZ.path.x += m.dx; HZ.path.y += m.dy; HZ.path.r += m.dr; }
  // dwustopniowy filtr dolnoprzepustowy toru kamery = bardzo "zablokowany" obraz
  const k = 0.03;
  for (const a of ['x', 'y', 'r']) { HZ.s1[a] += (HZ.path[a] - HZ.s1[a]) * k; HZ.s2[a] += (HZ.s1[a] - HZ.s2[a]) * k; }
  // obrót: czujnik (prawdziwy poziom) albo wygładzanie obrotu z obrazu
  const sensor = HZ.hasSensor && HZ.roll != null && performance.now() - HZ.lastT < 1500;
  if (sensor) HZ.rot = S.facing === 'user' ? -HZ.roll : HZ.roll;
  else {
    let jr = HZ.path.r - HZ.s2.r; if (Math.abs(jr) > 8) { jr = Math.sign(jr) * 8; HZ.s1.r = HZ.s2.r = HZ.path.r - jr; }
    HZ.rot = -jr;
  }
  const { mx, my } = hGeometry();
  let ox = HZ.path.x - HZ.s2.x, oy = HZ.path.y - HZ.s2.y;
  if (Math.abs(ox) > mx) { ox = Math.sign(ox) * mx; HZ.s1.x = HZ.s2.x = HZ.path.x - ox; }
  if (Math.abs(oy) > my) { oy = Math.sign(oy) * my; HZ.s1.y = HZ.s2.y = HZ.path.y - oy; }
  HZ.ox = ox; HZ.oy = oy;
}
// rysuje wypoziomowany i ustabilizowany kadr (kx/ky = skala źródła względem wideo)
function drawHStab(ctx, src, W, Hh, kx = 1, ky = 1) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, Hh);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = ctx === vctx ? 'low' : 'high'; // podgląd: szybko, zdjęcie: jakość
  ctx.translate(W / 2, Hh / 2); ctx.rotate(HZ.rot * Math.PI / 180);
  ctx.scale(W / (HZ.cw * kx), Hh / (HZ.ch * ky));
  ctx.drawImage(src, -(S.vw / 2 + HZ.ox) * kx, -(S.vh / 2 + HZ.oy) * ky);
  ctx.restore();
}
function drawHStabHud(w, h, lw) {
  const sensor = HZ.hasSensor && HZ.roll != null;
  hctx.save();
  hctx.strokeStyle = 'rgba(76,217,100,.85)'; hctx.lineWidth = lw * 2; hctx.setLineDash([w * 0.02, w * 0.012]);
  hctx.beginPath(); hctx.moveTo(w * 0.08, h / 2); hctx.lineTo(w * 0.92, h / 2); hctx.stroke(); hctx.setLineDash([]);
  const fs = Math.max(11, Math.round(w / 45)); hctx.font = `600 ${fs}px sans-serif`; hctx.textAlign = 'center';
  const txt = sensor ? `🔒 HORYZONT  ${(HZ.roll > 0 ? '+' : '') + HZ.roll.toFixed(1)}°` : '🔒 SUPER STAB · brak czujnika (poziom z obrazu)';
  const tw = hctx.measureText(txt).width + fs;
  hctx.fillStyle = 'rgba(0,0,0,.5)'; hctx.fillRect(w / 2 - tw / 2, h - fs * 2.6, tw, fs * 1.7);
  hctx.fillStyle = sensor ? '#4cd964' : '#ffb020'; hctx.fillText(txt, w / 2, h - fs * 1.35);
  hctx.restore();
}

/* ================= RENDER ================= */
const bgC = document.createElement('canvas'), bgctx = bgC.getContext('2d');
const personC = document.createElement('canvas'), pctx = personC.getContext('2d');
const maskC = document.createElement('canvas'), mctx = maskC.getContext('2d');
const segIn = document.createElement('canvas'), segctx = segIn.getContext('2d');
// czy podgląd musi iść przez kanwas? (tylko gdy coś przetwarza obraz). W przeciwnym razie pokazujemy <video> bezpośrednio (GPU, pełne kl./s)
function needCanvas() { return !!(S.stab || S.hstab || S.mode === 'portrait' || S.recCanvas); }
const vwrap = $('#vwrap');
let stageBox = null;
function stageRect() { if (!stageBox) stageBox = $('#stage').getBoundingClientRect(); return stageBox; }
window.addEventListener('resize', () => { stageBox = null; layoutVideo(); });
// ramka obrazu = prostokąt "contain" w scenie; <video> jest w niej przybliżany CSS-em (zoom cyfrowy na GPU)
function layoutVideo() {
  if (!S.vw) return;
  const st = stageRect(), asp = S.vw / S.vh;
  let w = st.width, h = w / asp; if (h > st.height) { h = st.height; w = h * asp; }
  const key = [w, h, S.digital].join();
  if (layoutVideo.k === key) return; layoutVideo.k = key;
  Object.assign(vwrap.style, { left: (st.width - w) / 2 + 'px', top: (st.height - h) / 2 + 'px', width: w + 'px', height: h + 'px' });
  video.style.transform = S.digital > 1.001 ? `scale(${S.digital})` : '';
}
function sizeCanvases() {
  const { cw, ch } = cropSize(); const asp = cw / ch;
  const st = stageRect(); const dpr = Math.min(devicePixelRatio || 1, 2);
  let w;
  if (S.recCanvas) w = Math.min(1920, Math.max(1280, Math.round(cw)));                      // nagrywanie: max 1080p
  else w = Math.min(S.mode === 'portrait' ? 1280 : 1600, Math.round(cw), Math.round(Math.min(st.width, st.height * asp) * dpr)); // rozmiar wyświetlanego obrazu (contain), nie większy
  w = Math.max(2, w & ~1); const h = Math.max(2, Math.round(w / asp) & ~1);
  if (view.width !== w || view.height !== h) { view.width = hud.width = w; view.height = hud.height = h; hudDirty = true; }
  const aw = 320, ah = Math.round(320 / asp);
  if (fx.width !== aw || fx.height !== ah) { fx.width = ana.width = aw; fx.height = ana.height = ah; }
}
// źródło do analizy: kanwas podglądu (gdy aktywny) albo wycinek wideo
function anaSource() {
  if (needCanvas() && view.width > 2) return { src: view, x: 0, y: 0, w: view.width, h: view.height };
  const r = cropRect(); return { src: video, x: r.x, y: r.y, w: r.w, h: r.h };
}
// mała klatka (GPU) do analizy: dokumenty, QR
const smallC = document.createElement('canvas'), smctx = smallC.getContext('2d');
function smallFrame(w) {
  const a = anaSource(); const h = Math.max(2, Math.round(w * a.h / a.w));
  if (smallC.width !== w || smallC.height !== h) { smallC.width = w; smallC.height = h; }
  smctx.drawImage(a.src, a.x, a.y, a.w, a.h, 0, 0, w, h); return { c: smallC, a };
}
const FPS = { n: 0, t0: performance.now(), val: 0, show: true, last: 0 };
let canvasOn = null, hudDirty = true;
function tick(now) {
  if (!S.stream || !S.vw || video.readyState < 2) return;
  FPS.last = performance.now();
  S.frameNo++; FPS.n++;
  if (FPS.last - FPS.t0 >= 1000) { FPS.val = FPS.n * 1000 / (FPS.last - FPS.t0); FPS.n = 0; FPS.t0 = FPS.last; updateFpsLabel(); }
  if (video.videoWidth !== S.vw) { S.vw = video.videoWidth; S.vh = video.videoHeight; resetStab(); resetHStab(); layoutVideo(); }
  const nc = needCanvas();
  if (nc !== canvasOn) { canvasOn = nc; view.classList.toggle('hidden', !nc); vwrap.classList.toggle('under', nc); if (!nc) { HZ.cw = 0; } updateFpsLabel(); }
  if (nc) {
    if (S.hstab) { updateHStab(); sizeCanvases(); drawHStab(vctx, video, view.width, view.height); }
    else {
      updateStab(); sizeCanvases();
      const r = cropRect();
      vctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, view.width, view.height);
    }
    if (S.mode === 'portrait') portraitLive();
  } else { S.off.x = S.off.y = 0; layoutVideo(); sizeCanvases(); }
  // analiza na małych klatkach, co 2. klatkę
  if (S.frameNo % 2 === 0) drawFx();
  drawHud();
  if (S.mode === 'qr' && now - (S.qrT || 0) > 250) { S.qrT = now; scanQR(); }
  if (S.mode === 'doc' && now - (S.docT || 0) > 400) { S.docT = now; const { c } = smallFrame(220); const q = detectDoc(c, 220); S.docLive = q.found ? q.pts.map(p => ({ x: p.x / c.width, y: p.y / c.height })) : null; }
}
function updateFpsLabel() {
  const el = $('#fps'); el.classList.toggle('hidden', !FPS.show);
  if (FPS.show) el.textContent = `${Math.round(FPS.val)} kl./s · ${canvasOn ? 'kanwas' : 'GPU'} · ${S.vw}×${S.vh}`;
}
// pętla: requestVideoFrameCallback (tylko nowe klatki z aparatu), zapas: requestAnimationFrame
let loopStarted = false;
function startLoop() {
  if (loopStarted) return; loopStarted = true;
  if (video.requestVideoFrameCallback) {
    const cb = now => { tick(now); video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
    // strażnik: gdyby callbacki stanęły (np. po zmianie kamery), dociągamy przez rAF
    setInterval(() => { if (S.stream && performance.now() - FPS.last > 400) requestAnimationFrame(t => tick(t)); }, 300);
  } else {
    let lastTime = -1;
    const raf = t => { requestAnimationFrame(raf); if (video.currentTime !== lastTime) { lastTime = video.currentTime; tick(t); } };
    requestAnimationFrame(raf);
  }
}

/* ---- portret (rozmycie tła) ---- */
async function loadSegmenter() {
  if (S.segmenter || S.segLoading) return S.segmenter;
  S.segLoading = true;
  try {
    const mp = await import(CDN.mp);
    const fs = await mp.FilesetResolver.forVisionTasks(CDN.mpWasm);
    const opts = d => ({ baseOptions: { modelAssetPath: CDN.seg, delegate: d }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
    try { S.segmenter = await mp.ImageSegmenter.createFromOptions(fs, opts('GPU')); }
    catch (e) { S.segmenter = await mp.ImageSegmenter.createFromOptions(fs, opts('CPU')); }
  } catch (e) { console.warn(e); S.segFail = true; toast('Nie udało się załadować modelu portretu (brak internetu lub WebAssembly).'); }
  S.segLoading = false; return S.segmenter;
}
function segment(src, w, h) {
  if (!S.segmenter) return null;
  const sw = 256, sh = Math.round(256 * h / w);
  segIn.width = sw; segIn.height = sh; segctx.drawImage(src, 0, 0, sw, sh);
  let out = null;
  S.segTs = Math.max((S.segTs || 0) + 1, performance.now());
  S.segmenter.segmentForVideo(segIn, S.segTs, res => {
    const ms = res.confidenceMasks; if (!ms || !ms.length) return;
    const m = ms[ms.length > 1 ? 1 : 0];
    out = { data: m.getAsFloat32Array().slice(), w: m.width, h: m.height };
  });
  if (!out) return null;
  // automatyczna kontrola polaryzacji maski (osoba zwykle w centrum)
  let c = 0, cn = 0, b = 0, bn = 0;
  for (let y = 0; y < out.h; y += 4) for (let x = 0; x < out.w; x += 4) {
    const v = out.data[y * out.w + x];
    const edge = x < out.w * 0.08 || x > out.w * 0.92 || y < out.h * 0.06;
    const cen = Math.abs(x - out.w / 2) < out.w * 0.18 && Math.abs(y - out.h * 0.55) < out.h * 0.25;
    if (edge) { b += v; bn++; } if (cen) { c += v; cn++; }
  }
  if (bn && cn && b / bn > c / cn + 0.25) for (let i = 0; i < out.data.length; i++) out.data[i] = 1 - out.data[i];
  return out;
}
function maskToCanvas(m) {
  maskC.width = m.w; maskC.height = m.h;
  const id = mctx.createImageData(m.w, m.h);
  for (let i = 0; i < m.data.length; i++) { const a = clamp((m.data[i] - 0.35) * 3.3, 0, 1); id.data[i * 4 + 3] = a * 255; }
  mctx.putImageData(id, 0, 0); return maskC;
}
function blurInto(ctx, src, w, h, strength) {
  const k = Math.max(4, Math.round(Math.min(w, h) / strength));
  const sw = Math.max(2, Math.round(w / k)), sh = Math.max(2, Math.round(h / k));
  bgC.width = sw; bgC.height = sh; bgctx.imageSmoothingQuality = 'high'; bgctx.drawImage(src, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bgC, 0, 0, w, h);
}
function compositePortrait(ctx, w, h, mask) {
  personC.width = w; personC.height = h;
  pctx.drawImage(ctx.canvas, 0, 0);
  pctx.globalCompositeOperation = 'destination-in'; pctx.imageSmoothingEnabled = true;
  pctx.drawImage(maskToCanvas(mask), 0, 0, w, h); pctx.globalCompositeOperation = 'source-over';
  blurInto(ctx, ctx.canvas, w, h, 36);
  ctx.drawImage(personC, 0, 0);
}
function portraitLive() {
  if (!S.segmenter) { if (!S.segFail) loadSegmenter(); return; }
  if (S.frameNo % 2 === 0 || !S.segMask) { const m = segment(view, view.width, view.height); if (m) S.segMask = m; }
  if (S.segMask) compositePortrait(vctx, view.width, view.height, S.segMask);
}

/* ---- nakładki: histogram, peaking, zebra ---- */
function drawFx() {
  const need = S.histo || S.peaking || S.zebra;
  fxctx.clearRect(0, 0, fx.width, fx.height);
  if (!need) return;
  const w = ana.width, h = ana.height, a = anaSource();
  downscale(ana, actx, a.src, a.x, a.y, a.w, a.h, w, h);
  const d = actx.getImageData(0, 0, w, h).data;
  const L = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) L[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  if (S.peaking || S.zebra) {
    const out = fxctx.createImageData(w, h), o = out.data, ph = (S.frameNo >> 1) % 8;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const j = y * w + x, k = j * 4;
      if (S.zebra && L[j] > 242 && ((x + y + ph) & 7) < 4) { o[k] = 255; o[k + 1] = 40; o[k + 2] = 200; o[k + 3] = 230; continue; }
      if (S.peaking) {
        const gx = -L[j - w - 1] - 2 * L[j - 1] - L[j + w - 1] + L[j - w + 1] + 2 * L[j + 1] + L[j + w + 1];
        const gy = -L[j - w - 1] - 2 * L[j - w] - L[j - w + 1] + L[j + w - 1] + 2 * L[j + w] + L[j + w + 1];
        if (gx * gx + gy * gy > 52000) { o[k] = 255; o[k + 1] = 30; o[k + 2] = 30; o[k + 3] = 255; }
      }
    }
    fxctx.putImageData(out, 0, 0);
  }
  if (S.histo && S.frameNo % 4 === 0) drawHisto(d);
}
function drawHisto(d) {
  const c = $('#histo'), g = c.getContext('2d'), W = c.width, H = c.height;
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), hl = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { hr[d[i]]++; hg[d[i + 1]]++; hb[d[i + 2]]++; hl[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++; }
  let mx = 1; for (let i = 2; i < 254; i++) mx = Math.max(mx, hl[i], hr[i], hg[i], hb[i]);
  g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter';
  for (const [h, col] of [[hr, '#c33'], [hg, '#3c3'], [hb, '#36f'], [hl, '#777']]) {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
    for (let i = 0; i < 256; i++) g.lineTo(i * W / 255, H - Math.min(1, h[i] / mx) * H);
    g.lineTo(W, H); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}
function drawHud() {
  const w = hud.width, h = hud.height;
  const any = S.grid || (S.level && S.tilt != null) || S.mode === 'qr' || (S.mode === 'doc' && S.docLive) || S.hstab;
  if (!any && !hudDirty) return;
  hctx.clearRect(0, 0, w, h); hudDirty = any;
  const lw = Math.max(1, w / 900);
  if (S.grid) {
    hctx.strokeStyle = 'rgba(255,255,255,.45)'; hctx.lineWidth = lw; hctx.beginPath();
    for (let i = 1; i < 3; i++) { hctx.moveTo(w * i / 3, 0); hctx.lineTo(w * i / 3, h); hctx.moveTo(0, h * i / 3); hctx.lineTo(w, h * i / 3); }
    hctx.stroke();
  }
  if (S.level && S.tilt != null) {
    const a = S.tilt, ok = Math.abs(a) < 1;
    hctx.save(); hctx.translate(w / 2, h / 2);
    hctx.strokeStyle = ok ? '#4cd964' : 'rgba(255,255,255,.8)'; hctx.lineWidth = lw * 3;
    hctx.beginPath(); hctx.moveTo(-w * .22, 0); hctx.lineTo(-w * .06, 0); hctx.moveTo(w * .06, 0); hctx.lineTo(w * .22, 0); hctx.stroke();
    hctx.rotate(-a * Math.PI / 180);
    hctx.strokeStyle = ok ? '#4cd964' : '#ffb020'; hctx.beginPath(); hctx.moveTo(-w * .16, 0); hctx.lineTo(w * .16, 0); hctx.stroke();
    hctx.restore();
    hctx.fillStyle = ok ? '#4cd964' : '#fff'; hctx.font = `${Math.round(w / 40)}px sans-serif`; hctx.textAlign = 'center';
    hctx.fillText((a > 0 ? '+' : '') + a.toFixed(1) + '°', w / 2, h / 2 - w / 30);
  }
  if (S.mode === 'qr') {
    const s = Math.min(w, h) * 0.6; hctx.strokeStyle = 'rgba(255,176,32,.9)'; hctx.lineWidth = lw * 3;
    const x = (w - s) / 2, y = (h - s) / 2, c = s * 0.12; hctx.beginPath();
    [[x, y, 1, 1], [x + s, y, -1, 1], [x, y + s, 1, -1], [x + s, y + s, -1, -1]].forEach(([px, py, dx, dy]) => { hctx.moveTo(px + dx * c, py); hctx.lineTo(px, py); hctx.lineTo(px, py + dy * c); });
    hctx.stroke();
    if (S.qrBox && performance.now() - S.qrBox.t < 600) {
      hctx.strokeStyle = '#4cd964'; hctx.beginPath(); S.qrBox.pts.forEach((p, i) => i ? hctx.lineTo(p.x, p.y) : hctx.moveTo(p.x, p.y)); hctx.closePath(); hctx.stroke();
    }
  }
  if (S.hstab) drawHStabHud(w, h, lw);
  if (S.mode === 'doc' && S.docLive) {
    hctx.strokeStyle = '#4cd964'; hctx.lineWidth = lw * 3; hctx.fillStyle = 'rgba(76,217,100,.12)'; hctx.beginPath();
    S.docLive.forEach((p, i) => { const X = p.x * w, Y = p.y * h; i ? hctx.lineTo(X, Y) : hctx.moveTo(X, Y); }); hctx.closePath(); hctx.fill(); hctx.stroke();
  }
}

/* ---- poziomica ---- */
async function enableLevel() {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
      const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') throw new Error('denied');
    }
  } catch (e) { toast('Brak zgody na czujnik ruchu – poziomica nie zadziała.'); return false; }
  if (!S.motionOn) {
    S.motionOn = true;
    const ios = typeof DeviceMotionEvent !== 'undefined' && !!DeviceMotionEvent.requestPermission;
    window.addEventListener('devicemotion', e => {
      const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
      let x = g.x, y = g.y; if (ios) { x = -x; y = -y; }
      const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      let a = Math.atan2(x, y) * 180 / Math.PI + ang;
      a = ((a % 90) + 135) % 90 - 45; // odchylenie od najbliższej osi
      S.tilt = S.tilt == null ? a : S.tilt * 0.8 + a * 0.2;
    });
    setTimeout(() => { if (S.tilt == null) toast('To urządzenie nie ma czujnika położenia – poziomica niedostępna.'); }, 1500);
  }
  return true;
}

/* ---- QR / kody kreskowe ---- */
async function scanQR() {
  if (S.qrBusy || !$('#sheet').classList.contains('hidden')) return;
  S.qrBusy = true;
  try {
    let res = null;
    if ('BarcodeDetector' in window) {
      if (!S.bd) { const f = await BarcodeDetector.getSupportedFormats(); S.bd = new BarcodeDetector({ formats: f.length ? f : ['qr_code'] }); }
      const a = anaSource(); const r = await S.bd.detect(a.src);
      if (r.length) r[0].cornerPoints = r[0].cornerPoints.map(p => ({ x: (p.x - a.x) / a.w * hud.width, y: (p.y - a.y) / a.h * hud.height }));
      if (r.length) res = { text: r[0].rawValue, fmt: r[0].format, pts: r[0].cornerPoints };
    } else {
      if (!window.jsQR) await loadScript(CDN.jsqr);
      const sf = smallFrame(640), w = sf.c.width, h = sf.c.height, c = mkCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(sf.c, 0, 0);
      const q = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (q) { const k = hud.width / w, L = q.location; res = { text: q.data, fmt: 'qr_code', pts: [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner].map(p => ({ x: p.x * k, y: p.y * k })) }; }
    }
    if (res) { S.qrBox = { pts: res.pts, t: performance.now() }; if (res.text !== S.lastQR || performance.now() - S.lastQRt > 4000) { S.lastQR = res.text; S.lastQRt = performance.now(); showQR(res); } }
  } catch (e) { if (!S.qrWarned) { S.qrWarned = true; toast('Skaner kodów niedostępny: ' + e.message); } }
  S.qrBusy = false;
}
function showQR(r) {
  if (navigator.vibrate) navigator.vibrate(60);
  const isUrl = /^https?:\/\//i.test(r.text);
  openSheet('Zeskanowany kod', `<p class="note">Format: ${esc(r.fmt)}</p><div class="qrText">${esc(r.text)}</div>
  <div class="row"><button id="qrCopy">Kopiuj</button>${isUrl ? '<button id="qrOpen" class="primary">Otwórz link</button>' : ''}<button id="qrShare">Udostępnij</button></div>`);
  $('#qrCopy').onclick = () => navigator.clipboard.writeText(r.text).then(() => toast('Skopiowano'), () => toast('Nie można skopiować'));
  if (isUrl) $('#qrOpen').onclick = () => window.open(r.text, '_blank', 'noopener');
  $('#qrShare').onclick = () => navigator.share ? navigator.share({ text: r.text }).catch(() => {}) : toast('Udostępnianie nieobsługiwane');
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ================= PRZETWARZANIE OBRAZU ================= */
function sharpen(canvas, amount = 0.6) {
  if (amount <= 0) return canvas;
  const w = canvas.width, h = canvas.height, g = canvas.getContext('2d');
  const id = g.getImageData(0, 0, w, h), d = id.data, s = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const k = i + c;
      const b = (s[k - 4] + s[k + 4] + s[k - w * 4] + s[k + w * 4] + 4 * s[k]) / 8;
      d[k] = s[k] + amount * (s[k] - b) * 2;
    }
  }
  g.putImageData(id, 0, 0); return canvas;
}
// pobierz klatkę z aktualnym kadrem (zoom + stabilizacja), w pełnej rozdzielczości
function grabFrame(src = video, W = S.vw, H = S.vh, upscale = true, maxDim = 0) {
  const r = cropRect(W, H);
  let ow = r.w, oh = r.h;
  if (maxDim && Math.max(ow, oh) > maxDim) { const k = maxDim / Math.max(ow, oh); ow *= k; oh *= k; }
  if (upscale && S.digital > 1) { const k = Math.min(S.digital, 4096 / r.w, 4096 / r.h); ow = r.w * Math.max(1, k); oh = r.h * Math.max(1, k); }
  const c = mkCanvas(ow, oh), g = c.getContext('2d', { willReadFrequently: true });
  if (S.hstab && HZ.cw) { drawHStab(g, src, c.width, c.height, W / S.vw, H / S.vh); return c; }
  g.imageSmoothingQuality = 'high'; g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}
function finishZoom(c) { if (S.digital > 1.5) sharpen(c, Math.min(1, 0.25 + S.digital / 25)); return c; }

async function stackFrames(n, onP) {
  // zbiera n klatek, wyrównuje do pierwszej (ruch ręki) i uśrednia
  const first = grabFrame(video, S.vw, S.vh, false, 2400); const w = first.width, h = first.height;
  const acc = new Float32Array(w * h * 3), cnt = new Uint16Array(w * h);
  const ref = estimateMotion(first, 0, 0, w, h, 0, false).prof;
  const tmp = mkCanvas(w, h), tg = tmp.getContext('2d', { willReadFrequently: true });
  for (let f = 0; f < n; f++) {
    if (f) await nextFrame();
    const src = f ? grabFrame(video, S.vw, S.vh, false, 2400) : first;
    let dx = 0, dy = 0;
    if (f) { const m = estimateMotion(src, 0, 0, w, h, 24, false, ref); dx = Math.round(m.dx); dy = Math.round(m.dy); }
    tg.clearRect(0, 0, w, h); tg.drawImage(src, -dx, -dy);
    const d = tg.getImageData(0, 0, w, h).data;
    for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
      const p = y * w + x, i = p * 4, j = p * 3; acc[j] += d[i]; acc[j + 1] += d[i + 1]; acc[j + 2] += d[i + 2]; cnt[p]++;
    }
    onP && onP((f + 1) / n);
  }
  return { acc, cnt, w, h };
}
function boxBlurLum(L, w, h, r) {
  // szybkie rozmycie przez zmniejszenie
  const sw = Math.max(4, Math.round(w / r)), sh = Math.max(4, Math.round(h / r));
  const a = mkCanvas(w, h), ag = a.getContext('2d'); const id = ag.createImageData(w, h);
  for (let i = 0; i < L.length; i++) { const v = clamp(L[i], 0, 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  ag.putImageData(id, 0, 0);
  const s = mkCanvas(sw, sh), sg = s.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(a, 0, 0, sw, sh);
  const b = mkCanvas(w, h), bg = b.getContext('2d', { willReadFrequently: true }); bg.imageSmoothingQuality = 'high'; bg.drawImage(s, 0, 0, w, h);
  const out = new Float32Array(w * h), bd = bg.getImageData(0, 0, w, h).data;
  for (let i = 0; i < out.length; i++) out[i] = bd[i * 4] + 0.5;
  return out;
}
function toneMap(st, kind) {
  const { acc, cnt, w, h } = st; const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), L = new Float32Array(n);
  for (let p = 0; p < n; p++) { const c = cnt[p] || 1; R[p] = acc[p * 3] / c; G[p] = acc[p * 3 + 1] / c; B[p] = acc[p * 3 + 2] / c; L[p] = 0.299 * R[p] + 0.587 * G[p] + 0.114 * B[p]; }
  // percentyle
  const hist = new Uint32Array(256); for (let p = 0; p < n; p++) hist[clamp(L[p] | 0, 0, 255)]++;
  const pct = q => { let s = 0; for (let i = 0; i < 256; i++) { s += hist[i]; if (s >= q * n) return i; } return 255; };
  const lo = pct(0.002), hi = Math.max(lo + 10, pct(kind === 'night' ? 0.995 : 0.999));
  const base = boxBlurLum(L, w, h, Math.max(8, Math.round(Math.min(w, h) / 40)));
  const out = mkCanvas(w, h), g = out.getContext('2d'); const id = g.createImageData(w, h), d = id.data;
  for (let p = 0; p < n; p++) {
    const l = Math.max(0.5, L[p]);
    let ln = clamp((l - lo) / (hi - lo), 0, 1.2);
    let bn = clamp((base[p] - lo) / (hi - lo), 0.001, 1.2);
    let k;
    if (kind === 'night') {
      const bt = Math.pow(bn, 0.55); const det = ln / bn; k = (bt * Math.pow(det, 1.05)) * 235 / l;
    } else {
      // HDR: kompresja warstwy bazowej + wzmocnienie detalu
      const bt = Math.pow(bn, 0.62) * 0.9 + 0.05; const det = Math.pow(ln / bn, 1.25); k = clamp(bt * det, 0, 1.05) * 245 / l;
    }
    k = clamp(k, 0, kind === 'night' ? 12 : 6);
    const sat = kind === 'hdr' ? 1.12 : 1.0;
    const r = R[p] * k, gg = G[p] * k, b = B[p] * k, y = l * k;
    d[p * 4] = y + (r - y) * sat; d[p * 4 + 1] = y + (gg - y) * sat; d[p * 4 + 2] = y + (b - y) * sat; d[p * 4 + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return out;
}
function upscaleToZoom(c) {
  if (S.digital <= 1) return c;
  const k = Math.min(S.digital, 4096 / c.width, 4096 / c.height); if (k <= 1) return c;
  const o = mkCanvas(c.width * k, c.height * k), g = o.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, o.width, o.height);
  return finishZoom(o);
}

/* ================= WYZWALANIE ================= */
function flashFx() { const f = $('#flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
async function countdown() {
  if (!S.timer) return;
  const el = $('#countdown');
  for (let i = S.timer; i > 0; i--) { el.textContent = i; if (navigator.vibrate) navigator.vibrate(20); await sleep(1000); }
  el.textContent = '';
}
async function shutter() {
  if (S.mode === 'video') return toggleRecording();
  if (S.mode === 'timelapse') return toggleTimelapse();
  if (S.mode === 'qr') return toast('Skieruj aparat na kod – skanowanie jest automatyczne.');
  if (S.busy || !S.stream) return;
  S.busy = true; $('#shutter').classList.add('busy');
  try {
    await countdown();
    switch (S.mode) {
      case 'photo': { flashFx(); const c = finishZoom(grabFrame()); await saveCanvas(c, 'foto'); break; }
      case 'max': await captureMax(); break;
      case 'burst': {
        for (let i = 0; i < 10; i++) { flashFx(); const c = finishZoom(grabFrame()); saveCanvas(c, 'seria', i < 9); await sleep(110); }
        toast('Zapisano serię 10 zdjęć'); break;
      }
      case 'night': {
        toast('Tryb nocny: trzymaj nieruchomo…', 3000); busy(true, 'Tryb nocny – zbieranie klatek', 0);
        const st = await stackFrames(12, p => busy(true, 'Tryb nocny – zbieranie klatek', p * 0.8));
        busy(true, 'Odszumianie i rozjaśnianie…', 0.9); await sleep(20);
        await saveCanvas(upscaleToZoom(toneMap(st, 'night')), 'noc'); break;
      }
      case 'hdr': {
        busy(true, 'HDR – łączenie klatek', 0);
        const st = await stackFrames(5, p => busy(true, 'HDR – łączenie klatek', p * 0.8));
        busy(true, 'Mapowanie tonów HDR…', 0.9); await sleep(20);
        await saveCanvas(upscaleToZoom(toneMap(st, 'hdr')), 'hdr'); break;
      }
      case 'portrait': {
        if (!S.segmenter) { await loadSegmenter(); if (!S.segmenter) break; }
        flashFx(); const c = grabFrame(); const g = c.getContext('2d');
        const m = segment(c, c.width, c.height);
        if (m) compositePortrait(g, c.width, c.height, m);
        await saveCanvas(c, 'portret'); break;
      }
      case 'doc': { flashFx(); const c = grabFrame(); openDocEditor(c); break; }
    }
  } catch (e) { console.error(e); toast('Błąd: ' + e.message); }
  busy(false); S.busy = false; $('#shutter').classList.remove('busy');
}
async function captureMax() {
  if (!S.imageCapture || !S.imageCapture.takePhoto) {
    // brak ImageCapture (np. iPhone): na chwilę przełączamy aparat na najwyższą rozdzielczość, robimy klatkę i wracamy do 1080p
    busy(true, 'Zdjęcie w pełnej rozdzielczości…');
    const w0 = video.videoWidth;
    try {
      await S.track.applyConstraints({ width: { ideal: 4096 }, height: { ideal: 3072 }, frameRate: { ideal: 30 } });
      for (let i = 0; i < 30 && video.videoWidth === w0; i++) await sleep(50);
      await nextFrame(); await nextFrame();
      S.vw = video.videoWidth; S.vh = video.videoHeight; flashFx();
      const c = finishZoom(grabFrame()); await saveCanvas(c, 'max'); toast(`Zapisano ${c.width}×${c.height} px`);
    } catch (e) { await saveCanvas(finishZoom(grabFrame()), 'foto'); }
    S.track.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }).catch(() => {});
    busy(false); return;
  }
  busy(true, 'Zdjęcie w pełnej rozdzielczości…');
  try {
    let opts = {};
    try { const pc = await S.imageCapture.getPhotoCapabilities(); if (pc.imageWidth) opts = { imageWidth: pc.imageWidth.max, imageHeight: pc.imageHeight.max }; if (S.torch && pc.fillLightMode && pc.fillLightMode.includes('flash')) opts.fillLightMode = 'flash'; } catch (e) {}
    flashFx();
    let blob; try { blob = await S.imageCapture.takePhoto(opts); } catch (e) { blob = await S.imageCapture.takePhoto(); }
    const bmp = await createImageBitmap(blob);
    // zastosuj ten sam kadr (zoom cyfrowy) proporcjonalnie
    if (S.digital > 1.01 || S.stab || S.hstab) {
      const c = finishZoom(grabFrame(bmp, bmp.width, bmp.height, false)); await saveCanvas(c, 'max');
    } else await saveBlob(blob, 'image', 'max');
    toast(`Zapisano ${bmp.width}×${bmp.height} px`);
  } catch (e) { toast('takePhoto nie zadziałało: ' + e.message); await saveCanvas(finishZoom(grabFrame()), 'foto'); }
  busy(false);
}

/* ---- wideo ---- */
function pickMime() {
  const c = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return c.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
}
async function toggleRecording() {
  if (S.recorder) { S.recorder.stop(); return; }
  if (!window.MediaRecorder) return toast('Nagrywanie wideo nie jest obsługiwane w tej przeglądarce.');
  // bez efektów: nagrywamy prosto z aparatu (natywne kl./s); z efektami/zoomem: z kanwasu max 1080p, 30 kl./s
  let tracks;
  if (!S.stab && !S.hstab && S.mode !== 'portrait' && S.digital <= 1.01) tracks = [S.track.clone()];
  else {
    if (!view.captureStream) return toast('Nagrywanie z efektami nie jest obsługiwane w tej przeglądarce.');
    S.recCanvas = true; sizeCanvases();
    tracks = [...view.captureStream(30).getVideoTracks()];
  }
  S.recVideoTracks = tracks.slice();
  try { const a = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } }); S.audio = a; tracks.push(...a.getAudioTracks()); }
  catch (e) { toast('Bez mikrofonu – nagrywam obraz bez dźwięku.'); }
  const mime = pickMime(); const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : { videoBitsPerSecond: 8e6 });
  S.recChunks = []; rec.ondataavailable = e => e.data.size && S.recChunks.push(e.data);
  rec.onstop = async () => {
    clearInterval(S.recTimer); $('#recInfo').classList.add('hidden'); $('#shutter').classList.remove('rec');
    if (S.audio) S.audio.getTracks().forEach(t => t.stop()); S.audio = null;
    (S.recVideoTracks || []).forEach(t => t.stop()); S.recVideoTracks = null; S.recCanvas = false;
    const blob = new Blob(S.recChunks, { type: rec.mimeType || mime || 'video/webm' }); S.recorder = null;
    await saveBlob(blob, 'video', 'wideo'); toast('Wideo zapisane w galerii');
  };
  rec.start(1000); S.recorder = rec; S.recStart = Date.now();
  $('#shutter').classList.add('rec'); $('#recInfo').classList.remove('hidden');
  S.recTimer = setInterval(() => { const s = Math.floor((Date.now() - S.recStart) / 1000); $('#recTime').textContent = String(s / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 250);
}
/* ---- timelapse ---- */
async function toggleTimelapse() {
  if (S.tl) {
    clearInterval(S.tl.iv); const frames = S.tl.frames; S.tl = null;
    $('#shutter').classList.remove('rec'); $('#recInfo').classList.add('hidden');
    if (frames.length < 2) return toast('Za mało klatek do timelapse.');
    return encodeTimelapse(frames);
  }
  if (!window.MediaRecorder) return toast('Timelapse wymaga MediaRecorder – nieobsługiwane w tej przeglądarce.');
  const iv = S.tlInterval || 1;
  S.tl = { frames: [], iv: null, t0: Date.now() };
  const grab = async () => { if (!S.tl) return; if (S.tl.frames.length >= 1800) return toggleTimelapse(); const b = await canvasBlob(needCanvas() ? view : grabFrame(video, S.vw, S.vh, false, 1920), 'image/jpeg', 0.9); if (S.tl) { S.tl.frames.push(b); $('#recTime').textContent = `${S.tl.frames.length} kl. (co ${iv}s)`; } };
  grab(); S.tl.iv = setInterval(grab, iv * 1000);
  $('#shutter').classList.add('rec'); $('#recInfo').classList.remove('hidden');
  toast(`Timelapse: klatka co ${iv} s. Naciśnij ponownie, aby zakończyć.`);
}
async function encodeTimelapse(frames) {
  const b0 = await createImageBitmap(frames[0]); const c = mkCanvas(b0.width, b0.height), g = c.getContext('2d');
  g.drawImage(b0, 0, 0);
  const st = c.captureStream(30), mime = pickMime(); const rec = new MediaRecorder(st, mime ? { mimeType: mime, videoBitsPerSecond: 10e6 } : {});
  const ch = []; rec.ondataavailable = e => e.data.size && ch.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start();
  for (let i = 0; i < frames.length; i++) {
    const b = await createImageBitmap(frames[i]); g.drawImage(b, 0, 0, c.width, c.height); b.close && b.close();
    busy(true, `Kodowanie timelapse ${i + 1}/${frames.length}`, (i + 1) / frames.length);
    await sleep(1000 / 30);
  }
  await sleep(200); rec.stop(); await done; busy(false);
  await saveBlob(new Blob(ch, { type: rec.mimeType || mime || 'video/webm' }), 'video', 'timelapse'); toast('Timelapse zapisany w galerii');
}

/* ================= SKANER DOKUMENTÓW ================= */
function detectDoc(src, size = 320) {
  const W = src.width, H = src.height, k = size / Math.max(W, H);
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const c = mkCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, n = w * h, L = new Uint8Array(n);
  for (let i = 0; i < n; i++) L[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
  // Otsu
  const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[L[i]]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; th = t; } }
  // największa jasna spójna plama
  const lab = new Int32Array(n).fill(-1); let bestId = -1, bestA = 0, bestPts = null;
  const stack = new Int32Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (lab[s0] !== -1 || L[s0] <= th) continue;
    let sp = 0, area = 0; stack[sp++] = s0; lab[s0] = s0;
    let tl = s0, tr = s0, bl = s0, br = s0, vTL = 1e9, vTR = -1e9, vBL = 1e9, vBR = -1e9;
    while (sp) {
      const p = stack[--sp]; area++;
      const x = p % w, y = (p / w) | 0;
      if (x + y < vTL) { vTL = x + y; tl = p; } if (x + y > vBR) { vBR = x + y; br = p; }
      if (x - y > vTR) { vTR = x - y; tr = p; } if (x - y < vBL) { vBL = x - y; bl = p; }
      if (x > 0 && lab[p - 1] === -1 && L[p - 1] > th) { lab[p - 1] = s0; stack[sp++] = p - 1; }
      if (x < w - 1 && lab[p + 1] === -1 && L[p + 1] > th) { lab[p + 1] = s0; stack[sp++] = p + 1; }
      if (y > 0 && lab[p - w] === -1 && L[p - w] > th) { lab[p - w] = s0; stack[sp++] = p - w; }
      if (y < h - 1 && lab[p + w] === -1 && L[p + w] > th) { lab[p + w] = s0; stack[sp++] = p + w; }
    }
    if (area > bestA) { bestA = area; bestId = s0; bestPts = [tl, tr, br, bl]; }
  }
  const inv = 1 / k;
  if (bestPts && bestA > n * 0.12 && bestA < n * 0.97) {
    return { found: true, pts: bestPts.map(p => ({ x: (p % w) * inv, y: ((p / w) | 0) * inv })) };
  }
  const m = 0.08; return { found: false, pts: [{ x: W * m, y: H * m }, { x: W * (1 - m), y: H * m }, { x: W * (1 - m), y: H * (1 - m) }, { x: W * m, y: H * (1 - m) }] };
}
function solveH(src, dst) {
  // homografia: dst -> src (8 niewiadomych)
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i], { x: u, y: v } = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  return b.map((v, i) => v / A[i][i]);
}
function warpDoc(srcC, q, bw) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2]))), H = Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2])));
  const lim = 3200 / Math.max(W, H); if (lim < 1) { W = Math.round(W * lim); H = Math.round(H * lim); }
  const h = solveH(q, [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]);
  const sw = srcC.width, sh = srcC.height, sd = srcC.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  const out = mkCanvas(W, H), og = out.getContext('2d'), id = og.createImageData(W, H), o = id.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = h[6] * x + h[7] * y + 1, u = (h[0] * x + h[1] * y + h[2]) / z, v = (h[3] * x + h[4] * y + h[5]) / z;
    const x0 = clamp(Math.floor(u), 0, sw - 2), y0 = clamp(Math.floor(v), 0, sh - 2), fx_ = clamp(u - x0, 0, 1), fy = clamp(v - y0, 0, 1);
    const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4, k = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) o[k + c] = (sd[i00 + c] * (1 - fx_) + sd[i10 + c] * fx_) * (1 - fy) + (sd[i01 + c] * (1 - fx_) + sd[i11 + c] * fx_) * fy;
    o[k + 3] = 255;
  }
  og.putImageData(id, 0, 0);
  // wyrównanie oświetlenia (biała kartka)
  const n = W * H, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = o[i * 4] * 0.299 + o[i * 4 + 1] * 0.587 + o[i * 4 + 2] * 0.114;
  const bg = boxBlurLum(L, W, H, Math.max(6, Math.round(Math.min(W, H) / 25)));
  for (let i = 0; i < n; i++) {
    const g = 245 / Math.max(40, bg[i] * 1.02);
    if (bw) { let v = L[i] * g; v = v > 200 ? 255 : clamp((v - 60) * 1.6, 0, 255); o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v; }
    else for (let c = 0; c < 3; c++) o[i * 4 + c] = clamp((o[i * 4 + c] * g - 15) * 1.08, 0, 255);
  }
  og.putImageData(id, 0, 0);
  return out;
}
let DOC = null;
function openDocEditor(c) {
  const det = detectDoc(c);
  DOC = { src: c, pts: det.pts, drag: -1 };
  $('#docEditor').classList.remove('hidden');
  if (!det.found) toast('Nie wykryto krawędzi – przeciągnij rogi ręcznie.');
  requestAnimationFrame(drawDoc);
}
function docGeom() {
  const cv = $('#docCanvas'), r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const s = Math.min(cv.width / DOC.src.width, cv.height / DOC.src.height);
  return { cv, s, ox: (cv.width - DOC.src.width * s) / 2, oy: (cv.height - DOC.src.height * s) / 2, dpr };
}
function drawDoc() {
  if (!DOC) return;
  const { cv, s, ox, oy, dpr } = docGeom(), g = cv.getContext('2d');
  g.drawImage(DOC.src, ox, oy, DOC.src.width * s, DOC.src.height * s);
  g.fillStyle = 'rgba(255,176,32,.15)'; g.strokeStyle = '#ffb020'; g.lineWidth = 2 * dpr; g.beginPath();
  DOC.pts.forEach((p, i) => { const X = ox + p.x * s, Y = oy + p.y * s; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath(); g.fill(); g.stroke();
  DOC.pts.forEach(p => { g.beginPath(); g.arc(ox + p.x * s, oy + p.y * s, 14 * dpr, 0, 7); g.fillStyle = 'rgba(0,0,0,.4)'; g.fill(); g.lineWidth = 3 * dpr; g.stroke(); });
}
(() => {
  const cv = $('#docCanvas');
  const pos = e => { const { s, ox, oy, dpr } = docGeom(); const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) * dpr - ox) / s, y: ((e.clientY - r.top) * dpr - oy) / s, s: s / dpr }; };
  cv.addEventListener('pointerdown', e => { if (!DOC) return; const p = pos(e); let bi = -1, bd = 40 / p.s; DOC.pts.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; bi = i; } }); DOC.drag = bi; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (!DOC || DOC.drag < 0) return; const p = pos(e); DOC.pts[DOC.drag] = { x: clamp(p.x, 0, DOC.src.width), y: clamp(p.y, 0, DOC.src.height) }; drawDoc(); });
  cv.addEventListener('pointerup', () => { if (DOC) DOC.drag = -1; });
  $('#docCancel').onclick = () => { DOC = null; $('#docEditor').classList.add('hidden'); };
  $('#docAuto').onclick = () => { const d = detectDoc(DOC.src); DOC.pts = d.pts; drawDoc(); if (!d.found) toast('Nie wykryto krawędzi'); };
  const save = async bw => { busy(true, 'Prostowanie perspektywy…'); await sleep(30); const o = warpDoc(DOC.src, DOC.pts, bw); await saveCanvas(o, 'dokument'); busy(false); DOC = null; $('#docEditor').classList.add('hidden'); toast('Dokument zapisany'); };
  $('#docColor').onclick = () => save(false); $('#docBW').onclick = () => save(true);
  window.addEventListener('resize', () => DOC && drawDoc());
})();

/* ================= GALERIA (IndexedDB) ================= */
let dbP = null;
function db() {
  if (dbP) return dbP;
  dbP = new Promise((res, rej) => { const r = indexedDB.open('aparat-pro', 1); r.onupgradeneeded = () => r.result.createObjectStore('media', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbP;
}
async function dbOp(mode, fn) { try { const d = await db(); return await new Promise((res, rej) => { const tx = d.transaction('media', mode); const r = fn(tx.objectStore('media')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); } catch (e) { console.warn(e); return null; } }
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
async function saveCanvas(c, tag, quiet) { const b = await canvasBlob(c, 'image/jpeg', 0.94); return saveBlob(b, 'image', tag, quiet, c.width + '×' + c.height); }
async function saveBlob(blob, type, tag, quiet, dims = '') {
  const ext = type === 'video' ? (blob.type.includes('mp4') ? 'mp4' : 'webm') : 'jpg';
  const item = { id: Date.now() + '_' + Math.random().toString(36).slice(2, 6), type, blob, name: `${tag}_${stamp()}.${ext}`, dims, created: Date.now() };
  S.gallery.unshift(item); setThumb();
  dbOp('readwrite', s => s.put(item));
  return item;
}
function urlOf(it) { if (!it.url) it.url = URL.createObjectURL(it.blob); return it.url; }
function setThumb() {
  const t = $('#btnGallery'), it = S.gallery.find(i => i.type === 'image');
  t.style.backgroundImage = it ? `url(${urlOf(it)})` : '';
}
async function loadGallery() {
  const all = await dbOp('readonly', s => s.getAll());
  if (all) S.gallery = all.sort((a, b) => b.created - a.created);
  setThumb();
}
function openGallery() {
  if (!S.gallery.length) return toast('Galeria jest pusta – zrób pierwsze zdjęcie.');
  openSheet(`Galeria (${S.gallery.length})`, '<div class="grid" id="gGrid"></div><p class="note">Zdjęcia są przechowywane lokalnie w tej przeglądarce. Pobierz je, aby zachować na stałe.</p>');
  const g = $('#gGrid');
  S.gallery.forEach(it => {
    const b = document.createElement('button');
    if (it.type === 'image') b.style.backgroundImage = `url(${urlOf(it)})`; else b.innerHTML = '<i>▶ wideo</i>';
    b.onclick = () => openViewer(it); g.appendChild(b);
  });
}
let CUR = null;
function openViewer(it) {
  CUR = it; closeSheet();
  const m = $('#vMedia'); m.innerHTML = '';
  const el = document.createElement(it.type === 'video' ? 'video' : 'img'); el.src = urlOf(it);
  if (it.type === 'video') { el.controls = true; el.playsInline = true; }
  else el.onload = () => { $('#vInfo').textContent = `${it.name} · ${el.naturalWidth}×${el.naturalHeight} · ${(it.blob.size / 1e6).toFixed(1)} MB`; };
  m.appendChild(el);
  $('#vInfo').textContent = it.name;
  ['#vAi2', '#vAi4', '#vDoc'].forEach(s => $(s).classList.toggle('hidden', it.type !== 'image'));
  $('#viewer').classList.remove('hidden');
}
$('#vClose').onclick = () => { $('#viewer').classList.add('hidden'); $('#vMedia').innerHTML = ''; CUR = null; };
$('#vDown').onclick = () => { const a = document.createElement('a'); a.href = urlOf(CUR); a.download = CUR.name; document.body.appendChild(a); a.click(); a.remove(); };
$('#vShare').onclick = async () => {
  const f = new File([CUR.blob], CUR.name, { type: CUR.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: CUR.name }); } catch (e) {} }
  else toast('Udostępnianie plików nie jest obsługiwane – użyj „Pobierz”.');
};
$('#vDel').onclick = async () => {
  if (!confirm('Usunąć ten plik z galerii?')) return;
  const id = CUR.id; S.gallery = S.gallery.filter(i => i.id !== id); dbOp('readwrite', s => s.delete(id));
  $('#vClose').onclick(); setThumb(); toast('Usunięto');
};
$('#vDoc').onclick = async () => { const b = await createImageBitmap(CUR.blob); const c = mkCanvas(b.width, b.height); c.getContext('2d').drawImage(b, 0, 0); $('#vClose').onclick(); openDocEditor(c); };
$('#vAi2').onclick = () => aiUpscale(CUR, 2);
$('#vAi4').onclick = () => aiUpscale(CUR, 4);

/* ================= AI UPSCALE (ESRGAN / RDN, TensorFlow.js) ================= */
const models = {};
async function getModel(scale) {
  if (models[scale]) return models[scale];
  await loadScript(CDN.tf);
  try { await tf.setBackend('webgl'); } catch (e) {}
  await tf.ready();
  models[scale] = await tf.loadLayersModel(CDN.esr(scale));
  return models[scale];
}
async function aiUpscale(it, scale) {
  const bmp = await createImageBitmap(it.blob);
  // limit wejścia, by wynik zmieścił się w pamięci przeglądarki (max ~16 MP)
  const maxIn = scale === 2 ? 2.0e6 : 0.9e6; let w = bmp.width, h = bmp.height;
  if (w * h > maxIn) { const k = Math.sqrt(maxIn / (w * h)); w = Math.round(w * k); h = Math.round(h * k); toast(`Duże zdjęcie – wejście zmniejszone do ${w}×${h}, wynik ${w * scale}×${h * scale}.`, 4000); }
  const src = mkCanvas(w, h), sg = src.getContext('2d', { willReadFrequently: true }); sg.imageSmoothingQuality = 'high'; sg.drawImage(bmp, 0, 0, w, h);
  let out = null;
  try {
    busy(true, 'Pobieranie modelu AI (ESRGAN)…', 0);
    const model = await getModel(scale);
    out = mkCanvas(w * scale, h * scale); const og = out.getContext('2d');
    const T = 96, P = 8; const tilesX = Math.ceil(w / T), tilesY = Math.ceil(h / T); let done = 0;
    for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * T, y0 = ty * T, x1 = Math.min(w, x0 + T), y1 = Math.min(h, y0 + T);
      const px0 = Math.max(0, x0 - P), py0 = Math.max(0, y0 - P), px1 = Math.min(w, x1 + P), py1 = Math.min(h, y1 + P);
      const id = sg.getImageData(px0, py0, px1 - px0, py1 - py0);
      const res = tf.tidy(() => {
        const t = tf.browser.fromPixels(id).toFloat().expandDims(0);
        return model.predict(t).squeeze().clipByValue(0, 255).toInt();
      });
      const arr = await tf.browser.toPixels(res); res.dispose();
      const tw = (px1 - px0) * scale, th = (py1 - py0) * scale;
      const tileImg = new ImageData(arr, tw, th);
      const tc = mkCanvas(tw, th); tc.getContext('2d').putImageData(tileImg, 0, 0);
      og.drawImage(tc, (x0 - px0) * scale, (y0 - py0) * scale, (x1 - x0) * scale, (y1 - y0) * scale, x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
      done++; busy(true, `AI upscale ×${scale}: ${done}/${tilesX * tilesY}`, done / (tilesX * tilesY));
      await tf.nextFrame();
    }
  } catch (e) {
    console.warn('AI upscale fallback', e); out = null;
    toast('Model AI niedostępny (' + e.message + ') – używam wysokiej jakości skalowania Lanczos.', 4500);
  }
  if (!out) { busy(true, 'Skalowanie Lanczos + wyostrzanie…', 0.5); await sleep(30); out = sharpen(lanczos(src, w * scale, h * scale), 0.5); }
  const item = await saveCanvas(out, 'ai_x' + scale); busy(false);
  toast(`Zapisano ${out.width}×${out.height} px`); openViewer(item);
}
function lanczos(src, W, H) {
  const a = 3, sw = src.width, sh = src.height;
  const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  const L = x => { if (x === 0) return 1; if (x <= -a || x >= a) return 0; const p = Math.PI * x; return a * Math.sin(p) * Math.sin(p / a) / (p * p); };
  const weights = (dst, srcN) => {
    const sc = srcN / dst, res = [];
    for (let i = 0; i < dst; i++) {
      const c = (i + 0.5) * sc - 0.5, s0 = Math.floor(c) - a + 1, ws = []; let sum = 0;
      for (let j = 0; j < 2 * a; j++) { const w = L(c - (s0 + j)); ws.push(w); sum += w; }
      res.push({ s0, ws: ws.map(w => w / sum) });
    }
    return res;
  };
  const wx = weights(W, sw), wy = weights(H, sh);
  const tmp = new Float32Array(W * sh * 3);
  for (let y = 0; y < sh; y++) for (let x = 0; x < W; x++) {
    const { s0, ws } = wx[x]; let r = 0, g = 0, b = 0;
    for (let j = 0; j < ws.length; j++) { const sx = clamp(s0 + j, 0, sw - 1), i = (y * sw + sx) * 4; r += sd[i] * ws[j]; g += sd[i + 1] * ws[j]; b += sd[i + 2] * ws[j]; }
    const k = (y * W + x) * 3; tmp[k] = r; tmp[k + 1] = g; tmp[k + 2] = b;
  }
  const out = mkCanvas(W, H), og = out.getContext('2d'), id = og.createImageData(W, H), o = id.data;
  for (let y = 0; y < H; y++) { const { s0, ws } = wy[y]; for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < ws.length; j++) { const sy = clamp(s0 + j, 0, sh - 1), k = (sy * W + x) * 3; r += tmp[k] * ws[j]; g += tmp[k + 1] * ws[j]; b += tmp[k + 2] * ws[j]; }
    const i = (y * W + x) * 4; o[i] = r; o[i + 1] = g; o[i + 2] = b; o[i + 3] = 255;
  } }
  og.putImageData(id, 0, 0); return out;
}

/* ================= UI: TRYBY, PRZEŁĄCZNIKI, PRO ================= */
const MODES = [
  ['photo', 'ZDJĘCIE'], ['night', 'NOC'], ['hdr', 'HDR'], ['portrait', 'PORTRET'], ['burst', 'SERIA'], ['max', 'MAX RES'],
  ['video', 'WIDEO'], ['timelapse', 'TIMELAPSE'], ['doc', 'DOKUMENT'], ['qr', 'SKANER QR']
];
function setMode(m) {
  if (S.recorder || S.tl) return toast('Najpierw zakończ nagrywanie.');
  S.mode = m; S.segMask = null; S.docLive = null;
  document.querySelectorAll('#modes button').forEach(b => { const on = b.dataset.m === m; b.classList.toggle('on', on); if (on) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); });
  $('#shutter').classList.toggle('video', m === 'video' || m === 'timelapse');
  if (m === 'portrait') loadSegmenter();
  if (m === 'max' && !S.imageCapture) toast('MAX RES: ta przeglądarka nie obsługuje ImageCapture – zostanie zrobione zwykłe zdjęcie.', 3500);
  if (m === 'qr' && !('BarcodeDetector' in window)) loadScript(CDN.jsqr).catch(() => toast('Nie udało się załadować skanera QR.'));
  if (m === 'timelapse') {
    openSheet('Timelapse – interwał', '<div class="row">' + [1, 2, 5, 10].map(s => `<button class="chip${(S.tlInterval || 1) === s ? ' on' : ''}" data-s="${s}">co ${s} s</button>`).join('') + '</div><p class="note">Wynik: film 30 kl./s. Np. 10 min co 2 s = 10 s filmu.</p>');
    document.querySelectorAll('#sheetBody .chip').forEach(b => b.onclick = () => { S.tlInterval = +b.dataset.s; closeSheet(); toast(`Interwał: ${b.dataset.s} s`); });
  }
  updateBadges();
}
function buildModes() {
  const box = $('#modes'); box.innerHTML = '';
  MODES.forEach(([id, label]) => { const b = document.createElement('button'); b.dataset.m = id; b.textContent = label; b.onclick = () => setMode(id); box.appendChild(b); });
}
function updateBadges() {
  const b = [];
  if (S.stab) b.push('STABILIZACJA');
  if (S.hstab) b.push('HORYZONT + SUPER STAB');
  if (S.digital > 1.01) b.push('ZOOM CYFROWY ' + S.digital.toFixed(1) + '×');
  if (S.timer) b.push('TIMER ' + S.timer + 's');
  if (S.peaking) b.push('PEAKING'); if (S.zebra) b.push('ZEBRA');
  $('#badges').innerHTML = b.map(x => `<span>${x}</span>`).join('');
}
setInterval(updateBadges, 500);
function updateButtons() {
  $('#btnStab').classList.toggle('on', S.stab);
  $('#btnHor').classList.toggle('on', S.hstab);
  $('#btnGrid').classList.toggle('on', S.grid);
  $('#btnLevel').classList.toggle('on', S.level);
  $('#btnTorch').classList.toggle('on', S.torch);
  $('#btnTorch').classList.toggle('warn', !S.caps.torch);
  $('#btnTimer').classList.toggle('on', !!S.timer); $('#btnTimer').textContent = S.timer ? '⏱' + S.timer : '⏱';
  $('#btnPro').classList.toggle('on', !$('#proPanel').classList.contains('hidden'));
  $('#histo').classList.toggle('hidden', !S.histo);
}
const TOGGLES = {
  stab() { S.stab = !S.stab; resetStab(); if (S.stab && S.hstab) { S.hstab = false; HZ.cw = 0; } toast(S.stab ? 'Stabilizacja włączona (kadr przycięty o 15%)' : 'Stabilizacja wyłączona'); },
  async hstab() {
    if (S.hstab) { S.hstab = false; HZ.cw = 0; resetStab(); toast('Horyzont + Super stabilizacja wyłączone'); return; }
    const p = enableHorizon(); // wywołane w kliknięciu (iOS)
    S.stab = false; resetStab(); resetHStab(); S.hstab = true;
    toast('Horyzont zablokowany + Super stabilizacja (kadr przycięty ~28%)', 3000);
    await p;
  },
  grid() { S.grid = !S.grid; },
  async level() { if (!S.level) { if (await enableLevel()) S.level = true; } else S.level = false; },
  histo() { S.histo = !S.histo; },
  peaking() { S.peaking = !S.peaking; toast(S.peaking ? 'Focus peaking: ostre krawędzie na czerwono' : 'Focus peaking wyłączony'); },
  zebra() { S.zebra = !S.zebra; toast(S.zebra ? 'Zebra: prześwietlone obszary w paski' : 'Zebra wyłączona'); },
  async torch() {
    if (!S.caps.torch) return toast('Latarka nie jest obsługiwana przez ten aparat/przeglądarkę.');
    const v = !S.torch; if (await applyAdv({ torch: v })) S.torch = v; else toast('Nie udało się przełączyć latarki.');
  },
  timer() { S.timer = S.timer === 0 ? 3 : S.timer === 3 ? 10 : 0; toast(S.timer ? `Samowyzwalacz: ${S.timer} s` : 'Samowyzwalacz wyłączony'); },
  pro() { $('#proPanel').classList.toggle('hidden'); }
};
async function toggle(k) { await TOGGLES[k](); updateButtons(); updateBadges(); }
$('#btnStab').onclick = () => toggle('stab'); $('#btnHor').onclick = () => toggle('hstab'); $('#btnGrid').onclick = () => toggle('grid'); $('#btnLevel').onclick = () => toggle('level');
$('#btnTorch').onclick = () => toggle('torch'); $('#btnTimer').onclick = () => toggle('timer'); $('#btnPro').onclick = () => toggle('pro');
$('#shutter').onclick = shutter; $('#btnGallery').onclick = openGallery; $('#btnMenu').onclick = openFeatures;
$('#btnSwitch').onclick = async () => {
  if (S.recorder || S.tl) return toast('Najpierw zakończ nagrywanie.');
  S.facing = S.facing === 'environment' ? 'user' : 'environment';
  try { await startCamera(); } catch (e) { S.facing = S.facing === 'environment' ? 'user' : 'environment'; toast('Brak drugiej kamery.'); await startCamera().catch(() => {}); }
};
document.addEventListener('keydown', e => { if (e.code === 'Space' && !e.target.closest('input')) { e.preventDefault(); shutter(); } });

/* ---- sterowanie ręczne ---- */
function buildPro() {
  const p = $('#proPanel'), c = S.caps; let h = '';
  const sl = (id, label, cap, val, fmt = v => v) => cap && cap.max > cap.min ? `<div class="ctl"><label>${label}<b id="${id}V">${fmt(val)}</b></label><input id="${id}" type="range" min="${cap.min}" max="${cap.max}" step="${cap.step || (cap.max - cap.min) / 100}" value="${val}"></div>` : '';
  const st = (S.track && S.track.getSettings && S.track.getSettings()) || {};
  h += sl('pEc', 'Kompensacja ekspozycji (EV)', c.exposureCompensation, st.exposureCompensation ?? 0, v => (+v).toFixed(1));
  h += sl('pEt', 'Czas naświetlania', c.exposureTime, st.exposureTime ?? c.exposureTime?.min, v => fmtShutter(+v));
  h += sl('pIso', 'ISO', c.iso, st.iso ?? c.iso?.min, v => Math.round(v));
  h += sl('pWb', 'Balans bieli (K)', c.colorTemperature, st.colorTemperature ?? 5000, v => Math.round(v) + ' K');
  h += sl('pFd', 'Ostrość (odległość)', c.focusDistance, st.focusDistance ?? c.focusDistance?.min, v => (+v).toFixed(2));
  h += `<div class="row" style="margin-top:6px"><button id="pAuto">Wszystko AUTO</button><button id="pHisto" class="chip${S.histo ? ' on' : ''}">Histogram</button><button id="pPeak" class="chip${S.peaking ? ' on' : ''}">Peaking</button><button id="pZebra" class="chip${S.zebra ? ' on' : ''}">Zebra</button><button id="pFps" class="chip${FPS.show ? ' on' : ''}">Licznik kl./s</button></div>`;
  if (!/pEc|pEt|pIso|pWb|pFd/.test(h)) h = '<p class="note">⚠ Ta przeglądarka/aparat nie udostępnia ręcznej ekspozycji, ISO, balansu bieli ani ostrości (np. Safari na iPhonie). Dostępne są narzędzia pomiarowe:</p>' + h;
  p.innerHTML = h;
  const on = (id, fn) => { const e = $('#' + id); if (e) e.oninput = () => { $('#' + id + 'V').textContent = fn.fmt(e.value); fn.apply(+e.value); }; };
  on('pEc', { fmt: v => (+v).toFixed(1), apply: v => applyAdv({ exposureMode: 'continuous', exposureCompensation: v }) });
  on('pEt', { fmt: v => fmtShutter(+v), apply: v => applyAdv({ exposureMode: 'manual', exposureTime: v }) });
  on('pIso', { fmt: v => Math.round(v), apply: v => applyAdv({ exposureMode: 'manual', iso: v }) });
  on('pWb', { fmt: v => Math.round(v) + ' K', apply: v => applyAdv({ whiteBalanceMode: 'manual', colorTemperature: v }) });
  on('pFd', { fmt: v => (+v).toFixed(2), apply: v => applyAdv({ focusMode: 'manual', focusDistance: v }) });
  $('#pAuto').onclick = async () => { const m = {}; if (c.exposureMode) m.exposureMode = 'continuous'; if (c.whiteBalanceMode) m.whiteBalanceMode = 'continuous'; if (c.focusMode) m.focusMode = 'continuous'; if (c.exposureCompensation) m.exposureCompensation = 0; await applyAdv(m); buildPro(); toast('Tryb automatyczny'); };
  $('#pHisto').onclick = async () => { await toggle('histo'); buildPro(); };
  $('#pPeak').onclick = async () => { await toggle('peaking'); buildPro(); };
  $('#pZebra').onclick = async () => { await toggle('zebra'); buildPro(); };
  $('#pFps').onclick = () => { FPS.show = !FPS.show; updateFpsLabel(); buildPro(); };
}
function fmtShutter(v) { const s = v / 10000; return s >= 1 ? s.toFixed(1) + ' s' : '1/' + Math.round(1 / s) + ' s'; }

/* ---- arkusze ---- */
function openSheet(title, html) { $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = html; $('#sheet').classList.remove('hidden'); }
function closeSheet() { $('#sheet').classList.add('hidden'); }
document.querySelector('[data-close]').onclick = closeSheet;

/* ---- menu funkcji ---- */
function support() {
  const c = S.caps, hasMR = !!window.MediaRecorder && !!view.captureStream;
  return {
    stab: true, hstab: true, zoom: true, ai: !!window.WebGLRenderingContext, night: true, hdr: true, burst: true, timer: true, grid: true,
    level: typeof DeviceMotionEvent !== 'undefined', manual: !!(c.exposureCompensation || c.exposureTime || c.iso || c.colorTemperature || c.focusDistance),
    torch: !!c.torch, histo: true, peaking: true, zebra: true, qr: true, doc: true, video: hasMR, timelapse: hasMR,
    portrait: typeof WebAssembly !== 'undefined', max: !!(S.imageCapture && S.imageCapture.takePhoto)
  };
}
const FEATURES = [
  ['stab', 'Stabilizacja obrazu', 'Cyfrowa stabilizacja na żywo: analiza ruchu klatek i kompensacja kadrem.', () => toggle('stab')],
  ['hstab', 'Horyzont + Super stabilizacja', 'Blokada horyzontu jak w kamerach sportowych (żyroskop) + bardzo mocna stabilizacja obrazu.', () => { if (!S.hstab) toggle('hstab'); }],
  ['zoom', 'Mega zoom do 50×', 'Zoom optyczny/sprzętowy + cyfrowy z wyostrzaniem, gest szczypania.', () => setZoom(10)],
  ['ai', 'AI upscale ×2 / ×4', 'Sieć neuronowa ESRGAN (TensorFlow.js) w galerii; zapas: Lanczos.', () => openGallery()],
  ['night', 'Tryb nocny', 'Składa 12 klatek z wyrównaniem – mniej szumu, jaśniejszy obraz.', () => setMode('night')],
  ['hdr', 'HDR', 'Łączenie klatek i lokalne mapowanie tonów (cienie + światła).', () => setMode('hdr')],
  ['burst', 'Seria zdjęć', '10 zdjęć jedno po drugim.', () => setMode('burst')],
  ['timer', 'Samowyzwalacz', '3 lub 10 sekund.', () => toggle('timer')],
  ['grid', 'Siatka trójpodziału', 'Pomoc w kompozycji.', () => toggle('grid')],
  ['level', 'Poziomica', 'Pokazuje przechylenie telefonu (żyroskop).', () => toggle('level')],
  ['manual', 'Sterowanie ręczne', 'Ekspozycja, czas, ISO, balans bieli, ostrość.', () => toggle('pro')],
  ['torch', 'Latarka', 'Stałe doświetlenie LED.', () => toggle('torch')],
  ['histo', 'Histogram na żywo', 'RGB + jasność, kontrola ekspozycji.', () => toggle('histo')],
  ['peaking', 'Focus peaking', 'Zaznacza ostre krawędzie na czerwono.', () => toggle('peaking')],
  ['zebra', 'Zebra', 'Paski na prześwietlonych obszarach.', () => toggle('zebra')],
  ['qr', 'Skaner QR i kodów', 'QR, EAN, Code128 i inne – automatycznie.', () => setMode('qr')],
  ['doc', 'Skaner dokumentów', 'Wykrywa kartkę, prostuje perspektywę, wybiela tło.', () => setMode('doc')],
  ['video', 'Nagrywanie wideo', 'Z dźwiękiem, ze stabilizacją i zoomem.', () => setMode('video')],
  ['timelapse', 'Timelapse', 'Klatka co 1–10 s, film 30 kl./s.', () => setMode('timelapse')],
  ['portrait', 'Portret – rozmycie tła', 'Segmentacja osoby AI (MediaPipe).', () => setMode('portrait')],
  ['max', 'Maksymalna rozdzielczość', 'Zdjęcie z pełnej matrycy (ImageCapture).', () => setMode('max')]
];
function openFeatures() {
  const sup = support();
  openSheet(`Funkcje (${FEATURES.length})`, FEATURES.map(([k, t, d], i) => `<button class="feat" data-i="${i}"><span class="n">${i + 1}</span><span><div class="t">${t}</div><div class="d">${d}</div></span><span class="s ${sup[k] ? 'ok' : 'no'}">${sup[k] ? '● dostępne' : '○ brak w tej przeglądarce'}</span></button>`).join(''));
  document.querySelectorAll('.feat').forEach(b => b.onclick = () => {
    const f = FEATURES[+b.dataset.i]; closeSheet();
    if (!sup[f[0]]) toast(`„${f[1]}” nie jest obsługiwane na tym urządzeniu lub w tej przeglądarce.`, 3500);
    f[3]();
  });
}

/* ================= START ================= */
buildModes(); setMode('photo'); loadGallery();
$('#btnStart').onclick = async () => {
  $('#startErr').textContent = '';
  try { await startCamera(); $('#startScreen').classList.add('hidden'); startLoop(); }
  catch (e) {
    const n = e && e.name;
    $('#startErr').textContent = n === 'NotAllowedError' ? 'Brak zgody na aparat. Zezwól na dostęp w ustawieniach przeglądarki i spróbuj ponownie.' :
      n === 'NotFoundError' ? 'Nie znaleziono aparatu w tym urządzeniu.' : (e.message || String(e));
  }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && S.recorder) S.recorder.stop(); });

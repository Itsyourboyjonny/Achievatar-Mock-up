// Photo → body measurements, on-device. MediaPipe Pose gives joint landmarks
// plus a person segmentation mask; we read silhouette widths at anatomical
// heights and normalise them by standing height so distance doesn't matter.
import { DEFAULT_METRICS, METRIC_KEYS } from './model.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
let landmarkerP;

function getLandmarker() {
  landmarkerP ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(`${MP}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    return PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true,
    });
  })().catch((e) => { landmarkerP = null; throw e; });
  return landmarkerP;
}
export const warmUp = () => getLandmarker().catch(() => {});

export function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not read that image'));
    img.src = url;
  });
}

function toCanvas(img, max = 720) {
  const k = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement('canvas');
  c.width = Math.round((img.naturalWidth || img.width) * k);
  c.height = Math.round((img.naturalHeight || img.height) * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Crop around the body so every progress photo is framed identically.
function cropBody(canvas, box, w = 360, h = 540) {
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const x = out.getContext('2d');
  x.fillStyle = '#23262f'; x.fillRect(0, 0, w, h);
  if (box) {
    const scale = (h * 0.9) / box.h;
    const cx = box.cx, cy = box.top + box.h / 2;
    x.drawImage(canvas, w / 2 - cx * scale, h / 2 - cy * scale, canvas.width * scale, canvas.height * scale);
  } else {
    const scale = Math.max(w / canvas.width, h / canvas.height);
    x.drawImage(canvas, (w - canvas.width * scale) / 2, (h - canvas.height * scale) / 2, canvas.width * scale, canvas.height * scale);
  }
  return out.toDataURL('image/jpeg', 0.78);
}

export async function analyzePhoto(img, sex = 'male') {
  const canvas = toCanvas(img);
  let lm;
  try { lm = await getLandmarker(); }
  catch { return { ok: false, reason: 'The on-device body model could not load (are you offline?).', photo: cropBody(canvas) }; }

  const res = lm.detect(canvas);
  const L = res.landmarks?.[0];
  const maskObj = res.segmentationMasks?.[0];
  if (!L || !maskObj) { maskObj?.close(); return { ok: false, reason: 'No person found. Stand back so your whole body is in frame.', photo: cropBody(canvas) }; }
  const mw = maskObj.width, mh = maskObj.height;
  const mask = maskObj.getAsFloat32Array().slice();
  maskObj.close();

  const need = [11, 12, 13, 14, 23, 24, 25, 26, 27, 28];
  const missing = need.filter((i) => (L[i].visibility ?? 1) < 0.4);
  if (missing.length) return { ok: false, reason: 'Head-to-toe needs to be visible, front-facing, arms slightly away from your sides.', photo: cropBody(canvas) };

  const P = (i) => ({ x: L[i].x * mw, y: L[i].y * mh });
  const on = (x, y) => x >= 0 && y >= 0 && x < mw && y < mh && mask[(y | 0) * mw + (x | 0)] > 0.5;
  const run = (y, cx) => {
    y = Math.round(y); cx = Math.round(cx);
    let x0 = cx;
    if (!on(x0, y)) { let d = 1; while (d < 12 && !on(cx + d, y) && !on(cx - d, y)) d++; if (d >= 12) return null; x0 = on(cx + d, y) ? cx + d : cx - d; }
    let l = x0, r = x0;
    while (on(l - 1, y)) l--;
    while (on(r + 1, y)) r++;
    return { y, l, r, w: r - l + 1 };
  };

  // Body bounding box from the mask.
  let top = -1, bottom = -1, minX = mw, maxX = 0;
  for (let y = 0; y < mh; y++) {
    let n = 0;
    for (let x = 0; x < mw; x++) if (mask[y * mw + x] > 0.5) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    if (n > 2) { if (top < 0) top = y; bottom = y; }
  }
  const heightPx = bottom - top;
  if (heightPx < mh * 0.35) return { ok: false, reason: 'You look too small in the photo. Move closer so your body fills most of the frame.', photo: cropBody(canvas) };
  if (top < 2 || bottom > mh - 3) return { ok: false, reason: 'Part of your body is cut off. Keep your head and feet inside the frame.', photo: cropBody(canvas) };

  const sh = { x: (P(11).x + P(12).x) / 2, y: (P(11).y + P(12).y) / 2 };
  const hp = { x: (P(23).x + P(24).x) / 2, y: (P(23).y + P(24).y) / 2 };
  const kneeY = (P(25).y + P(26).y) / 2, ankleY = (P(27).y + P(28).y) / 2;
  const t = hp.y - sh.y;
  const lines = {};

  lines.shoulder = run(sh.y + 0.06 * t, sh.x);
  lines.chest = run(sh.y + 0.32 * t, sh.x);
  let best = null;
  for (let y = sh.y + 0.55 * t; y <= sh.y + 0.88 * t; y += 2) { const r = run(y, hp.x); if (r && (!best || r.w < best.w)) best = r; }
  lines.waist = best; best = null;
  for (let y = hp.y - 0.05 * t; y <= hp.y + 0.2 * t; y += 2) { const r = run(y, hp.x); if (r && (!best || r.w > best.w)) best = r; }
  lines.hip = best;

  const thighs = [23, 24].map((h, i) => {
    const k = [25, 26][i];
    const y = P(h).y + 0.32 * (P(k).y - P(h).y);
    const r = run(y, P(h).x + 0.32 * (P(k).x - P(h).x));
    if (r && lines.hip && r.w > lines.hip.w * 0.75) { const half = r.w / 2; return { ...r, w: half, l: i ? r.l : r.l + half, r: i ? r.l + half : r.r }; }
    return r;
  });
  const arms = [[11, 13], [12, 14]].map(([s, e]) => {
    const a = P(s), b = P(e);
    const r = run((a.y + b.y) / 2, (a.x + b.x) / 2);
    if (!r) return null;
    const cos = Math.abs(b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y);
    return { ...r, w: r.w * cos };
  });
  const calves = [[25, 27], [26, 28]].map(([k, an]) => run(P(k).y + 0.3 * (P(an).y - P(k).y), P(k).x + 0.3 * (P(an).x - P(k).x)));
  const mean = (xs) => { const v = xs.filter(Boolean); return v.length ? { ...v[0], w: v.reduce((s, x) => s + x.w, 0) / v.length } : null; };
  lines.thigh = mean(thighs); lines.arm = mean(arms); lines.calf = mean(calves);

  // Arms touching the torso merge with the chest line; fall back to a ratio.
  const warnings = [];
  if (lines.chest && lines.shoulder && lines.chest.w > lines.shoulder.w * 0.98) { lines.chest = { ...lines.chest, w: lines.shoulder.w * 0.75, est: true }; warnings.push('Arms touched your chest line; chest was estimated.'); }

  const def = DEFAULT_METRICS[sex];
  const metrics = {};
  for (const k of METRIC_KEYS) {
    const v = lines[k] ? lines[k].w / heightPx : null;
    if (v == null || v < def[k] * 0.45 || v > def[k] * 2.2) { metrics[k] = def[k]; warnings.push(`${k} looked off and was estimated.`); }
    else metrics[k] = v;
  }
  if (warnings.length > 3) return { ok: false, reason: 'Could not read your outline clearly. Try a plain background, fitted clothes and arms ~30° out.', photo: cropBody(canvas) };

  const box = { top, h: heightPx, cx: (minX + maxX) / 2 };
  return {
    ok: true, metrics, warnings,
    photo: cropBody(canvas, box),
    overlay: { canvas, mw, mh, lines: allLines(lines, thighs, arms, calves), landmarks: L.map((p) => ({ x: p.x * mw, y: p.y * mh })), top, bottom },
  };
}

function allLines(lines, thighs, arms, calves) {
  const out = [];
  for (const k of ['shoulder', 'chest', 'waist', 'hip']) if (lines[k]) out.push({ ...lines[k], k });
  for (const [k, xs] of [['thigh', thighs], ['arm', arms], ['calf', calves]]) for (const r of xs) if (r) out.push({ ...r, k });
  return out;
}

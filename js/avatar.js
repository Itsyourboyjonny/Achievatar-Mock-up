// Parametric 3D body. Every surface is swept from measured widths (fraction of
// height) plus muscle / fat deltas per region, so the avatar, the targets and
// the photo analysis all share one model.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, lerp, METRIC_KEYS, REGION_IDS } from './model.js';

const H = 1.8;
const V3 = THREE.Vector3;
const g = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));
const spow = (x, p) => Math.sign(x) * Math.abs(x) ** p;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const SKIN = new THREE.Color('#d6a184');
const NEUTRAL = new THREE.Color('#c9c3c0');
const GROW = new THREE.Color('#ff6a1a');
const SHRINK = new THREE.Color('#2f8cff');

export function heatColor(v, cap = 12) {
  const t = clamp(Math.abs(v) / cap, 0, 1) ** 0.8;
  return NEUTRAL.clone().lerp(v >= 0 ? GROW : SHRINK, t);
}

export function lerpSpec(a, b, t) {
  const o = { sex: b.sex, base: b.base, target: {}, mus: {}, fat: {}, bf: lerp(a.bf, b.bf, t) };
  for (const k of METRIC_KEYS) o.target[k] = lerp(a.target[k], b.target[k], t);
  for (const r of REGION_IDS) {
    o.mus[r] = lerp(a.mus[r] || 0, b.mus[r] || 0, t);
    o.fat[r] = lerp(a.fat[r] || 0, b.fat[r] || 0, t);
  }
  return o;
}

// ---------------------------------------------------------------- geometry
function sweep(nu, nv, fn, regionFn) {
  const pos = new Float32Array((nu + 1) * nv * 3);
  const reg = new Array((nu + 1) * nv);
  let k = 0;
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j < nv; j++) {
      const v = (j / nv) * Math.PI * 2;
      const p = fn(i / nu, v);
      pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
      reg[k++] = regionFn ? regionFn(p, i / nu, v) : null;
    }
  const idx = [];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = i * nv + j, b = i * nv + ((j + 1) % nv), c = (i + 1) * nv + j, d = (i + 1) * nv + ((j + 1) % nv);
      idx.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.userData.regions = reg;
  return geo;
}

// A limb from p0 to p1 with hemispherical caps. rfn(t, front, lateral) → radius.
function limb(p0, p1, side, rfn, nu = 44, nv = 30) {
  const dir = p1.clone().sub(p0);
  const L = dir.length();
  dir.normalize();
  const Z = new V3(0, 0, 1).addScaledVector(dir, -dir.z).normalize();
  const X = new V3().crossVectors(dir, Z);
  const c = 0.14;
  return sweep(nu, nv, (u, v) => {
    const t = -c + u * (1 + 2 * c);
    const cv = Math.cos(v), sv = Math.sin(v);
    const front = cv * X.z + sv * Z.z;
    const lateral = (cv * X.x + sv * Z.x) * side;
    let r, y;
    if (t < 0) { const o = -t / c; r = rfn(0, front, lateral); y = -o * r * 0.9; r *= Math.sqrt(1 - o * o); }
    else if (t > 1) { const o = (t - 1) / c; r = rfn(1, front, lateral); y = L + o * r * 0.9; r *= Math.sqrt(Math.max(0, 1 - o * o)); }
    else { r = rfn(t, front, lateral); y = t * L; }
    const lx = r * cv, lz = r * sv;
    return [p0.x + X.x * lx + dir.x * y + Z.x * lz, p0.y + X.y * lx + dir.y * y + Z.y * lz, p0.z + X.z * lx + dir.z * y + Z.z * lz];
  });
}

function ellipsoid(center, sx, sy, sz, nu = 24, nv = 28) {
  return sweep(nu, nv, (u, v) => {
    const phi = -Math.PI / 2 + u * Math.PI;
    return [center.x + sx * Math.cos(phi) * Math.cos(v), center.y + sy * Math.sin(phi), center.z + sz * Math.cos(phi) * Math.sin(v)];
  });
}

function catmull(keys, y, col) {
  let i = 0;
  while (i < keys.length - 2 && y > keys[i + 1][0]) i++;
  const p1 = keys[i], p2 = keys[i + 1];
  const p0 = keys[Math.max(0, i - 1)], p3 = keys[Math.min(keys.length - 1, i + 2)];
  const t = clamp((y - p1[0]) / (p2[0] - p1[0]), 0, 1);
  const a = p0[col], b = p1[col], c = p2[col], d = p3[col];
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}

// ---------------------------------------------------------------- body
export function buildBody(spec) {
  const { sex, base, target: T } = spec;
  const female = sex === 'female';
  const m = (r) => (spec.mus[r] || 0) / 100;
  const f = (r) => (spec.fat[r] || 0) / 100;
  const parts = [];
  const add = (geo, region) => { geo.userData.region = region; parts.push(geo); };

  // ---- torso
  const S = T.shoulder, C = T.chest, W = T.waist, P = T.hip;
  const keys = [
    [0.445, P * 0.3, P * 0.22],
    [0.48, P * 0.44, P * 0.3],
    [0.515, P * 0.5, P * 0.33],
    [0.555, P * 0.47, P * 0.33],
    [0.62, W * 0.5, W * 0.36],
    [0.69, C * 0.5, C * 0.34],
    [0.745, C * 0.53 * (1 + 0.4 * m('back')), C * 0.34],
    [0.785, S * 0.4, C * 0.3],
    [0.812, S * 0.31, C * 0.23],
    [0.835, 0.05, 0.04],
  ];
  const y0 = keys[0][0], y1 = keys[keys.length - 1][0];
  const pec = female ? 0.006 : 0.011 * (1 + 5 * m('chest') + 2 * f('chest'));
  const breast = female ? 0.022 * (1 + 1.5 * f('chest')) : 0;
  const belly = (female ? 0.008 : 0.011) * clamp(1 + 6 * f('core') + (spec.bf - 18) / 12, 0.1, 3);
  const glute = (female ? 0.022 : 0.016) * (1 + 4 * m('glutes') + 3 * f('glutes'));
  const trap = 0.012 * (1 + 4 * m('back'));
  const absDef = clamp(((female ? 24 : 16) - spec.bf) / 9, 0, 1) * 0.004;
  const capB = 0.025, capT = 0.012;

  const torso = sweep(110, 72, (u, v) => {
    const span = y1 - y0 + capB + capT;
    let y = y0 - capB + u * span, shrink = 1;
    if (y < y0) { shrink = Math.sqrt(Math.max(0, 1 - ((y0 - y) / capB) ** 2)); }
    if (y > y1) { shrink = Math.sqrt(Math.max(0, 1 - ((y - y1) / capT) ** 2)); }
    const yc = clamp(y, y0, y1);
    const a = catmull(keys, yc, 1) * shrink, b = catmull(keys, yc, 2) * shrink;
    const cv = Math.cos(v), sv = Math.sin(v);
    let x = a * spow(cv, 0.78), z = b * spow(sv, 0.78);
    const front = Math.max(0, sv), back = Math.max(0, -sv), xn = x / Math.max(a, 1e-4);
    if (shrink > 0.5) {
      const pecY = yc < 0.715 ? g(yc, 0.715, 0.022) : g(yc, 0.715, 0.04);
      z += pec * pecY * front ** 1.5 * (1 - 0.55 * g(xn, 0, 0.18));
      z += breast * g(yc, 0.7, 0.035) * (g(xn, 0.45, 0.3) + g(xn, -0.45, 0.3)) * front;
      z += belly * g(yc, 0.6, 0.055) * front ** 2;
      z -= glute * g(yc, 0.495, 0.04) * back ** 1.4 * (0.55 + 0.45 * (g(xn, 0.42, 0.35) + g(xn, -0.42, 0.35)));
      z -= trap * g(yc, 0.808, 0.018) * back * g(xn, 0, 0.5);
      if (absDef > 0) {
        const fz = front ** 4 * g(yc, 0.615, 0.06);
        let groove = g(xn, 0, 0.06);
        if (Math.abs(xn) < 0.38) groove += 0.7 * (g(yc, 0.592, 0.005) + g(yc, 0.628, 0.005) + g(yc, 0.662, 0.005));
        z -= absDef * fz * groove;
        z += absDef * 0.6 * fz * (g(xn, 0.2, 0.1) + g(xn, -0.2, 0.1));
      }
    }
    return [x * H, y * H, z * H];
  }, (p, u, v) => {
    const y = p[1] / H, sv = Math.sin(v), xn = Math.abs(Math.cos(v));
    if (y > 0.665) return sv > -0.15 && !(xn > 0.9 && y < 0.77) ? 'chest' : 'back';
    if (y > 0.545) return 'core';
    return sv < -0.2 ? 'glutes' : 'core';
  });
  add(torso, null);

  // ---- neck & head
  const neckR = 0.032 * (female ? 0.88 : 1) * H;
  add(limb(new V3(0, 0.8 * H, -0.004 * H), new V3(0, 0.885 * H, 0.004 * H), 1, (t) => neckR * (1 + 0.4 * (1 - t) ** 2 * (1 + 3 * m('back')))), 'back');
  add(ellipsoid(new V3(0, 0.93 * H, 0.006 * H), 0.046 * H, 0.064 * H, 0.054 * H), null);

  // ---- arms
  const dr = S * 0.135 * (1 + 0.9 * m('shoulders') + 0.3 * f('shoulders'));
  const A = T.arm, foreR = base.arm * 0.43 * (1 + m('forearms') + 0.4 * f('arms'));
  const bicep = 0.16 * (1 + 4 * m('arms'));
  for (const s of [1, -1]) {
    const J = new V3(s * (S / 2 - dr * 1.05) * H, 0.788 * H, 0);
    add(ellipsoid(J.clone().add(new V3(s * dr * 0.1 * H, -dr * 0.45 * H, 0)), dr * 1.02 * H, dr * 1.55 * H, dr * 1.15 * H), 'shoulders');
    const a1 = 0.24, a2 = 0.3;
    const elbow = J.clone().add(new V3(s * Math.sin(a1), -Math.cos(a1), 0.02).multiplyScalar(0.172 * H));
    const wrist = elbow.clone().add(new V3(s * Math.sin(a2), -Math.cos(a2), 0.12).normalize().multiplyScalar(0.148 * H));
    add(limb(J.clone().add(new V3(0, -0.01 * H, 0)), elbow, s, (t, fr, lat) => {
      const r = (A / 2) * H * (0.95 + 0.08 * g(t, 0.12, 0.15));
      return r * (1 + bicep * g(t, 0.55, 0.22) * Math.max(0, fr) ** 1.5 + 0.12 * g(t, 0.35, 0.25) * Math.max(0, -fr)) * (1 - 0.18 * smooth(0.8, 1, t));
    }), 'arms');
    add(limb(elbow, wrist, s, (t, fr, lat) => {
      const r = foreR * H * (0.92 + 0.15 * g(t, 0.22, 0.2));
      return r * (1 + 0.12 * g(t, 0.25, 0.2) * Math.max(0, lat)) * (1 - 0.42 * smooth(0.25, 1, t));
    }), 'forearms');
    const hd = wrist.clone().sub(elbow).normalize();
    add(ellipsoid(wrist.clone().addScaledVector(hd, 0.04 * H), 0.016 * H, 0.042 * H, 0.026 * H), null);
  }

  // ---- legs
  const hipX = Math.max(0.046, P * 0.265);
  const Th = T.thigh, Cf = T.calf;
  const quad = 0.1 * (1 + 4 * m('legs'));
  for (const s of [1, -1]) {
    const hip = new V3(s * hipX * H, 0.53 * H, 0);
    const knee = new V3(s * hipX * 0.88 * H, 0.285 * H, 0.004 * H);
    const ankle = new V3(s * hipX * 0.82 * H, 0.05 * H, -0.004 * H);
    add(limb(hip, knee, s, (t, fr, lat) => {
      const r = (Th / 2) * H * 1.08 * (1 - 0.45 * smooth(0.12, 1, t) - 0.05 * smooth(0, 0.12, t));
      return r * (1 + quad * g(t, 0.45, 0.25) * Math.max(0, fr * 0.7 + lat * 0.5) + 0.09 * g(t, 0.82, 0.1) * Math.max(0, -lat) * Math.max(0, fr));
    }), 'legs');
    add(limb(knee, ankle, s, (t, fr) => {
      const r = (Cf / 2) * H;
      return r * (0.78 + 0.32 * g(t, 0.28, 0.2) * (0.6 + 0.4 * Math.max(0, -fr))) * (1 - 0.38 * smooth(0.45, 1, t));
    }), 'calves');
    add(ellipsoid(new V3(ankle.x, 0.022 * H, 0.026 * H), 0.023 * H, 0.021 * H, 0.06 * H), null);
  }
  return parts;
}

function colorize(geo, heat) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const reg = geo.userData.region || geo.userData.regions[i];
    const c = heat && reg ? heatColor(heat[reg] || 0) : heat ? NEUTRAL : SKIN;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function makeMaterials() {
  return {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 }),
    ghost: new THREE.MeshStandardMaterial({ color: '#7fd8ff', transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.3, emissive: '#1b6ea8', emissiveIntensity: 0.4 }),
  };
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3550, 1.1));
  const key = new THREE.DirectionalLight(0xfff2e6, 2.4); key.position.set(2.2, 3.4, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fc8ff, 1.8); rim.position.set(-3, 2.5, -3); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-2.5, 1, 2); scene.add(fill);
}

function groundShadow() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.001;
  return m;
}

// ---------------------------------------------------------------- view
export class AvatarView {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    this.camera.position.set(0.75, 1.0, 3.55);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.91, 0);
    this.controls.enablePan = false;
    this.controls.minDistance = 1.6; this.controls.maxDistance = 9;
    this.controls.minPolarAngle = 0.5; this.controls.maxPolarAngle = 1.9;
    this.controls.enableDamping = true;
    this.controls.autoRotate = true; this.controls.autoRotateSpeed = 1.2;
    this.renderer.domElement.addEventListener('pointerdown', () => (this.controls.autoRotate = false));
    addLights(this.scene);
    this.scene.add(groundShadow());
    this.mat = makeMaterials();
    this.body = new THREE.Group(); this.ghost = new THREE.Group();
    this.scene.add(this.body, this.ghost);
    this.ro = new ResizeObserver(() => this.resize());
    const loop = () => { requestAnimationFrame(loop); if (this.renderer.domElement.isConnected) { this.controls.update(); this.renderer.render(this.scene, this.camera); } };
    loop();
  }
  mount(el) {
    this.ro.disconnect();
    el.appendChild(this.renderer.domElement);
    this.ro.observe(el);
    this.resize();
  }
  resize() {
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    // Fit the whole body (≈2.0 units tall, ≈0.9 wide) regardless of stage shape.
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(1.02 / half, 0.6 / (half * this.camera.aspect));
    const off = this.camera.position.clone().sub(this.controls.target).setLength(dist);
    this.camera.position.copy(this.controls.target).add(off);
  }
  static fill(group, parts, mat, heat) {
    for (const c of group.children) c.geometry.dispose();
    group.clear();
    for (const geo of parts) { if (heat !== undefined) colorize(geo, heat); group.add(new THREE.Mesh(geo, mat)); }
  }
  set(spec, { heat = null, ghost = null } = {}) {
    cancelAnimationFrame(this._anim);
    this.spec = spec; this.heat = heat;
    AvatarView.fill(this.body, buildBody(spec), this.mat.solid, heat);
    AvatarView.fill(this.ghost, ghost ? buildBody(ghost) : [], this.mat.ghost);
  }
  morph(from, to, opts = {}, ms = 700) {
    cancelAnimationFrame(this._anim);
    const t0 = performance.now();
    const step = (now) => {
      const t = clamp((now - t0) / ms, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      AvatarView.fill(this.body, buildBody(lerpSpec(from, to, e)), this.mat.solid, opts.heat || null);
      if (t < 1) this._anim = requestAnimationFrame(step);
      else this.set(to, opts);
    };
    this._anim = requestAnimationFrame(step);
  }
}

// Off-screen front-view render, used for demo check-in "photos".
let snap;
export function snapshot(spec, w = 360, h = 540) {
  if (!snap) {
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#23262f');
    addLights(scene); scene.add(groundShadow());
    const cam = new THREE.PerspectiveCamera(26, w / h, 0.1, 50);
    cam.position.set(0, 0.95, 4.4); cam.lookAt(0, 0.92, 0);
    const group = new THREE.Group(); scene.add(group);
    snap = { r, scene, cam, group, mat: makeMaterials().solid };
  }
  snap.r.setSize(w, h, false);
  AvatarView.fill(snap.group, buildBody(spec), snap.mat, null);
  snap.r.render(snap.scene, snap.cam);
  return snap.r.domElement.toDataURL('image/jpeg', 0.8);
}

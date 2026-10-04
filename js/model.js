// Body model: regions, realistic limits, muscle synergy, body-fat & timeline
// estimates, nutrition and workout generation. Pure functions, no DOM.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// Per-region cap on how much a natural lifter can realistically change girth
// in one "dream" cycle (8–12%). Small/genetically stubborn muscles get less.
export const REGIONS = [
  { id: 'shoulders', name: 'Shoulders', cap: 12 },
  { id: 'chest', name: 'Chest', cap: 12 },
  { id: 'back', name: 'Back & Lats', cap: 12 },
  { id: 'arms', name: 'Arms', cap: 12 },
  { id: 'forearms', name: 'Forearms', cap: 8 },
  { id: 'core', name: 'Core & Waist', cap: 10 },
  { id: 'glutes', name: 'Glutes', cap: 10 },
  { id: 'legs', name: 'Quads & Hams', cap: 10 },
  { id: 'calves', name: 'Calves', cap: 8 },
];
export const REGION_IDS = REGIONS.map((r) => r.id);
export const REGION_NAME = Object.fromEntries(REGIONS.map((r) => [r.id, r.name]));
export const MUSCLE_CAP = Object.fromEntries(REGIONS.map((r) => [r.id, r.cap]));
export const FAT_CAP = 12;

// Synergy: training one region also grows the muscles that assist it.
// LINKS[a][b] = share of a's growth that carries over to b.
export const LINKS = {
  arms: { forearms: 0.45, shoulders: 0.2, chest: 0.1, back: 0.1 },
  shoulders: { arms: 0.25, chest: 0.2, back: 0.2 },
  chest: { shoulders: 0.3, arms: 0.2 },
  back: { arms: 0.25, shoulders: 0.2, forearms: 0.2 },
  forearms: { arms: 0.2 },
  core: { back: 0.15, glutes: 0.1 },
  glutes: { legs: 0.35, core: 0.1 },
  legs: { glutes: 0.4, calves: 0.3, core: 0.1 },
  calves: { legs: 0.1 },
};

export function effectiveMuscle(intent = {}) {
  const eff = Object.fromEntries(REGION_IDS.map((r) => [r, intent[r] || 0]));
  for (const s of REGION_IDS)
    for (const [t, k] of Object.entries(LINKS[s] || {})) eff[t] += (intent[s] || 0) * k;
  for (const r of REGION_IDS) eff[r] = clamp(eff[r], -MUSCLE_CAP[r], MUSCLE_CAP[r]);
  return eff;
}

// Fat can't be spot-reduced: most of any change is spread across the whole
// body, with only a modest local bias toward the region you asked for.
export function effectiveFat(intent = {}) {
  const mean = avg(REGION_IDS.map((r) => intent[r] || 0));
  return Object.fromEntries(
    REGION_IDS.map((r) => [r, clamp(0.65 * mean + 0.35 * (intent[r] || 0), -FAT_CAP, FAT_CAP)])
  );
}

export const PRESETS = {
  'V-Taper': { mus: { shoulders: 10, back: 9, arms: 6, chest: 4 }, fat: Object.fromEntries(REGION_IDS.map((r) => [r, r === 'core' ? -12 : -7])) },
  Shredded: { mus: Object.fromEntries(REGION_IDS.map((r) => [r, 2])), fat: Object.fromEntries(REGION_IDS.map((r) => [r, -11])) },
  Powerbuilder: { mus: { legs: 9, glutes: 8, back: 10, chest: 8, shoulders: 5, arms: 5 }, fat: {} },
  Athletic: { mus: Object.fromEntries(REGION_IDS.map((r) => [r, 5])), fat: Object.fromEntries(REGION_IDS.map((r) => [r, -5])) },
};

// Silhouette widths as a fraction of standing height (front photo, A-pose).
export const METRIC_KEYS = ['shoulder', 'chest', 'waist', 'hip', 'thigh', 'arm', 'calf'];
export const METRIC_LABEL = { shoulder: 'Shoulders', chest: 'Chest', waist: 'Waist', hip: 'Hips', thigh: 'Thigh', arm: 'Upper arm', calf: 'Calf' };
export const DEFAULT_METRICS = {
  male: { shoulder: 0.255, chest: 0.19, waist: 0.165, hip: 0.19, thigh: 0.09, arm: 0.055, calf: 0.064 },
  female: { shoulder: 0.232, chest: 0.172, waist: 0.145, hip: 0.205, thigh: 0.095, arm: 0.05, calf: 0.06 },
};

// How each measured width responds to muscle / fat change in each region.
export const METRIC_MAP = {
  shoulder: { mus: { shoulders: 0.6, back: 0.2 }, fat: { shoulders: 0.25 } },
  chest: { mus: { chest: 0.35, back: 0.45 }, fat: { chest: 0.4 } },
  waist: { mus: { core: 0.15 }, fat: { core: 0.9 } },
  hip: { mus: { glutes: 0.45 }, fat: { glutes: 0.6 } },
  thigh: { mus: { legs: 0.8 }, fat: { legs: 0.6 } },
  arm: { mus: { arms: 0.9 }, fat: { arms: 0.5 } },
  calf: { mus: { calves: 0.9 }, fat: { calves: 0.4 } },
};
// Which region a measured change is attributed to (for the "where you changed" map).
export const METRIC_REGIONS = {
  shoulder: ['shoulders'], chest: ['chest', 'back'], waist: ['core'], hip: ['glutes'],
  thigh: ['legs'], arm: ['arms', 'forearms'], calf: ['calves'],
};

export function estimateMetricsFromProfile(p) {
  const d = DEFAULT_METRICS[p.sex];
  const bmi = p.weightKg / (p.heightCm / 100) ** 2;
  const k = bmi / 22.5;
  const out = {};
  for (const m of METRIC_KEYS) out[m] = d[m] * k ** (m === 'waist' ? 0.9 : 0.5);
  return out;
}

export function targetMetrics(base, musEff, fatEff) {
  const out = {};
  for (const m of METRIC_KEYS) {
    let s = 0;
    for (const [r, w] of Object.entries(METRIC_MAP[m].mus)) s += (w * musEff[r]) / 100;
    for (const [r, w] of Object.entries(METRIC_MAP[m].fat)) s += (w * fatEff[r]) / 100;
    out[m] = base[m] * (1 + s);
  }
  return out;
}

export function estimateBodyFat(p, metrics, fromScan) {
  const bmi = p.weightKg / (p.heightCm / 100) ** 2;
  const deurenberg = 1.2 * bmi + 0.23 * p.age - 10.8 * (p.sex === 'male' ? 1 : 0) - 5.4;
  if (!fromScan || !metrics) return clamp(deurenberg, 5, 50);
  // Relative Fat Mass from waist circumference (front width → ellipse circumference).
  const waistCirc = metrics.waist * p.heightCm * 2.75;
  const rfm = 64 - (20 * p.heightCm) / waistCirc + (p.sex === 'female' ? 12 : 0);
  return clamp(0.6 * rfm + 0.4 * deurenberg, 5, 50);
}

const MASS_W = { legs: 0.28, back: 0.16, glutes: 0.12, chest: 0.1, shoulders: 0.08, arms: 0.08, core: 0.08, calves: 0.06, forearms: 0.04 };
const GAIN_PER_MONTH = { beginner: 0.9, intermediate: 0.45, advanced: 0.2 }; // kg lean mass

// Everything the app needs to know about the gap between now and the dream.
export function buildPlan(state) {
  const p = state.profile;
  const base = state.baseline.metrics;
  const musEff = effectiveMuscle(state.intent.mus);
  const fatEff = effectiveFat(state.intent.fat);
  const target = targetMetrics(base, musEff, fatEff);
  const bf = state.baseline.bodyFat;
  const minBF = p.sex === 'male' ? 7 : 14;

  const avgMus = REGION_IDS.reduce((s, r) => s + (MASS_W[r] * musEff[r]) / 100, 0);
  const avgFat = avg(REGION_IDS.map((r) => fatEff[r] / 100));
  const rawTBF = bf * (1 + avgFat * 3.3);
  const targetBF = clamp(rawTBF, minBF, 50);

  const lbm = p.weightKg * (1 - bf / 100);
  const leanGain = 0.45 * lbm * 2 * avgMus; // girth % → cross-section ≈ 2× mass %
  const targetWeight = (lbm + leanGain) / (1 - targetBF / 100);
  const fatChange = (targetWeight * targetBF) / 100 - (p.weightKg * bf) / 100;

  const rate = GAIN_PER_MONTH[p.experience] * (p.sex === 'female' ? 0.55 : 1);
  const gainWeeks = (Math.max(0, leanGain) / rate) * 4.35;
  const cutWeeks = Math.max(0, -fatChange) / (p.weightKg * 0.0065);

  let phase, weeks;
  if (leanGain > 0.5 && fatChange < -1) {
    if (p.experience === 'beginner' || bf > 20) { phase = 'Recomp'; weeks = Math.max(gainWeeks, cutWeeks) * 1.25; }
    else { phase = 'Cut → Lean bulk'; weeks = gainWeeks + cutWeeks; }
  } else if (leanGain > 0.5) { phase = 'Lean bulk'; weeks = gainWeeks; }
  else if (fatChange < -1) { phase = 'Cut'; weeks = cutWeeks; }
  else { phase = 'Maintain'; weeks = 8; }
  weeks = Math.max(4, Math.round(weeks));

  return {
    musEff, fatEff, target, base, bf, targetBF, bfFloorHit: rawTBF < minBF,
    weight: p.weightKg, targetWeight, leanGain, fatChange, phase, weeks,
    macros: macros(p, phase),
    priorities: [...REGION_IDS].sort((a, b) => musEff[b] - musEff[a]),
  };
}

export function macros(p, phase) {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * (1.25 + 0.05 * p.days);
  const adj = { Cut: -0.2, 'Cut → Lean bulk': -0.2, Recomp: -0.08, 'Lean bulk': 0.1, Maintain: 0 }[phase];
  const kcal = Math.round((tdee * (1 + adj)) / 10) * 10;
  const protein = Math.round(p.weightKg * (adj < 0 ? 2.2 : 1.8));
  const fat = Math.round(Math.max(p.weightKg * 0.8, (kcal * 0.22) / 9));
  const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, tdee: Math.round(tdee), protein, fat, carbs, adj };
}

// Progress (0–1) of measured metrics from baseline toward target. Uses a
// rolling average of recent check-ins to damp photo-to-photo noise.
export function progress(base, target, recent) {
  const usable = recent.filter(Boolean);
  if (!usable.length) return { overall: 0, per: {}, current: null };
  const current = {};
  for (const m of METRIC_KEYS) current[m] = avg(usable.map((x) => x[m]));
  let num = 0, den = 0;
  const per = {};
  for (const m of METRIC_KEYS) {
    const d = target[m] - base[m];
    const w = Math.abs(d) / base[m];
    if (w < 0.004) continue;
    per[m] = clamp((current[m] - base[m]) / d, 0, 1);
    num += per[m] * w; den += w;
  }
  return { overall: den ? num / den : 0, per, current };
}

export function measuredRegionChange(base, current) {
  const out = Object.fromEntries(REGION_IDS.map((r) => [r, 0]));
  if (!current) return out;
  for (const m of METRIC_KEYS)
    for (const r of METRIC_REGIONS[m]) out[r] = ((current[m] - base[m]) / base[m]) * 100 * (r === 'forearms' ? 0.6 : 1);
  return out;
}

// ---------------------------------------------------------------- workouts
const EX = {
  chest: [['Incline dumbbell press', '6–10', 'Elbows ~45°, 2s lower, deep stretch'], ['Flat barbell bench', '5–8', 'Shoulder blades pinned, feet driving'], ['Cable fly', '10–15', 'Hug a tree, squeeze 1s'], ['Deficit push-ups', 'AMRAP', 'Full range, chest to floor']],
  shoulders: [['Overhead press', '6–10', 'Glutes tight, bar path over mid-foot'], ['Lateral raise', '12–20', 'Lead with elbows, no swinging'], ['Rear-delt fly', '15–20', 'Pinkies out, think "wide"'], ['Cable Y-raise', '12–15', 'Light, slow, full stretch']],
  back: [['Pull-ups / lat pulldown', '6–12', 'Drive elbows to back pockets'], ['Chest-supported row', '8–12', 'Pause at the top'], ['Straight-arm pulldown', '12–15', 'Feel the lats stretch'], ['One-arm dumbbell row', '8–12', 'Long reach at the bottom']],
  arms: [['EZ-bar curl', '8–12', 'Elbows still, 3s lower'], ['Overhead triceps extension', '10–15', 'Deep stretch behind the head'], ['Incline dumbbell curl', '10–15', 'Let the arm hang back'], ['Close-grip bench / dips', '6–10', 'Elbows tucked']],
  forearms: [['Hammer curl', '10–15', 'Neutral grip, controlled'], ['Farmer carry', '40 m', 'Tall posture, crush the handles'], ['Wrist curl', '15–20', 'Full range, slow']],
  core: [['Hanging knee raise', '10–15', 'Curl the pelvis, no swinging'], ['Cable crunch', '12–15', 'Ribs to hips'], ['Pallof press', '10/side', 'Resist the rotation']],
  glutes: [['Hip thrust', '8–12', 'Chin tucked, 1s squeeze at top'], ['Romanian deadlift', '8–10', 'Hips back, soft knees'], ['Bulgarian split squat', '8–12/leg', 'Lean forward slightly for glutes']],
  legs: [['Back squat', '5–8', 'Brace, sit between the hips'], ['Leg press', '10–15', 'Full depth, no lockout'], ['Lying leg curl', '10–15', 'Hips pressed down'], ['Walking lunge', '10/leg', 'Long stride, upright torso']],
  calves: [['Standing calf raise', '10–15', '2s pause in the stretch'], ['Seated calf raise', '15–20', 'Full range, no bouncing']],
};
const SPLITS = {
  3: [['Full Body A', ['legs', 'chest', 'back', 'shoulders', 'arms', 'core']], ['Full Body B', ['glutes', 'back', 'chest', 'shoulders', 'arms', 'calves']], ['Full Body C', ['legs', 'shoulders', 'back', 'chest', 'forearms', 'core']]],
  4: [['Upper A', ['chest', 'back', 'shoulders', 'arms']], ['Lower A', ['legs', 'glutes', 'calves', 'core']], ['Upper B', ['back', 'shoulders', 'chest', 'arms', 'forearms']], ['Lower B', ['glutes', 'legs', 'calves', 'core']]],
  5: [['Push', ['chest', 'shoulders', 'arms']], ['Pull', ['back', 'arms', 'forearms']], ['Legs', ['legs', 'glutes', 'calves', 'core']], ['Upper', ['shoulders', 'back', 'chest', 'arms']], ['Lower', ['glutes', 'legs', 'calves', 'core']]],
  6: [['Push A', ['chest', 'shoulders', 'arms']], ['Pull A', ['back', 'arms', 'forearms']], ['Legs A', ['legs', 'glutes', 'calves']], ['Push B', ['shoulders', 'chest', 'arms']], ['Pull B', ['back', 'forearms', 'arms']], ['Legs B', ['glutes', 'legs', 'calves', 'core']]],
};

export function splitLength(days) { return SPLITS[days].length; }

export function workoutFor(plan, days, index) {
  const split = SPLITS[days];
  const [name, regions] = split[index % split.length];
  const cycle = Math.floor(index / split.length);
  const ranked = [...regions].sort((a, b) => plan.musEff[b] - plan.musEff[a]);
  const exercises = [];
  for (const r of ranked) {
    const e = plan.musEff[r];
    const n = e >= 6 && regions.length <= 4 ? 2 : 1;
    const sets = e >= 8 ? 4 : e >= 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const [ex, reps, cue] = EX[r][(cycle + i * 2 + (index % 2)) % EX[r].length];
      exercises.push({ id: `${r}-${ex}`, name: ex, sets, reps, cue, region: r });
    }
  }
  if (plan.phase.startsWith('Cut') || plan.phase === 'Recomp')
    exercises.push({ id: 'cardio', name: 'Incline walk finisher', sets: 1, reps: '12 min', cue: 'Zone 2: you can still talk', region: 'core' });
  return { name, focus: REGION_NAME[ranked[0]], exercises };
}

// ---------------------------------------------------------------- dates
export function localDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}

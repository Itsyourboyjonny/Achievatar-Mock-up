import {
  REGIONS, REGION_IDS, REGION_NAME, MUSCLE_CAP, FAT_CAP, PRESETS, METRIC_KEYS, METRIC_LABEL,
  effectiveMuscle, effectiveFat, estimateMetricsFromProfile, estimateBodyFat, buildPlan, progress,
  measuredRegionChange, workoutFor, splitLength, localDate, addDays, clamp, lerp, DEFAULT_METRICS,
} from './model.js';
import { AvatarView, lerpSpec, snapshot } from './avatar.js';
import { analyzePhoto, loadImage, warmUp } from './scan.js';
import { buildPath } from './lessons.js';

// Each person on this device gets their own profile; their data lives under
// its own storage key. The index of profiles lives under USERS_KEY.
const USERS_KEY = 'achievatar.users';
const userKey = (id) => `achievatar.u.${id}`;
const LEGACY_KEYS = ['achievatar.v1', 'forge.v1']; // single-user saves from earlier versions
const COLORS = ['#58cc02', '#1cb0f6', '#ff9600', '#ce82ff', '#ff4b4b', '#2b70c9', '#ffc800', '#00cd9c'];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const pct = (x) => `${Math.round(x * 100)}%`;
const sgn = (x, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}%`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let U = loadUsers();
let S = fresh();
let avatar;
let tab = 'today';
const ui = { view: 'dream', ghost: true, heat: false, kind: 'mus' };

function fresh() {
  return { v: 1, profile: null, baseline: null, intent: { mus: {}, fat: {} }, checkins: [], streak: { count: 0, last: null, best: 0 }, xp: 0, lessons: [], workoutsDone: 0, today: { date: null, done: [] } };
}
function loadUsers() {
  try { const u = JSON.parse(localStorage.getItem(USERS_KEY)); if (u?.list) return u; } catch {}
  const u = { list: [], current: null };
  try {
    // Move a pre-profiles save into a first profile so nobody loses progress.
    const old = LEGACY_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
    if (old) {
      const id = Date.now().toString(36);
      localStorage.setItem(userKey(id), old);
      u.list.push({ id, name: 'Me', color: COLORS[0] });
      localStorage.setItem(USERS_KEY, JSON.stringify(u));
      LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
    }
  } catch {}
  return u;
}
function saveUsers() { try { localStorage.setItem(USERS_KEY, JSON.stringify(U)); } catch {} }
function loadState(id) { try { return { ...fresh(), ...JSON.parse(localStorage.getItem(userKey(id))) }; } catch { return fresh(); } }
const currentUser = () => U.list.find((u) => u.id === U.current);
function save() {
  if (!U.current) return;
  const KEY = userKey(U.current);
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch {
    // Storage full: thin out the oldest photos (keep every other one) and retry.
    const cs = S.checkins.filter((c) => c.photo);
    cs.slice(0, -10).forEach((c, i) => { if (i % 2) c.photo = null; });
    try { localStorage.setItem(KEY, JSON.stringify(S)); toast('Storage was full, so some older photos were thinned out.'); } catch { toast('Could not save. Browser storage is full.'); }
  }
}
function getAvatar() { return (avatar ??= new AvatarView()); }

// ---------------------------------------------------------------- derived
const plan = () => buildPlan(S);
const nowSpec = () => ({ sex: S.profile.sex, base: S.baseline.metrics, target: S.baseline.metrics, mus: {}, fat: {}, bf: S.baseline.bodyFat });
const dreamSpec = (P = plan()) => ({ sex: S.profile.sex, base: S.baseline.metrics, target: P.target, mus: P.musEff, fat: P.fatEff, bf: P.targetBF });
const recentMetrics = (upto = S.checkins.length) => S.checkins.slice(0, upto).filter((c) => c.metrics).slice(-3).map((c) => c.metrics);
function progressNow(P = plan(), upto) { return progress(S.baseline.metrics, P.target, recentMetrics(upto)); }
function currentSpec(P = plan()) {
  const pr = progressNow(P);
  const s = lerpSpec(nowSpec(), dreamSpec(P), pr.overall);
  if (pr.current) s.target = pr.current;
  return s;
}
function streakAlive() {
  const t = localDate();
  return S.streak.last === t || S.streak.last === addDays(t, -1) ? S.streak.count : 0;
}
const checkedInToday = () => S.checkins.some((c) => c.date === localDate());

// ---------------------------------------------------------------- shell
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
function burst(emoji = ['🔥', '💪', '⭐', '🎉']) {
  const host = $('#phone');
  for (let i = 0; i < 26; i++) {
    const s = document.createElement('span');
    s.className = 'confetti'; s.textContent = emoji[i % emoji.length];
    s.style.left = `${50 + (Math.random() - 0.5) * 30}%`;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 340}px`);
    s.style.setProperty('--dy', `${-200 - Math.random() * 260}px`);
    s.style.setProperty('--r', `${(Math.random() - 0.5) * 720}deg`);
    host.appendChild(s); setTimeout(() => s.remove(), 1400);
  }
}
function openModal(html, cls = '') { const m = $('#modal'); m.className = cls; m.innerHTML = `<div class="sheet-modal">${html}</div>`; m.hidden = false; return m; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

function updateTopbar() {
  const me = currentUser();
  if (me) { const b = $('#tb-me'); b.textContent = me.name.trim()[0]?.toUpperCase() || '?'; b.style.background = me.color; b.title = `${me.name} · switch user`; }
  $('#tb-streak b').textContent = streakAlive();
  $('#tb-streak').classList.toggle('lit', checkedInToday());
  $('#tb-xp b').textContent = S.xp;
  const p = progressNow().overall;
  $('#tb-prog b').textContent = pct(p);
  $('#tb-prog i').style.width = pct(p);
}

function showMain(t = tab) {
  $('#onboard').hidden = true; $('#main').hidden = false;
  tab = t;
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  const v = $('#view'); v.scrollTop = 0;
  v.classList.toggle('dream-mode', t === 'dream');
  ({ today: renderToday, dream: renderDream, learn: renderLearn, eat: renderEat, progress: renderProgress })[t](v);
  updateTopbar();
}
$$('.tabbar button').forEach((b) => (b.onclick = () => showMain(b.dataset.tab)));

// ---------------------------------------------------------------- onboarding
function onboard(step, data = {}) {
  $('#main').hidden = true;
  const el = $('#onboard'); el.hidden = false; el.scrollTop = 0;
  ({ users: obUsers, welcome: obWelcome, profile: obProfile, scan: obScan, analyze: obAnalyze })[step](el, data);
}

function obWelcome(el) {
  el.innerHTML = `
    <div class="ob-hero">
      <div class="logo">ACHIEVATAR</div>
      <div class="mascot">🧬</div>
      ${currentUser() ? `<div class="eyebrow">Welcome, ${esc(currentUser().name)}</div>` : ''}
      <h1>Become your own creation</h1>
      <p>Scan your body, design the version of you you're working toward, and get a daily plan to get there.</p>
    </div>
    <ul class="ob-points">
      <li><b>📸 Scan</b> a photo into a 3D avatar</li>
      <li><b>🎚️ Sculpt</b> realistic muscle &amp; fat goals</li>
      <li><b>🔥 Streaks</b>, lessons and daily check-ins</li>
      <li><b>📈 See</b> exactly where you've changed</li>
    </ul>
    <button class="btn primary big" id="go">Get started</button>
    <button class="btn ghost" id="switch">← Switch user</button>`;
  $('#go').onclick = () => onboard('profile');
  $('#switch').onclick = () => onboard('users');
  warmUp();
}

function obProfile(el) {
  const p = S.profile || { sex: 'male', age: 25, heightCm: 178, weightKg: 75, experience: 'beginner', days: 4, units: 'metric' };
  const seg = (name, opts, val) => `<div class="seg" data-name="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const ftIn = Math.round(p.heightCm / 2.54);
  el.innerHTML = `
    <div class="ob-head"><button class="back" id="back">←</button><div class="steps"><i class="on"></i><i></i><i></i></div></div>
    <h2>About you</h2>
    <p class="muted">Used to scale your avatar and estimate body fat, calories and timelines.</p>
    <form id="pf" class="form">
      <label>Body type ${seg('sex', [['male', 'Male'], ['female', 'Female']], p.sex)}</label>
      <label>Units ${seg('units', [['metric', 'cm / kg'], ['imperial', 'ft / lb']], p.units)}</label>
      <div class="row2">
        <label>Age <input name="age" type="number" min="14" max="90" value="${p.age}" required></label>
        <label class="m">Height (cm) <input name="h" type="number" min="120" max="230" value="${p.heightCm}"></label>
        <label class="i">Height <span class="ftin"><input name="ft" type="number" min="4" max="7" value="${Math.floor(ftIn / 12)}">ft <input name="in" type="number" min="0" max="11" value="${ftIn % 12}">in</span></label>
      </div>
      <label class="m">Weight (kg) <input name="w" type="number" min="35" max="250" step="0.1" value="${p.weightKg}"></label>
      <label class="i">Weight (lb) <input name="lb" type="number" min="80" max="550" step="0.1" value="${Math.round(p.weightKg * 2.2046)}"></label>
      <label>Training experience ${seg('experience', [['beginner', '&lt; 1 yr'], ['intermediate', '1–3 yrs'], ['advanced', '3+ yrs']], p.experience)}</label>
      <label>Days per week you can train ${seg('days', [[3, '3'], [4, '4'], [5, '5'], [6, '6']], p.days)}</label>
      <button class="btn primary big">Continue</button>
    </form>`;
  const form = $('#pf');
  const syncUnits = () => { const imp = $('.seg[data-name=units] .on').dataset.v === 'imperial'; $$('.m', form).forEach((x) => (x.hidden = imp)); $$('.i', form).forEach((x) => (x.hidden = !imp)); };
  $$('.seg', form).forEach((s) => s.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('button', s).forEach((x) => x.classList.toggle('on', x === b)); syncUnits(); }));
  syncUnits();
  $('#back').onclick = () => onboard('welcome');
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const segv = (n) => $(`.seg[data-name=${n}] .on`, form).dataset.v;
    const units = segv('units');
    const heightCm = units === 'metric' ? +f.get('h') : (+f.get('ft') * 12 + +f.get('in')) * 2.54;
    const weightKg = units === 'metric' ? +f.get('w') : +f.get('lb') / 2.2046;
    if (!(heightCm > 120 && heightCm < 230 && weightKg > 35 && weightKg < 250)) return toast('Please check your height and weight.');
    S.profile = { sex: segv('sex'), units, age: +f.get('age'), heightCm: Math.round(heightCm), weightKg: Math.round(weightKg * 10) / 10, experience: segv('experience'), days: +segv('days') };
    save();
    onboard('scan');
  };
}

function obScan(el) {
  el.innerHTML = `
    <div class="ob-head"><button class="back" id="back">←</button><div class="steps"><i class="on"></i><i class="on"></i><i></i></div></div>
    <h2>Scan your body</h2>
    <div class="pose-guide">
      <svg viewBox="0 0 120 200" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="60" cy="22" r="13"/><path d="M60 35v62M60 48 30 92M60 48l30 44M60 97l-16 92M60 97l16 92"/></g></svg>
      <ul>
        <li>Full body in frame, head to toe</li>
        <li>Face the camera, arms ~30° out</li>
        <li>Fitted clothes, plain background</li>
        <li>Prop the phone at waist height, use a timer</li>
      </ul>
    </div>
    <p class="muted small">Your photo is analysed on this device and never uploaded.</p>
    <input type="file" id="cam" accept="image/*" capture="environment" hidden>
    <input type="file" id="lib" accept="image/*" hidden>
    <button class="btn primary big" id="take">📸 Take photo</button>
    <button class="btn big" id="upload">🖼️ Upload from library</button>
    <div class="or">or</div>
    <button class="btn ghost" id="est">Skip: estimate from height &amp; weight</button>
    <button class="btn ghost" id="demo">Try the demo body</button>`;
  $('#back').onclick = () => onboard('profile');
  $('#take').onclick = () => $('#cam').click();
  $('#upload').onclick = () => $('#lib').click();
  const pick = (e) => e.target.files[0] && onboard('analyze', { file: e.target.files[0] });
  $('#cam').onchange = pick; $('#lib').onchange = pick;
  $('#est').onclick = () => finishBaseline(estimateMetricsFromProfile(S.profile), false, null, 'estimate');
  $('#demo').onclick = () => finishBaseline({ ...DEFAULT_METRICS[S.profile.sex] }, false, null, 'demo');
}

async function obAnalyze(el, { file }) {
  el.innerHTML = `
    <div class="ob-head"><button class="back" id="back">←</button><div class="steps"><i class="on"></i><i class="on"></i><i class="on"></i></div></div>
    <h2>Analysing…</h2>
    <div class="scanbox"><canvas id="sc"></canvas><div class="scanline"></div></div>
    <div id="scan-out"><p class="muted center">Finding your joints and outline…</p></div>`;
  $('#back').onclick = () => onboard('scan');
  let img;
  try { img = await loadImage(file); } catch (e) { return toast(e.message); }
  const cv = $('#sc');
  const k = Math.min(1, 900 / img.naturalHeight);
  cv.width = img.naturalWidth * k; cv.height = img.naturalHeight * k;
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);

  const r = await analyzePhoto(img, S.profile.sex);
  $('.scanline')?.remove();
  const out = $('#scan-out');
  if (!r.ok) {
    $('h2', el).textContent = 'Let\'s try that again';
    out.innerHTML = `<div class="alert">${r.reason}</div>
      <button class="btn primary big" id="retry">Retake photo</button>
      <button class="btn ghost" id="est">Continue with an estimate instead</button>`;
    $('#retry').onclick = () => onboard('scan');
    $('#est').onclick = () => finishBaseline(estimateMetricsFromProfile(S.profile), false, r.photo, 'estimate');
    return;
  }
  drawOverlay(cv, r.overlay);
  const bf = estimateBodyFat(S.profile, r.metrics, true);
  $('h2', el).textContent = 'Scan complete';
  out.innerHTML = `
    <div class="measure-grid">${METRIC_KEYS.map((m) => `<div><span>${METRIC_LABEL[m]}</span><b>${(r.metrics[m] * S.profile.heightCm).toFixed(1)} cm</b></div>`).join('')}
      <div class="hl"><span>Est. body fat</span><b>${bf.toFixed(1)}%</b></div></div>
    <p class="muted small">Front-view widths. ${r.warnings.length ? r.warnings.join(' ') : 'Everything was read cleanly.'}</p>
    <button class="btn primary big" id="ok">Build my 3D avatar</button>
    <button class="btn ghost" id="retry">Retake</button>`;
  $('#ok').onclick = () => finishBaseline(r.metrics, true, r.photo, 'scan');
  $('#retry').onclick = () => onboard('scan');
}

function drawOverlay(cv, ov) {
  const x = cv.getContext('2d');
  const sx = cv.width / ov.mw, sy = cv.height / ov.mh;
  x.save(); x.scale(sx, sy);
  x.lineWidth = 3 / sx; x.font = `bold ${13 / sx}px Nunito, sans-serif`;
  const bones = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
  x.strokeStyle = 'rgba(88,204,2,.75)';
  for (const [a, b] of bones) { const p = ov.landmarks[a], q = ov.landmarks[b]; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke(); }
  for (const l of ov.lines) {
    x.strokeStyle = '#1cb0f6'; x.beginPath(); x.moveTo(l.l, l.y); x.lineTo(l.r, l.y); x.stroke();
    x.fillStyle = '#1cb0f6'; [l.l, l.r].forEach((px) => { x.beginPath(); x.arc(px, l.y, 4 / sx, 0, 7); x.fill(); });
  }
  x.restore();
}

function finishBaseline(metrics, fromScan, photo, source) {
  const date = localDate();
  const bodyFat = estimateBodyFat(S.profile, metrics, fromScan);
  S.baseline = { metrics, bodyFat, date, source, photo: null };
  S.baseline.photo = photo || snapshot(nowSpec());
  save();
  ui.view = 'dream';
  showMain('dream');
  setTimeout(() => toast('Meet your avatar 👋 Now sculpt your dream physique.', 3500), 200);
}

// ---------------------------------------------------------------- TODAY
function renderToday(v) {
  const P = plan();
  if (S.today.date !== localDate()) S.today = { date: localDate(), done: [] };
  const w = workoutFor(P, S.profile.days, S.workoutsDone);
  const done = checkedInToday();
  const streak = streakAlive();
  const week = [...Array(7)].map((_, i) => addDays(localDate(), i - 6));
  const days = new Set(S.checkins.map((c) => c.date));
  const nextLesson = buildPath(P).flatMap((u) => u.lessons).find((l) => !S.lessons.includes(l.id));
  const pr = progressNow(P);
  const ndone = w.exercises.filter((e) => S.today.done.includes(e.id)).length;

  v.innerHTML = `
    <section class="card streak-card ${done ? 'safe' : ''}">
      <div class="flame">${done ? '🔥' : streak ? '🔥' : '🪵'}</div>
      <div><h2>${streak} day streak</h2>
        <p>${done ? 'Streak secured for today. See you tomorrow!' : streak ? 'Finish today\'s check-in to keep it alive.' : 'Start a streak with your first check-in.'}</p></div>
      <div class="week">${week.map((d) => `<span class="${days.has(d) ? 'on' : ''} ${d === localDate() ? 'today' : ''}">${'SMTWTFS'[new Date(d + 'T12:00').getDay()]}</span>`).join('')}</div>
    </section>

    <section class="card">
      <div class="card-h"><div><div class="eyebrow">Today's workout · ${P.phase}</div><h3>${w.name}</h3></div><span class="pill">${w.focus} focus</span></div>
      <ul class="ex-list">${w.exercises.map((e) => `
        <li class="${S.today.done.includes(e.id) ? 'done' : ''}" data-id="${e.id}">
          <span class="tick"></span>
          <div><b>${e.name}</b><small>${e.cue}</small></div>
          <span class="sets">${e.sets}×${e.reps}</span>
        </li>`).join('')}</ul>
      ${done ? `<div class="done-banner">✅ Checked in today</div>` : `
      <button class="btn primary big" id="finish" ${ndone < Math.ceil(w.exercises.length / 2) ? 'disabled' : ''}>Finish workout &amp; check in</button>
      <button class="btn ghost" id="rest">Rest day? Just check in</button>`}
    </section>

    <section class="card row-card" id="goto-progress">
      <div class="ring" style="--p:${pr.overall}"><b>${pct(pr.overall)}</b></div>
      <div><h3>To your dream physique</h3><p class="muted">${S.checkins.length ? `${S.checkins.length} check-ins · ~${P.weeks} week plan` : 'Your first check-in sets the baseline for tracking.'}</p></div>
      <span class="chev">›</span>
    </section>

    ${nextLesson ? `<section class="card row-card" id="goto-learn"><div class="lesson-ico">${nextLesson.icon}</div><div><div class="eyebrow">Next lesson · +15 XP</div><h3>${nextLesson.title}</h3></div><span class="chev">›</span></section>` : ''}

    <section class="card row-card" id="goto-eat"><div class="lesson-ico">🥗</div><div><div class="eyebrow">Today's fuel</div><h3>${P.macros.kcal} kcal · ${P.macros.protein} g protein</h3></div><span class="chev">›</span></section>`;

  $$('.ex-list li', v).forEach((li) => (li.onclick = () => {
    const id = li.dataset.id, d = S.today.done;
    d.includes(id) ? d.splice(d.indexOf(id), 1) : d.push(id);
    save(); renderToday(v);
  }));
  $('#finish', v) && ($('#finish', v).onclick = () => checkinFlow(w.name));
  $('#rest', v) && ($('#rest', v).onclick = () => checkinFlow(null));
  $('#goto-progress', v).onclick = () => showMain('progress');
  $('#goto-learn', v) && ($('#goto-learn', v).onclick = () => showMain('learn'));
  $('#goto-eat', v).onclick = () => showMain('eat');
}

// ---------------------------------------------------------------- check-in
function checkinFlow(workout) {
  const n = streakAlive() + 1;
  const m = openModal(`
    <button class="x" id="x">✕</button>
    <div class="big-emoji">📸</div>
    <h2>Lock in day ${n}</h2>
    <p class="muted">Take today's progress photo in the same spot and pose as your scan. We'll measure it against your dream physique.</p>
    <input type="file" id="cam" accept="image/*" capture="environment" hidden>
    <input type="file" id="lib" accept="image/*" hidden>
    <button class="btn primary big" id="take">Take photo</button>
    <button class="btn big" id="upload">Upload photo</button>
    <button class="btn ghost" id="sim">Demo: simulate a photo</button>`);
  $('#x', m).onclick = closeModal;
  $('#take', m).onclick = () => $('#cam', m).click();
  $('#upload', m).onclick = () => $('#lib', m).click();
  const run = async (file) => {
    $('.sheet-modal', m).innerHTML = `<div class="big-emoji spin">🧬</div><h2>Analysing your photo…</h2><p class="muted">Measuring shoulders, waist, arms, legs…</p>`;
    let r;
    try { r = await analyzePhoto(await loadImage(file), S.profile.sex); } catch (e) { r = { ok: false, reason: e.message }; }
    completeCheckin({ workout, photo: r.photo || null, metrics: r.ok ? r.metrics : null, note: r.ok ? null : r.reason });
  };
  $('#cam', m).onchange = (e) => e.target.files[0] && run(e.target.files[0]);
  $('#lib', m).onchange = (e) => e.target.files[0] && run(e.target.files[0]);
  $('#sim', m).onclick = () => completeCheckin({ workout, ...simulatePhoto() });
}

// Demo only: fakes a check-in that moves toward the dream at a natural pace.
function simulatePhoto(prev = progressNow().overall) {
  const P = plan();
  const p = clamp(prev + (0.5 + Math.random()) / (P.weeks * 7), 0, 1);
  const metrics = {};
  for (const k of METRIC_KEYS) metrics[k] = lerp(S.baseline.metrics[k], P.target[k], p) * (1 + (Math.random() - 0.5) * 0.012);
  return { metrics, photo: snapshot(lerpSpec(nowSpec(), dreamSpec(P), p)), p };
}

function completeCheckin({ workout, photo, metrics, note }) {
  const before = progressNow().overall;
  const today = localDate();
  S.checkins = S.checkins.filter((c) => c.date !== today);
  S.checkins.push({ date: today, photo, metrics, workout });
  if (workout) { S.workoutsDone++; S.xp += 20; }
  S.xp += 10;
  const y = addDays(today, -1);
  S.streak.count = S.streak.last === y ? S.streak.count + 1 : S.streak.last === today ? S.streak.count : 1;
  S.streak.last = today;
  S.streak.best = Math.max(S.streak.best, S.streak.count);
  save();
  const P = plan();
  const pr = progressNow(P);
  const ch = measuredRegionChange(S.baseline.metrics, pr.current);
  const top = REGION_IDS.filter((r) => Math.abs(ch[r]) > 0.3).sort((a, b) => Math.abs(P.musEff[b] - ch[b]) - Math.abs(P.musEff[a] - ch[a])).slice(0, 4);
  const m = openModal(`
    <div class="big-emoji pop">🔥</div>
    <h2>${S.streak.count} day streak!</h2>
    <p class="muted">+${workout ? 30 : 10} XP${workout ? ` · ${workout} complete` : ''}</p>
    <div class="prog-anim"><div class="bar"><i style="width:${pct(before)}"></i></div><b id="pa">${pct(before)}</b></div>
    <p class="small muted">${metrics ? 'of the way to your dream physique (3-photo rolling average)' : `Photo saved, but couldn't be measured: ${note || 'no body detected.'}`}</p>
    ${top.length ? `<div class="chips">${top.map((r) => `<span class="chip-c ${ch[r] >= 0 ? 'up' : 'down'}">${REGION_NAME[r]} ${sgn(ch[r])}</span>`).join('')}</div>` : ''}
    ${photo ? `<img class="ci-photo" src="${photo}" alt="Today's check-in">` : ''}
    <button class="btn primary big" id="ok">Continue</button>`);
  burst();
  requestAnimationFrame(() => setTimeout(() => { $('.prog-anim i', m).style.width = pct(pr.overall); $('#pa', m).textContent = pct(pr.overall); }, 300));
  $('#ok', m).onclick = () => { closeModal(); showMain(tab); };
}

// ---------------------------------------------------------------- DREAM
function renderDream(v) {
  v.innerHTML = `
    <div class="stage" id="stage">
      <div class="stage-ui">
        <div class="seg dark" id="viewseg"><button data-v="now">Now</button><button data-v="dream">Dream</button></div>
        <div class="toggles">
          <button id="tg-ghost" title="Show your current body as a ghost">👻</button>
          <button id="tg-heat" title="Heatmap of changes">🌡️</button>
        </div>
      </div>
      <div class="legend" id="legend" hidden><span class="dn">Shrink</span><i></i><span class="up">Grow</span></div>
      <div class="hint">Drag to rotate · pinch to zoom</div>
    </div>
    <div class="dream-sheet">
      <div class="stats" id="stats"></div>
      <div class="presets">${Object.keys(PRESETS).map((k) => `<button data-p="${k}">${k}</button>`).join('')}<button data-p="reset">Reset</button></div>
      <div class="seg" id="kindseg"><button data-v="mus">💪 Muscle</button><button data-v="fat">🫧 Body fat</button></div>
      <p class="note" id="kindnote"></p>
      <div id="sliders"></div>
      <button class="btn ghost" id="rescan">↻ Rescan my body</button>
    </div>`;
  getAvatar().mount($('#stage'));
  renderSliders();
  refreshDream();

  $$('#viewseg button').forEach((b) => (b.onclick = () => {
    const P = plan();
    const from = ui.view === 'now' ? nowSpec() : dreamSpec(P);
    ui.view = b.dataset.v;
    const to = ui.view === 'now' ? nowSpec() : dreamSpec(P);
    syncDreamUi();
    getAvatar().morph(from, to, avatarOpts(P));
  }));
  $('#tg-ghost').onclick = () => { ui.ghost = !ui.ghost; refreshDream(); };
  $('#tg-heat').onclick = () => { ui.heat = !ui.heat; refreshDream(); };
  $$('#kindseg button').forEach((b) => (b.onclick = () => { ui.kind = b.dataset.v; renderSliders(); refreshDream(); }));
  $$('.presets button').forEach((b) => (b.onclick = () => {
    const from = ui.view === 'now' ? nowSpec() : dreamSpec();
    const p = PRESETS[b.dataset.p];
    S.intent = p ? { mus: { ...p.mus }, fat: { ...p.fat } } : { mus: {}, fat: {} };
    save(); ui.view = 'dream'; renderSliders(); refreshDream();
    getAvatar().morph(from, dreamSpec(), avatarOpts());
  }));
  $('#rescan').onclick = () => { if (confirm('Rescan sets a new baseline for your avatar and progress tracking. Continue?')) onboard('scan'); };
}

function avatarOpts(P = plan()) {
  const heat = ui.heat ? (ui.kind === 'mus' ? P.musEff : P.fatEff) : null;
  return { heat, ghost: ui.ghost && ui.view === 'dream' ? nowSpec() : null };
}
function syncDreamUi() {
  $$('#viewseg button').forEach((b) => b.classList.toggle('on', b.dataset.v === ui.view));
  $('#tg-ghost').classList.toggle('on', ui.ghost);
  $('#tg-heat').classList.toggle('on', ui.heat);
  $('#legend').hidden = !ui.heat;
  $$('#kindseg button').forEach((b) => b.classList.toggle('on', b.dataset.v === ui.kind));
  $('#kindnote').innerHTML = ui.kind === 'mus'
    ? 'Each area is capped at a realistic <b>8–12%</b> natural change. Muscles that work together grow together, so linked areas move too.'
    : 'Fat can\'t be spot-reduced: about <b>65%</b> of any change spreads across your whole body, with a mild bias to the area you pick.';
}
function refreshDream() {
  const P = plan();
  syncDreamUi();
  getAvatar().set(ui.view === 'now' ? nowSpec() : dreamSpec(P), avatarOpts(P));
  const kg = (x) => S.profile.units === 'imperial' ? `${Math.round(x * 2.2046)} lb` : `${x.toFixed(1)} kg`;
  $('#stats').innerHTML = `
    <div><span>Body fat</span><b>${P.bf.toFixed(0)}% → ${P.targetBF.toFixed(0)}%</b></div>
    <div><span>Weight</span><b>${kg(P.weight)} → ${kg(P.targetWeight)}</b></div>
    <div><span>Phase</span><b>${P.phase}</b></div>
    <div><span>Est. time</span><b>~${P.weeks} wks</b></div>
    ${P.bfFloorHit ? `<p class="warn">Body fat floored at a sustainable ${P.targetBF.toFixed(0)}%. Going leaner isn't healthy to maintain.</p>` : ''}`;
  updateSliderLabels(P);
}

function renderSliders() {
  const kind = ui.kind;
  const intent = S.intent[kind];
  $('#sliders').innerHTML = REGIONS.map((r) => {
    const cap = kind === 'mus' ? MUSCLE_CAP[r.id] : FAT_CAP;
    return `<div class="slider" data-r="${r.id}">
      <div class="sl-h"><b>${r.name}</b><span class="val"></span></div>
      <div class="sl-track"><input type="range" min="${-cap}" max="${cap}" step="0.5" value="${intent[r.id] || 0}"><i class="eff"></i></div>
      <small class="sub"></small>
    </div>`;
  }).join('');
  let raf;
  $$('#sliders .slider').forEach((el) => {
    const inp = $('input', el);
    inp.oninput = () => {
      S.intent[kind][el.dataset.r] = +inp.value;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { ui.view = 'dream'; refreshDream(); });
    };
    inp.onchange = save;
  });
  updateSliderLabels(plan());
}

function updateSliderLabels(P) {
  const kind = ui.kind;
  const eff = kind === 'mus' ? P.musEff : P.fatEff;
  $$('#sliders .slider').forEach((el) => {
    const r = el.dataset.r, you = S.intent[kind][r] || 0, e = eff[r];
    const cap = kind === 'mus' ? MUSCLE_CAP[r] : FAT_CAP;
    $('.val', el).textContent = sgn(e);
    $('.val', el).className = `val ${e > 0.05 ? 'up' : e < -0.05 ? 'down' : ''}`;
    const linked = e - you;
    $('.sub', el).textContent = Math.abs(linked) > 0.05
      ? kind === 'mus' ? `you ${sgn(you)} · linked muscles ${sgn(linked)}${Math.abs(e) >= cap ? ' · at natural limit' : ''}` : `you ${sgn(you)} · whole-body spread ${sgn(linked)}`
      : Math.abs(e) >= cap ? 'at natural limit' : '';
    const left = 50 + (Math.min(0, e) / cap) * 50, w = (Math.abs(e) / cap) * 50;
    const bar = $('.eff', el); bar.style.left = `${left}%`; bar.style.width = `${w}%`;
    bar.className = `eff ${e < 0 ? 'neg' : ''}`;
  });
}

// ---------------------------------------------------------------- LEARN
function renderLearn(v) {
  const units = buildPath(plan());
  const all = units.flatMap((u) => u.lessons);
  const current = all.find((l) => !S.lessons.includes(l.id));
  const offs = [0, 46, 70, 46, 0, -46, -70, -46];
  let i = 0;
  v.innerHTML = `<div class="learn">${units.map((u) => `
    <div class="unit-banner" style="--c:${u.color}"><b>${u.title}</b><span>${u.lessons.filter((l) => S.lessons.includes(l.id)).length}/${u.lessons.length} lessons</span></div>
    <div class="path">${u.lessons.map((l) => {
      const state = S.lessons.includes(l.id) ? 'done' : l === current ? 'current' : 'locked';
      return `<div class="node-wrap" style="transform:translateX(${offs[i++ % offs.length]}px)">
        ${state === 'current' ? '<div class="start-bubble">START</div>' : ''}
        <button class="node ${state}" style="--c:${u.color}" data-id="${l.id}" ${state === 'locked' ? 'disabled' : ''}>${state === 'done' ? '✓' : l.icon}</button>
        <small>${l.title}</small></div>`;
    }).join('')}</div>`).join('')}
    ${!current ? '<div class="card center"><div class="big-emoji">🏆</div><h3>Path complete!</h3><p class="muted">Change your dream physique to unlock new lessons.</p></div>' : ''}
  </div>`;
  $$('.node:not([disabled])', v).forEach((b) => (b.onclick = () => runLesson(all.find((l) => l.id === b.dataset.id))));
  $('.node.current', v)?.scrollIntoView({ block: 'center' });
}

function runLesson(lesson) {
  const queue = [...lesson.cards];
  const total = queue.length;
  let doneCount = 0, picked = null;
  const m = openModal('', 'lesson');
  const draw = () => {
    const c = queue[0];
    if (!c) return finish();
    const bar = `<div class="lesson-top"><button class="x" id="x">✕</button><div class="bar"><i style="width:${(doneCount / total) * 100}%"></i></div></div>`;
    if (c.type === 'info') {
      $('.sheet-modal', m).innerHTML = `${bar}<div class="lesson-body"><div class="big-emoji">${lesson.icon}</div><h2>${c.title}</h2><p>${c.body}</p></div><button class="btn primary big" id="next">Continue</button>`;
      $('#next', m).onclick = () => { queue.shift(); doneCount++; draw(); };
    } else {
      picked = null;
      $('.sheet-modal', m).innerHTML = `${bar}<div class="lesson-body"><div class="eyebrow">Quick check</div><h2>${c.q}</h2>
        <div class="opts">${c.options.map((o, i) => `<button class="opt" data-i="${i}">${o}</button>`).join('')}</div></div>
        <div class="feedback" id="fb" hidden></div>
        <button class="btn primary big" id="check" disabled>Check</button>`;
      $$('.opt', m).forEach((b) => (b.onclick = () => { picked = +b.dataset.i; $$('.opt', m).forEach((x) => x.classList.toggle('sel', x === b)); $('#check', m).disabled = false; }));
      $('#check', m).onclick = () => {
        const ok = picked === c.answer;
        $$('.opt', m).forEach((x) => { x.disabled = true; if (+x.dataset.i === c.answer) x.classList.add('right'); else if (+x.dataset.i === picked) x.classList.add('wrong'); });
        const fb = $('#fb', m); fb.hidden = false; fb.className = `feedback ${ok ? 'ok' : 'bad'}`;
        fb.innerHTML = `<b>${ok ? 'Nice!' : 'Not quite'}</b><p>${c.why}</p>`;
        const btn = $('#check', m); btn.textContent = 'Continue'; btn.className = `btn big ${ok ? 'primary' : 'danger'}`;
        btn.onclick = () => { const q = queue.shift(); if (ok) doneCount++; else queue.push(q); draw(); };
      };
    }
    $('#x', m).onclick = closeModal;
  };
  const finish = () => {
    if (!S.lessons.includes(lesson.id)) { S.lessons.push(lesson.id); S.xp += 15; save(); }
    $('.sheet-modal', m).innerHTML = `<div class="lesson-body center"><div class="big-emoji pop">🎓</div><h2>Lesson complete!</h2><p class="xp-earn">+15 XP</p></div><button class="btn primary big" id="ok">Continue</button>`;
    burst(['⭐', '💎', '🎓']);
    $('#ok', m).onclick = () => { closeModal(); showMain('learn'); };
  };
  draw();
}

// ---------------------------------------------------------------- EAT
function renderEat(v) {
  const P = plan(), M = P.macros, p = S.profile;
  const meals = [
    ['Breakfast', 0.25, 'Greek yoghurt or eggs, oats, berries'],
    ['Lunch', 0.3, 'Chicken, tofu or fish · rice or potatoes · big salad'],
    ['Snack', 0.15, 'Whey or soy shake · fruit · handful of nuts'],
    ['Dinner', 0.3, 'Lean beef, salmon or lentils · wholegrain carb · veg'],
  ];
  const rules = {
    Cut: ['Fill half your plate with vegetables for volume', 'Protein at every meal keeps you full and protects muscle', 'Weigh yourself daily and track the weekly average', 'Keep 1–2 flexible meals a week so it\'s sustainable'],
    'Cut → Lean bulk': ['Cut first: lose fat to around your target body fat', 'Then add ~200 kcal/day and keep protein high', 'Weekly average weight is the only number that matters', 'Switch phases on trend, not on a single day'],
    Recomp: ['Stay close to maintenance; the scale may barely move', 'Protein high every day, even on rest days', 'Progress shows in photos and lifts before the scale', 'Most carbs around your workouts'],
    'Lean bulk': ['Aim for +0.25–0.5% bodyweight per week', 'Add calories with easy carbs: rice, oats, bagels', 'If waist grows fast, trim 100–150 kcal', 'Progressive overload turns those calories into muscle'],
    Maintain: ['Eat at maintenance and train for performance', 'Protein ~1.8 g/kg', 'Track weight weekly to stay in range', 'Prioritise sleep and food quality'],
  }[P.phase];
  const tot = M.protein * 4 + M.carbs * 4 + M.fat * 9;
  v.innerHTML = `
    <section class="card eat-hero">
      <div class="eyebrow">${P.phase} · ${M.adj === 0 ? 'maintenance' : `${M.adj > 0 ? '+' : '−'}${Math.round(Math.abs(M.adj) * 100)}% vs maintenance (${M.tdee})`}</div>
      <div class="kcal"><b>${M.kcal}</b><span>kcal / day</span></div>
      <div class="macro-bar"><i class="p" style="flex:${M.protein * 4 / tot}"></i><i class="c" style="flex:${M.carbs * 4 / tot}"></i><i class="f" style="flex:${M.fat * 9 / tot}"></i></div>
      <div class="macros">
        <div><i class="p"></i><b>${M.protein} g</b><span>Protein</span></div>
        <div><i class="c"></i><b>${M.carbs} g</b><span>Carbs</span></div>
        <div><i class="f"></i><b>${M.fat} g</b><span>Fat</span></div>
      </div>
    </section>
    <section class="card"><h3>A day that hits your numbers</h3>
      <ul class="meals">${meals.map(([n, k, food]) => `<li><div><b>${n}</b><small>${food}</small></div><span>${Math.round(M.kcal * k)} kcal<br><em>${Math.round(M.protein * k)} g protein</em></span></li>`).join('')}</ul>
    </section>
    <section class="card"><h3>Your ${P.phase.toLowerCase()} rules</h3>
      <ol class="rules">${rules.map((r) => `<li>${r}</li>`).join('')}</ol>
      <p class="muted small">💧 Water: ~${(p.weightKg * 0.035).toFixed(1)} L/day · 🧂 Creatine 3–5 g/day is the best-supported supplement.</p>
    </section>
    <p class="muted small center pad">Estimates from Mifflin-St Jeor and your activity level. Not medical advice. Adjust based on your weekly weight trend.</p>`;
}

// ---------------------------------------------------------------- PROGRESS
function renderProgress(v) {
  const P = plan();
  const pr = progressNow(P);
  const frames = [{ date: S.baseline.date, photo: S.baseline.photo, label: 'Day 1' }, ...S.checkins.filter((c) => c.photo).map((c, i) => ({ date: c.date, photo: c.photo, label: c.date }))];
  const series = S.checkins.map((c, i) => progressNow(P, i + 1).overall);
  const change = measuredRegionChange(S.baseline.metrics, pr.current);
  const targetChange = measuredRegionChange(S.baseline.metrics, P.target);
  const latest = frames[frames.length - 1];

  v.innerHTML = `
    <section class="card prog-hero">
      <div class="eyebrow">Dream physique</div>
      <div class="big-pct">${pct(pr.overall)}</div>
      <div class="bar big"><i style="width:${pct(pr.overall)}"></i></div>
      <p class="muted small">${S.checkins.length ? `Measured from your last ${Math.min(3, recentMetrics().length)} photos vs. your scan · ${S.checkins.length} check-ins · best streak ${S.streak.best}` : 'Check in with a photo to start measuring progress.'}</p>
      ${series.length > 1 ? sparkline(series) : ''}
    </section>

    <section class="card">
      <div class="card-h"><h3>Your transformation</h3><button class="btn mini" id="play">▶ Play</button></div>
      <p class="muted small">Every check-in photo, auto-aligned and woven together. Scrub to see yourself change.</p>
      <div class="weave" id="weave">${frames.map((f, i) => `<img src="${f.photo}" data-i="${i}" alt="${f.label}">`).join('')}<div class="weave-date" id="wdate"></div></div>
      <input type="range" id="scrub" min="0" max="${frames.length - 1}" step="0.01" value="${frames.length - 1}" ${frames.length < 2 ? 'disabled' : ''}>
    </section>

    ${frames.length > 1 ? `<section class="card">
      <h3>Day 1 vs now</h3>
      <div class="wipe" id="wipe"><img src="${latest.photo}" alt="Latest"><div class="wipe-top"><img src="${frames[0].photo}" alt="Day 1"></div><div class="wipe-handle"></div>
        <span class="tag l">Day 1</span><span class="tag r">${latest.date}</span></div>
    </section>` : ''}

    <section class="card">
      <h3>Where you've changed</h3>
      <div class="stage small" id="pstage"><div class="legend"><span class="dn">Shrank</span><i></i><span class="up">Grew</span></div></div>
      <div class="change-list">${REGION_IDS.map((r) => {
        const target = targetChange[r];
        return `<div class="chg"><span>${REGION_NAME[r]}</span>
          <div class="chg-bar"><i class="t" style="${barStyle(target)}"></i><i class="m ${change[r] < 0 ? 'neg' : ''}" style="${barStyle(change[r])}"></i></div>
          <b class="${change[r] > 0.2 ? 'up' : change[r] < -0.2 ? 'down' : ''}">${pr.current ? sgn(change[r]) : '–'}</b></div>`;
      }).join('')}</div>
      <p class="muted small">Solid bar = measured change. Outline = your dream target. Single photos vary ±1–2%, so trends matter more than any one day.</p>
    </section>

    <section class="card demo">
      <h3>Demo tools</h3>
      <p class="muted small">Try the app without two weeks of photos.</p>
      <button class="btn" id="sim14">Simulate 14 days of check-ins</button>
      <button class="btn ghost danger-t" id="reset">Delete this user</button>
    </section>`;

  // weave player
  const imgs = $$('#weave img', v);
  const scrub = $('#scrub', v);
  const wdate = $('#wdate', v);
  const show = (s) => { imgs.forEach((im, i) => (im.style.opacity = clamp(1 - Math.abs(s - i), 0, 1))); const f = frames[Math.round(s)]; wdate.textContent = `${f.label}${Math.round(s) ? ` · day ${Math.round(s) + 1}` : ''}`; };
  show(+scrub.value);
  scrub.oninput = () => show(+scrub.value);
  let playing;
  $('#play', v).onclick = () => {
    if (frames.length < 2) return toast('Check in a few times to build your timelapse.');
    cancelAnimationFrame(playing);
    const t0 = performance.now(), dur = Math.max(2000, frames.length * 450);
    const step = (now) => {
      if (!scrub.isConnected) return; // left the tab or re-rendered mid-play
      const s = Math.min(1, (now - t0) / dur) * (frames.length - 1);
      scrub.value = s; show(s);
      if (s < frames.length - 1) playing = requestAnimationFrame(step);
    };
    playing = requestAnimationFrame(step);
  };

  // wipe compare
  const wipe = $('#wipe', v);
  if (wipe) {
    const set = (x) => { const r = wipe.getBoundingClientRect(); const k = clamp((x - r.left) / r.width, 0, 1); $('.wipe-top', wipe).style.clipPath = `inset(0 ${100 - k * 100}% 0 0)`; $('.wipe-handle', wipe).style.left = `${k * 100}%`; };
    let drag = false;
    wipe.onpointerdown = (e) => { drag = true; wipe.setPointerCapture(e.pointerId); set(e.clientX); };
    wipe.onpointermove = (e) => drag && set(e.clientX);
    wipe.onpointerup = () => (drag = false);
    requestAnimationFrame(() => { const r = wipe.getBoundingClientRect(); set(r.left + r.width / 2); });
  }

  const av = getAvatar();
  av.mount($('#pstage', v));
  av.set(currentSpec(P), { heat: change, ghost: null });

  $('#sim14', v).onclick = simulate14;
  $('#reset', v).onclick = () => { if (confirm(`Delete ${currentUser().name}'s scan, dream physique, photos and streak? This can't be undone.`)) deleteUser(U.current); };
}

function barStyle(val, cap = 12) {
  const left = 50 + (Math.min(0, val) / cap) * 50, w = (Math.min(Math.abs(val), cap) / cap) * 50;
  return `left:${left}%;width:${w}%`;
}

function sparkline(series) {
  const w = 300, h = 60, n = series.length;
  const pts = series.map((y, i) => `${(i / (n - 1)) * w},${h - 4 - y * (h - 8)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" /></svg>`;
}

function simulate14() {
  const today = localDate();
  const keepToday = S.checkins.filter((c) => c.date === today);
  S.checkins = [];
  let p = 0;
  for (let d = 14; d >= 1; d--) {
    const r = simulatePhoto(p);
    p = r.p;
    S.checkins.push({ date: addDays(today, -d), photo: r.photo, metrics: r.metrics, workout: 'Simulated' });
  }
  S.checkins.push(...keepToday);
  S.streak = { count: 14 + keepToday.length, last: keepToday.length ? today : addDays(today, -1), best: Math.max(S.streak.best, 14 + keepToday.length) };
  S.workoutsDone += 14;
  S.xp += 14 * 30;
  save();
  showMain('progress');
  toast('Simulated 14 days. Check in today to keep the streak!');
}

// ---------------------------------------------------------------- boot
window.achievatarBooted = true;
function switchUser(id) {
  U.current = id; saveUsers();
  S = loadState(id);
  tab = 'today';
  Object.assign(ui, { view: 'dream', ghost: true, heat: false, kind: 'mus' });
  closeModal();
  if (S.profile && S.baseline) showMain('today');
  else onboard(S.profile ? 'scan' : 'welcome');
}
function deleteUser(id) {
  try { localStorage.removeItem(userKey(id)); } catch {}
  U.list = U.list.filter((u) => u.id !== id);
  if (U.current === id) U.current = null;
  saveUsers();
  onboard('users');
}

// "Who's training?" screen: pick a profile, add one, or remove one.
function obUsers(el, { manage = false, adding = false } = {}) {
  const cards = U.list.map((u) => {
    const st = loadState(u.id);
    const alive = st.streak.last === localDate() || st.streak.last === addDays(localDate(), -1) ? st.streak.count : 0;
    const sub = st.baseline ? `🔥 ${alive} · 💎 ${st.xp}` : 'Not scanned yet';
    return `<div class="user-card">
      <button class="user-pick" data-id="${u.id}"><span class="user-av" style="background:${u.color}">${esc(u.name.trim()[0]?.toUpperCase() || '?')}</span>
        <b>${esc(u.name)}</b><small>${sub}</small></button>
      ${manage ? `<button class="user-del" data-id="${u.id}" aria-label="Delete ${esc(u.name)}">✕</button>` : ''}
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="ob-hero small-hero">
      <div class="logo">ACHIEVATAR</div>
      <h1>${U.list.length ? 'Who\'s training?' : 'Become your own creation'}</h1>
      <p class="muted">${U.list.length ? 'Pick your profile, or add someone new.' : 'Create a profile to start your first body scan.'}</p>
    </div>
    <div class="user-grid">${cards}
      <div class="user-card"><button class="user-pick add" id="add"><span class="user-av">＋</span><b>New user</b><small>Start a fresh scan</small></button></div>
    </div>
    <form id="newuser" class="form" ${adding || !U.list.length ? '' : 'hidden'}>
      <label>Name <input name="name" maxlength="24" placeholder="e.g. Jonny" autocomplete="off" required></label>
      <button class="btn primary big">Create profile</button>
    </form>
    ${manage ? '<p class="muted small center">Tap a profile to rename it, or ✕ to delete it.</p>' : ''}
    ${U.list.length ? `<button class="btn ghost" id="manage">${manage ? 'Done' : 'Manage profiles'}</button>` : ''}
    <p class="muted small center">Profiles and photos are saved only in this browser on this device.</p>`;
  $$('.user-pick[data-id]', el).forEach((b) => (b.onclick = () => {
    if (!manage) return switchUser(b.dataset.id);
    const u = U.list.find((x) => x.id === b.dataset.id);
    const name = prompt('Rename profile', u.name)?.trim().slice(0, 24);
    if (name) { u.name = name; saveUsers(); obUsers(el, { manage: true }); }
  }));
  $$('.user-del', el).forEach((b) => (b.onclick = () => {
    const u = U.list.find((x) => x.id === b.dataset.id);
    if (confirm(`Delete ${u.name}'s profile, photos and progress? This can't be undone.`)) { deleteUser(u.id); onboard('users', { manage: true }); }
  }));
  $('#add', el).onclick = () => { const f = $('#newuser', el); f.hidden = false; $('input', f).focus(); };
  $('#manage', el) && ($('#manage', el).onclick = () => obUsers(el, { manage: !manage }));
  $('#newuser', el).onsubmit = (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (!name) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    U.list.push({ id, name, color: COLORS[U.list.length % COLORS.length] });
    saveUsers();
    switchUser(id);
  };
  if (!U.list.length) $('#newuser input', el).focus();
}

$('#tb-me').onclick = () => onboard('users');
onboard('users');

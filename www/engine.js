/* FitCoach engine: JS port of fitcoach.py. Data lives in localStorage. */
const LS = 'fitcoach.v1';
const EQUIP = { none: ['none'], dumbbell: ['none', 'dumbbell'], gym: ['none', 'dumbbell', 'gym'] };
const SCHED = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5] };
const AREA_IDS = ['knee', 'back', 'shoulder', 'wrist'];
const EX = DATA.LIB.map(e => ({ name: e[0], slot: e[1], tier: e[2], equip: e[3], avoid: e[4], unit: e[5], base: e[6] }));

/* ---- dates (window.__TODAY lets tests pin the day) ---- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const T = () => (window.__TODAY ? new Date(window.__TODAY + 'T12:00:00') : new Date());
const parseD = s => new Date(s + 'T12:00:00');
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const weekday = d => (d.getDay() + 6) % 7; // Monday = 0
const pyRound = x => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---- storage ---- */
const fresh = () => ({ profile: null, state: null, weights: {}, checkins: [], settings: { aiHost: '', model: 'llama3.2:3b' } });
function loadDB() { try { return JSON.parse(localStorage.getItem(LS)) || fresh(); } catch (e) { return fresh(); } }
function saveDB(d) { localStorage.setItem(LS, JSON.stringify(d)); }
const getState = d => d.state || { vol: 1.0, tier: 0, avoid: {}, rest_on: null, n: 0 };
const sortedW = d => Object.keys(d.weights).sort().map(k => [k, d.weights[k]]);
const lastW = d => { const w = sortedW(d); return w.length ? w[w.length - 1][1] : null; };
const setW = (d, kg, day) => { d.weights[day || iso(T())] = kg; };

/* ---- maths ---- */
const bmi = (kg, h) => kg / (h / 100) ** 2;
const reached = (p, kg) => { const b = bmi(kg, p.height); return p.dir === 0 || (p.dir < 0 && b <= p.tbmi) || (p.dir > 0 && b >= p.tbmi); };
function kcal(p, kg) {
  const bmr = 10 * kg + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const tdee = bmr * (1.2 + 0.075 * p.days);
  const delta = reached(p, kg) ? 0 : p.dir < 0 ? -Math.min(500, 0.005 * kg * 1100) : 300;
  return Math.trunc(Math.max(p.sex === 'm' ? 1500 : 1200, tdee + delta));
}
function trend(d) {
  const cut = iso(addDays(T(), -28));
  const rows = sortedW(d).filter(r => r[0] >= cut);
  if (rows.length < 4) return null;
  const t0 = parseD(rows[0][0]);
  const xs = rows.map(r => Math.round((parseD(r[0]) - t0) / 864e5)), ys = rows.map(r => r[1]);
  if (xs[xs.length - 1] < 10) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : null; // kg/day
}

/* ---- adaptation ---- */
function adapt(s, rpe, sore, energy, sleep, pain, ill) {
  let v = s.vol, t = s.tier;
  if (pain >= 2 || ill) v *= 0.7;
  else if (sore >= 4 || energy <= 2 || sleep < 5.5 || rpe >= 9) v *= 0.85;
  else if (rpe <= 5 && sore <= 2 && energy >= 3) v *= 1.08;
  else if (rpe <= 7 && sore <= 3 && energy >= 3) v *= 1.02;
  v = Math.max(0.5, Math.min(1.5, v));
  if (v >= 1.3 && t < 3) { t += 1; v = 1.0; }
  else if (v <= 0.6 && t > 0) { t -= 1; v = 0.9; }
  s.vol = Math.round(v * 1000) / 1000; s.tier = t;
}
function pick(slot, tier, equip, avoid, n) {
  const cands = EX.filter(e => e.slot === slot && EQUIP[equip].includes(e.equip) && !e.avoid.some(a => avoid.has(a)));
  let ok = cands.filter(e => e.tier <= tier);
  if (!ok.length) ok = [cands.reduce((a, b) => (b.tier < a.tier ? b : a))];
  const mine = ok.filter(e => e.equip === equip);
  if (mine.length) ok = mine;
  const top = Math.max(...ok.map(e => e.tier));
  const pool = ok.filter(e => e.tier === top);
  return pool[n % pool.length];
}
function rx(e, v) {
  if (e.unit === 'min') return `${clamp(pyRound(e.base * v), 10, 60)} min, easy pace (full sentences possible)`;
  const sets = clamp(pyRound(3 * v), 1, 5);
  return `${sets} x ${pyRound(e.base * clamp(v, 0.8, 1.25))} ${e.unit}`;
}
function imgUrls(name) {
  const m = DATA.IMG[name];
  return m ? [[0, 1].map(k => `img/${m[0]}_${k}.jpg`), m[1]] : [null, null];
}
function item(e, v, slot) {
  const [st, mu, cu] = DATA.CUES[e.name] || ['', '', ''];
  const [im, q] = imgUrls(e.name);
  return { slot, name: e.name, rx: rx(e, v), equip: e.equip, station: st, muscles: mu, cue: cu, img: im, img_q: q };
}
function activeAvoid(p, s, today) {
  const a = new Set(p.limits);
  Object.entries(s.avoid).forEach(([k, u]) => { if (u >= iso(today)) a.add(k); });
  return a;
}
function buildPlan(d, force) {
  const p = d.profile, s = getState(d), today = T(), td = iso(today);
  const kg = lastW(d) ?? p.weight, avoid = activeAvoid(p, s, today);
  const rest = !!s.rest_on && td <= s.rest_on;
  const plan = { date: td, vol: s.vol, tier: s.tier, avoid: [...avoid].sort(), kcal: kcal(p, kg), recovery: false, items: [], warmup: '', cooldown: '', done: d.checkins.some(c => c.d === td) };
  if (rest || (!SCHED[p.days].includes(weekday(today)) && !force)) {
    plan.recovery = true;
    plan.reason = rest ? 'Pain or illness flagged, rest on.' : 'Scheduled rest day.';
    plan.items = [
      { slot: 'recovery', name: 'Easy walk', rx: '20 min', equip: 'none', station: 'Outdoors or treadmill', muscles: 'Whole body', cue: 'Conversational pace.' },
      { slot: 'recovery', name: 'Mobility flow', rx: '5 min', equip: 'none', station: 'Mat', muscles: 'Hips, spine, shoulders', cue: 'Gentle range, no pain.' }];
    return plan;
  }
  const order = s.n % 2 === 0 ? ['squat', 'push', 'pull', 'core'] : ['hinge', 'push', 'pull', 'core'];
  order.concat(['cardio']).forEach(slot => plan.items.push(item(pick(slot, s.tier, p.equip, avoid, s.n), s.vol, slot)));
  plan.warmup = '5 min: march, hip circles, arm circles, 5 easy reps of the first move.';
  plan.cooldown = '3 min stretch. Stop any move that causes sharp pain.';
  return plan;
}

/* ---- optional local AI (Ollama on your PC or LAN) ---- */
async function llm(d, prompt, js) {
  const h = (d.settings.aiHost || '').replace(/\/$/, '');
  if (!h) return null;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
  try {
    const body = { model: d.settings.model || 'llama3.2:3b', prompt, stream: false, options: { temperature: 0.2 } };
    if (js) body.format = 'json';
    const r = await fetch(h + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    return ((await r.json()).response || '').trim();
  } catch (e) { return null; } finally { clearTimeout(t); }
}
async function aiFlags(d, note) {
  const out = { area: null, ill: false };
  const r = await llm(d, 'Return JSON only: {"pain_area":"knee|back|shoulder|wrist|none","illness":true|false} for this workout note: "' + note + '"', true);
  try { const j = JSON.parse(r), a = String(j.pain_area || 'none').toLowerCase(); out.area = AREA_IDS.includes(a) ? a : null; out.ill = j.illness === true; } catch (e) {}
  return out;
}

/* ---- check-in ---- */
async function applyCheckin(d, x, ai) {
  const p = d.profile, s = getState(d), today = T(), td = iso(today);
  if (d.checkins.some(c => c.d === td)) throw new Error('Already checked in today.');
  const done = x.done !== false;
  const rpe = done ? clamp(parseInt(x.rpe ?? 6, 10), 1, 10) : 6;
  const sore = clamp(parseInt(x.sore, 10), 1, 5), energy = clamp(parseInt(x.energy, 10), 1, 5);
  const sleep = clamp(parseFloat(x.sleep), 0, 14);
  let pain = clamp(parseInt(x.pain ?? 0, 10), 0, 3);
  if ([sore, energy, sleep, pain, rpe].some(Number.isNaN)) throw new Error('Check your answers and try again.');
  let area = String(x.area || '').trim().toLowerCase() || null;
  const note = String(x.note || '').trim().slice(0, 300);
  let ill = false;
  if (ai && note) { const f = await aiFlags(d, note); area = area || f.area; ill = f.ill; pain = pain || (f.area ? 1 : 0); }
  if (x.weight !== undefined && x.weight !== '' && !Number.isNaN(parseFloat(x.weight))) setW(d, clamp(parseFloat(x.weight), 30, 300));
  adapt(s, rpe, sore, energy, sleep, pain, ill);
  if (AREA_IDS.includes(area) && pain) s.avoid[area] = iso(addDays(today, pain === 1 ? 7 : 14));
  if (pain >= 2 || ill) s.rest_on = iso(addDays(today, 1));
  if (done) s.n += 1;
  d.state = s;
  d.checkins.push({ d: td, done: done ? 1 : 0, rpe, sore, energy, sleep, pain, area, note, vol: s.vol, tier: s.tier });
  let msg = `Saved. Next session: intensity ${pyRound(s.vol * 100)}%, level ${s.tier + 1} of 4.`;
  if (pain >= 3) msg += ' Severe pain: see a clinician before training again.';
  else if (pain >= 2 || ill) msg += ' Tomorrow is recovery.';
  const kg = lastW(d), out = { msg, reached: reached(p, kg), coach: null };
  if (out.reached) out.msg += ` Target BMI reached (${bmi(kg, p.height).toFixed(1)}). Maintain within +/-1 kg.`;
  saveDB(d);
  if (ai) { out.coach = await llm(d, `Write 2 plain encouraging sentences, no medical advice. Facts: effort ${rpe}/10, soreness ${sore}/5, energy ${energy}/5, pain ${pain}/3, next load x${s.vol}.`); }
  return out;
}

/* ---- status, profile, library ---- */
function statusData(d) {
  const p = d.profile, rows = sortedW(d).slice(-90), kg = rows[rows.length - 1][1], h = p.height;
  const tk = p.tbmi * (h / 100) ** 2, sl = trend(d), isReached = reached(p, kg);
  let eta = null, note = '';
  if (isReached) note = 'Target reached. Maintain within +/-1 kg.';
  else if (sl === null) note = 'Log weight on 4+ days spanning 10+ days to get a trend.';
  else if (sl && (tk - kg) / sl > 0 && (tk - kg) / sl < 3650) eta = iso(addDays(T(), Math.trunc((tk - kg) / sl)));
  else note = 'Trend is not moving toward target: tighten intake or add a training day.';
  const cut = iso(addDays(T(), -14));
  const hist = d.checkins.slice(-14).reverse().map(c => ({ d: c.d, done: c.done, rpe: c.rpe, sore: c.sore, energy: c.energy, sleep: c.sleep, pain: c.pain, area: c.area, vol: c.vol, tier: c.tier }));
  const s = getState(d);
  return { bmi: Math.round(bmi(kg, h) * 10) / 10, tbmi: p.tbmi, kg, tkg: Math.round(tk * 10) / 10, togo: Math.round((tk - kg) * 10) / 10,
    slope_week: sl === null ? null : Math.round(sl * 7 * 100) / 100, eta, note, reached: isReached,
    sessions14: d.checkins.filter(c => c.d >= cut && c.done).length, vol: s.vol, tier: s.tier,
    weights: rows.map(r => ({ d: r[0], kg: r[1] })), history: hist };
}
function saveProfile(d, x) {
  const p = { age: parseInt(x.age, 10), sex: x.sex, height: parseFloat(x.height), weight: parseFloat(x.weight), tbmi: parseFloat(x.tbmi),
    equip: x.equip, days: parseInt(x.days, 10), limits: (x.limits || []).filter(a => AREA_IDS.includes(a)) };
  if (!(p.age >= 18 && p.age <= 90 && ['m', 'f'].includes(p.sex) && p.height >= 120 && p.height <= 230 && p.weight >= 30 && p.weight <= 300 &&
        p.tbmi >= 18.5 && p.tbmi <= 24.9 && EQUIP[p.equip] && SCHED[p.days])) throw new Error('Check values: adults 18+, target BMI 18.5 to 24.9, 2 to 5 days/week.');
  const b = bmi(p.weight, p.height);
  p.dir = b > p.tbmi + 0.1 ? -1 : b < p.tbmi - 0.1 ? 1 : 0;
  d.profile = p;
  if (lastW(d) !== p.weight) setW(d, p.weight);
  if (!d.state) d.state = getState(d);
  d.settings = { aiHost: String(x.aiHost || '').trim(), model: String(x.model || 'llama3.2:3b').trim() || 'llama3.2:3b' };
  saveDB(d);
  return { ok: true };
}
function library() {
  return { gym: DATA.GYM, exercises: EX.map(e => { const [st, mu, cu] = DATA.CUES[e.name] || ['', '', '']; const [im, q] = imgUrls(e.name);
    return { name: e.name, slot: e.slot, tier: e.tier, equip: e.equip, avoid: e.avoid, station: st, muscles: mu, cue: cu, img: im, img_q: q }; }) };
}

/* ---- local "API" so the UI code stays the same ---- */
async function api(path, body) {
  const d = loadDB(), [route, query] = path.split('?');
  if (route === '/api/state') {
    if (!d.profile) return { profile: null, settings: d.settings };
    return { profile: d.profile, settings: d.settings, plan: buildPlan(d, query === 'force=1'), status: statusData(d) };
  }
  if (route === '/api/library') return library();
  if (route === '/api/profile') return saveProfile(d, body);
  if (!d.profile) throw new Error('Set up your profile first.');
  if (route === '/api/checkin') return applyCheckin(d, body, !!body.ai);
  if (route === '/api/weigh') { setW(d, clamp(parseFloat(body.kg), 30, 300)); saveDB(d); return { ok: true }; }
  throw new Error('Not found');
}

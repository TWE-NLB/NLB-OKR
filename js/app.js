import { DIRS, DIR_ORDER, fitCalibration, analyzeBlock, summarize, median, sd } from './analysis.js';
import { Tracker, Motion } from './tracker.js';
import { Stage } from './stage.js';
import * as store from './store.js';
import { traceChart, gainChart, asymChart, seriesColor, destroyAll } from './charts.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '–');
const signed = (v, d = 0) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + fmt(v, d) : '–');
const dateStr = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------- Konstanten ----------
const DEVICE_PRESETS = [
  { id: 'ipad', label: 'iPad / iPad Air / iPad Pro', ppi: 132 },
  { id: 'ipadmini', label: 'iPad mini', ppi: 163 },
  { id: 'iphone', label: 'iPhone (aktuelle Modelle)', ppi: 153 },
  { id: 'iphonese', label: 'iPhone SE / mini', ppi: 163 },
  { id: 'custom', label: 'Eigener Wert', ppi: null },
];
const PRE_SEC = 3;            // Pause mit Fixierkreuz vor jedem Block
const CAL_DWELL = 1.8;        // Sekunden pro Kalibrierpunkt
const CAL_SETTLE = 0.7;       // davon verworfen (Blicksprung)
const CAL_SEQ = [[0, 0], [-1, 0], [0, 0], [1, 0], [0, 0], [0, -1], [0, 0], [0, 1], [0, 0]];
const GYRO_LIMIT = 20;        // °/s Gerätedrehung → „Wackeln“
const FACE_SPEED_LIMIT = 1.0; // Augenabstände pro Sekunde im Kamerabild → „Wackeln“

// ---------- Zustand ----------
const state = {
  persons: [],
  measurements: [],
  selected: new Set(),
  personId: null,
  settings: loadSettings(),
  calib: null,
  run: null,
  view: 'home',
};
const motion = new Motion();
const video = $('#cam');
const tracker = new Tracker(video, motion);
const stage = new Stage($('#stage'));

function guessDevice() {
  const s = Math.min(screen.width, screen.height);
  if (s < 500) return 'iphone';
  if (s === 744) return 'ipadmini';
  return 'ipad';
}

function loadSettings() {
  const dev = guessDevice();
  const defaults = {
    mode: 'stand', distanceCm: 40, device: dev, ppi: DEVICE_PRESETS.find((p) => p.id === dev).ppi,
    dirs: { L: true, R: true, U: true, D: true }, speeds: '10, 20, 30', blockSec: 10, periodDeg: 4, order: 'speed',
  };
  try {
    const s = JSON.parse(localStorage.getItem('okr-settings') || 'null');
    return s ? { ...defaults, ...s, dirs: { ...defaults.dirs, ...s.dirs } } : defaults;
  } catch { return defaults; }
}
function saveSettings() {
  try { localStorage.setItem('okr-settings', JSON.stringify(state.settings)); } catch { /* privat */ }
}

const pxPerCm = () => state.settings.ppi / 2.54;
const parseSpeeds = (txt) => [...new Set(String(txt).split(/[;,\s]+/).map((x) => parseFloat(x.replace(',', '.'))).filter((x) => x > 0 && x <= 120))].sort((a, b) => a - b);

function buildPlan(s) {
  const speeds = parseSpeeds(s.speeds);
  const dirs = DIR_ORDER.filter((d) => s.dirs[d]);
  const plan = [];
  if (s.order === 'dir') for (const d of dirs) for (const v of speeds) plan.push({ dir: d, speed: v });
  else for (const v of speeds) for (const d of dirs) plan.push({ dir: d, speed: v });
  return plan;
}

// ---------- Hilfen ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function personName(id) { return state.persons.find((p) => p.id === id)?.name ?? '?'; }
function slug(s) { return String(s).normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 30) || 'Person'; }
function stamp(iso) { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }

function show(view) {
  state.view = view;
  for (const v of ['home', 'setup', 'check', 'result', 'compare']) $(`#v-${v}`).hidden = v !== view;
  $('#back').hidden = view === 'home';
  if (view !== 'check') placeCam(false);
  if (view === 'home') renderHome();
  window.scrollTo(0, 0);
  updateRotateHint();
}

function updateRotateHint() {
  const needsLandscape = state.view === 'check' || !$('#fs').hidden;
  $('#rotate').hidden = !(needsLandscape && window.innerHeight > window.innerWidth);
}
window.addEventListener('resize', () => { updateRotateHint(); if (state.view === 'check') placeCam(true); });

// Das Kamera-Element bleibt immer im DOM (sonst liefert iOS keine Bilder) und wird nur verschoben.
function placeCam(visible) {
  if (!visible) { video.className = 'cam-off'; video.removeAttribute('style'); return; }
  const r = $('#cam-box').getBoundingClientRect();
  video.className = '';
  Object.assign(video.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '10px', position: 'absolute' });
  video.style.top = `${r.top + window.scrollY}px`;
}

// ---------- Übersicht ----------
function renderHome() {
  const pl = $('#person-list');
  const counts = {};
  for (const m of state.measurements) counts[m.personId] = (counts[m.personId] || 0) + 1;
  const persons = [...state.persons].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  pl.innerHTML = persons.length ? persons.map((p) => `
    <li>
      <div class="grow"><div class="title">${esc(p.name)}</div><div class="sub">${counts[p.id] || 0} Messung(en)</div></div>
      <button class="btn primary" data-measure="${p.id}">Messen</button>
    </li>`).join('') : '<li class="empty">Noch keine Person angelegt.</li>';

  const ml = $('#measure-list');
  const ms = [...state.measurements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  ml.innerHTML = ms.length ? ms.map((m) => {
    const s = m.summary;
    const q = s.validBlocks === s.totalBlocks ? 'good' : s.validBlocks >= s.totalBlocks / 2 ? 'warn' : 'bad';
    return `
    <li>
      <input type="checkbox" data-select="${m.id}" aria-label="Für Vergleich auswählen" ${state.selected.has(m.id) ? 'checked' : ''}>
      <button class="link grow" data-open="${m.id}">
        <div class="title">${esc(m.personName)} <span class="sub">· ${dateStr(m.createdAt)}</span></div>
        <div class="sub mono">Gain H ${fmt(s.gainH)} · V ${fmt(s.gainV)} · ${m.settings.mode === 'hand' ? 'in der Hand' : 'Ständer'}</div>
      </button>
      <span class="pill ${q}">${s.validBlocks}/${s.totalBlocks} Blöcke</span>
    </li>`;
  }).join('') : '<li class="empty">Noch keine Messungen. Person anlegen und „Messen“ tippen, oder Dateien importieren.</li>';

  const n = state.selected.size;
  $('#compare-btn').disabled = n < 2;
  $('#compare-btn').textContent = n ? `Vergleichen (${n})` : 'Vergleichen';
  $('#compare-hint').hidden = n >= 2;
  $('#topmeta').textContent = '';
}

$('#person-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#person-name').value.trim();
  if (!name) return;
  if (state.persons.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast(`„${name}“ gibt es schon.`); return; }
  const p = { id: store.uid(), name, createdAt: new Date().toISOString() };
  await store.put('persons', p);
  state.persons.push(p);
  $('#person-name').value = '';
  renderHome();
});

$('#person-list').addEventListener('click', (e) => {
  const id = e.target.closest('[data-measure]')?.dataset.measure;
  if (id) openSetup(id);
});

$('#measure-list').addEventListener('change', (e) => {
  const id = e.target.dataset.select;
  if (!id) return;
  if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
  renderHome();
});
$('#measure-list').addEventListener('click', (e) => {
  const id = e.target.closest('[data-open]')?.dataset.open;
  if (id) showResult(state.measurements.find((m) => m.id === id));
});

$('#compare-btn').addEventListener('click', () => showCompare());
$('#back').addEventListener('click', () => { stopTracking(); show('home'); });

$('#export-all').addEventListener('click', () => {
  if (!state.measurements.length) { toast('Es gibt noch keine Messungen.'); return; }
  const bundle = { format: 'nlb-okr-bundle', version: 1, exportedAt: new Date().toISOString(), persons: state.persons, measurements: state.measurements };
  const now = new Date().toISOString();
  store.offerFiles([
    { name: `OKR_Alle_${stamp(now)}.json`, type: 'application/json', text: JSON.stringify(bundle) },
    { name: `OKR_Alle_${stamp(now)}.csv`, type: 'text/csv', text: csvFor(state.measurements) },
  ]).then((r) => r !== 'aborted' && toast('Export bereitgestellt.'));
});

$('#import-file').addEventListener('change', async (e) => {
  let added = 0, skipped = 0;
  for (const file of e.target.files) {
    try {
      const data = JSON.parse(await store.readFile(file));
      const list = data.format === 'nlb-okr-bundle' ? data.measurements : data.format === 'nlb-okr-measurement' ? [data] : [];
      const persons = data.format === 'nlb-okr-bundle' ? data.persons : [];
      for (const p of persons) {
        if (!state.persons.some((x) => x.id === p.id)) { await store.put('persons', p); state.persons.push(p); }
      }
      for (const m of list) {
        if (state.measurements.some((x) => x.id === m.id)) { skipped++; continue; }
        if (!state.persons.some((x) => x.id === m.personId)) {
          const p = { id: m.personId, name: m.personName, createdAt: m.createdAt };
          await store.put('persons', p); state.persons.push(p);
        }
        await store.put('measurements', m); state.measurements.push(m); added++;
      }
    } catch (err) {
      console.error(err);
      toast(`„${file.name}“ ist keine OKR-Datei.`);
    }
  }
  e.target.value = '';
  renderHome();
  if (added || skipped) toast(`${added} Messung(en) importiert${skipped ? `, ${skipped} schon vorhanden` : ''}.`);
});

// ---------- Einstellungen ----------
function openSetup(personId) {
  state.personId = personId;
  $('#setup-person').textContent = personName(personId);
  const s = state.settings;
  $(`#mode-${s.mode}`).checked = true;
  $('#distance').value = s.distanceCm;
  $('#device').innerHTML = DEVICE_PRESETS.map((p) => `<option value="${p.id}">${p.label}${p.ppi ? ` (${p.ppi})` : ''}</option>`).join('');
  $('#device').value = s.device;
  $('#ppi').value = s.ppi;
  $('#ppi-field').hidden = s.device !== 'custom';
  for (const d of DIR_ORDER) $(`#dir-${d}`).checked = !!s.dirs[d];
  $('#speeds').value = s.speeds;
  $('#block-sec').value = s.blockSec;
  $('#period').value = s.periodDeg;
  $('#order').value = s.order;
  $('#setup-error').hidden = true;
  updatePlanSummary();
  show('setup');
  $('#topmeta').textContent = personName(personId);
}

function readSetup() {
  const s = state.settings;
  s.mode = $('#mode-hand').checked ? 'hand' : 'stand';
  s.distanceCm = parseFloat($('#distance').value) || 40;
  s.device = $('#device').value;
  const preset = DEVICE_PRESETS.find((p) => p.id === s.device);
  s.ppi = preset.ppi ?? (parseFloat($('#ppi').value) || 132);
  for (const d of DIR_ORDER) s.dirs[d] = $(`#dir-${d}`).checked;
  s.speeds = $('#speeds').value;
  s.blockSec = Math.min(30, Math.max(5, parseFloat($('#block-sec').value) || 10));
  s.periodDeg = Math.min(20, Math.max(1, parseFloat(String($('#period').value).replace(',', '.')) || 4));
  s.order = $('#order').value;
  return s;
}

function updatePlanSummary() {
  const s = readSetup();
  $('#ppi-field').hidden = s.device !== 'custom';
  const plan = buildPlan(s);
  const secs = plan.length * (s.blockSec + PRE_SEC) + 9 * CAL_DWELL;
  $('#plan-summary').textContent = plan.length
    ? `${plan.length} Blöcke, Messzeit ca. ${Math.ceil(secs / 60)} min inkl. Kalibrierung. Ablauf: ${plan.slice(0, 4).map((b) => `${DIRS[b.dir].arrow} ${b.speed}°/s`).join(', ')}${plan.length > 4 ? ' …' : ''}`
    : 'Mindestens eine Richtung und eine Geschwindigkeit wählen.';
}
$('#setup-form').addEventListener('input', updatePlanSummary);
$('#setup-form').addEventListener('change', updatePlanSummary);

$('#setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = readSetup();
  if (!buildPlan(s).length) { $('#setup-error').textContent = 'Bitte mindestens eine Richtung und eine Geschwindigkeit wählen.'; $('#setup-error').hidden = false; return; }
  saveSettings();
  // Bewegungssensor-Erlaubnis muss direkt im Klick angefragt werden (iOS)
  const motionReq = motion.request();
  show('check');
  startCheck(motionReq);
});

// ---------- Setup-Check ----------
let checkBuf = [];
let checkOff = null;
let checkTimer = null;

async function startCheck(motionReq) {
  $('#dist-target').textContent = `${state.settings.distanceCm} cm`;
  $('#dist-confirm').checked = false;
  $('#cam-status').hidden = false;
  $('#cam-status').textContent = 'Kamera wird gestartet …';
  placeCam(true);
  checkBuf = [];
  try {
    await tracker.start((msg) => { $('#cam-status').textContent = msg; $('#cam-status').hidden = !msg; });
  } catch (err) {
    console.error(err);
    $('#cam-status').hidden = false;
    $('#cam-status').textContent = err.name === 'NotAllowedError'
      ? 'Kein Kamerazugriff. Bitte in den Einstellungen → Safari → Kamera erlauben und Seite neu laden.'
      : `Kamera oder Gesichtserkennung konnte nicht starten (${err.message || err.name}).`;
    return;
  }
  const motionOk = await motionReq;
  if (!motionOk && state.settings.mode === 'hand') toast('Bewegungssensor nicht freigegeben. Wackeln wird nur über das Kamerabild erkannt.');
  checkOff?.();
  checkOff = tracker.on((s) => {
    checkBuf.push(s);
    while (checkBuf.length && s.t - checkBuf[0].t > 1.5) checkBuf.shift();
  });
  clearInterval(checkTimer);
  checkTimer = setInterval(renderChecks, 250);
}

function stopCheckLoop() {
  checkOff?.(); checkOff = null;
  clearInterval(checkTimer); checkTimer = null;
}
function stopTracking() {
  stopCheckLoop();
  tracker.stop();
}

function evalChecks() {
  const buf = checkBuf;
  const faces = buf.filter((s) => s.face);
  const faceFrac = buf.length ? faces.length / buf.length : 0;
  const hand = state.settings.mode === 'hand';
  const items = [];
  const add = (label, status, val) => items.push({ label, status, val });

  add('Kamera', tracker.fps >= 20 ? 'good' : tracker.fps >= 12 ? 'warn' : 'bad', `${tracker.fps} Bilder/s`);
  add('Gesicht erkannt', faceFrac >= 0.9 ? 'good' : faceFrac >= 0.5 ? 'warn' : 'bad', pct(faceFrac));
  const open = median(faces.map((s) => s.open));
  add('Augen offen, Iris sichtbar', !faces.length ? 'bad' : open >= 0.18 ? 'good' : open >= 0.12 ? 'warn' : 'bad', fmt(open, 2));
  const b = tracker.brightness;
  add('Licht', b >= 70 && b <= 230 ? 'good' : b >= 45 ? 'warn' : 'bad', Number.isFinite(b) ? `${Math.round((b / 255) * 100)} %` : '–');
  if (faces.length) {
    const f = faces[faces.length - 1];
    const dx = f.cx / f.w - 0.5, dy = f.cy / f.h - 0.5;
    add('Gesicht mittig', Math.abs(dx) < 0.25 && Math.abs(dy) < 0.3 ? 'good' : 'bad', Math.abs(dx) >= 0.25 ? (dx > 0 ? 'weiter nach links' : 'weiter nach rechts') : Math.abs(dy) >= 0.3 ? (dy > 0 ? 'Kamera tiefer' : 'Kamera höher') : 'ok');
    const sc = median(faces.map((s) => s.scale));
    const jitter = Math.max(sd(faces.map((s) => s.cx)), sd(faces.map((s) => s.cy))) / sc;
    const lim = hand ? 0.08 : 0.03;
    add(hand ? 'Gerät ruhig gehalten' : 'Kopf ruhig', jitter < lim ? 'good' : jitter < 2 * lim ? 'warn' : 'bad', jitter < lim ? 'ruhig' : 'unruhig');
    const est = median(faces.map((s) => s.distCm));
    add('Abstand (grobe Schätzung)', 'info', Number.isFinite(est) ? `≈ ${Math.round(est)} cm` : '–');
  } else {
    add('Gesicht mittig', 'bad', '–');
    add(hand ? 'Gerät ruhig gehalten' : 'Kopf ruhig', 'bad', '–');
  }
  if (hand) add('Bewegungssensor', motion.enabled ? 'good' : 'warn', motion.enabled ? 'aktiv' : 'nicht freigegeben');
  return items;
}

function renderChecks() {
  const items = evalChecks();
  $('#checks').innerHTML = items.map((i) => `<li class="${i.status}"><span class="dot"></span><span>${esc(i.label)}</span><span class="val">${esc(i.val)}</span></li>`).join('');
  const ok = items.every((i) => i.status !== 'bad') && $('#dist-confirm').checked && tracker.running;
  $('#start-calib').disabled = !ok;
  $('#check-hint').textContent = !$('#dist-confirm').checked && items.every((i) => i.status !== 'bad')
    ? 'Alles grün. Bitte noch den gemessenen Abstand bestätigen.'
    : 'iPad quer, Kamera auf Augenhöhe, Licht von vorne. Abstand mit Lineal oder Maßband messen.';
}

$('#start-calib').addEventListener('click', () => {
  stopCheckLoop();
  enterFullscreen();
  startCalibration();
});

// ---------- Vollbild-Ebene ----------
let wakeLock = null;
function enterFullscreen() {
  $('#fs').hidden = false;
  stage.resize();
  updateRotateHint();
  const el = document.documentElement;
  (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch?.(() => {});
  navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
}
function exitFullscreen() {
  $('#fs').hidden = true;
  $('#hud').hidden = true;
  $('#overlay').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  wakeLock?.release().catch(() => {}); wakeLock = null;
  updateRotateHint();
}
function overlay(html) {
  const o = $('#overlay');
  o.innerHTML = `<div class="sheet">${html}</div>`;
  o.hidden = false;
  return o;
}

// ---------- Kalibrierung ----------
function calTargets() {
  const D = state.settings.distanceCm, ppc = pxPerCm();
  const ax = (Math.atan((0.8 * stage.w) / 2 / ppc / D) * 180) / Math.PI;
  const ay = (Math.atan((0.75 * stage.h) / 2 / ppc / D) * 180) / Math.PI;
  const r = (v) => Math.round(v * 10) / 10 || 0;
  return CAL_SEQ.map(([x, y]) => ({ tx: r(x * ax), ty: r(y * ay) }));
}

function startCalibration() {
  stage.fill('#7f7f7f');
  overlay(`
    <h2>Kalibrierung</h2>
    <p>Gleich erscheint ein Punkt, der nacheinander in der Mitte, links, rechts, oben und unten steht. <b>Bitte dem Punkt nur mit den Augen folgen</b> und ihn ruhig anschauen. Kopf nicht bewegen.</p>
    <p class="hint">Dauer: ca. ${Math.round(CAL_SEQ.length * CAL_DWELL)} Sekunden.</p>
    <div class="row"><button class="btn" data-act="cancel">Abbrechen</button><button class="btn primary" data-act="go">Start</button></div>`);
  $('#overlay').onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'go') { $('#overlay').hidden = true; runCalibration(); }
    if (act === 'cancel') { exitFullscreen(); show('check'); startCheck(Promise.resolve(motion.enabled)); }
  };
}

function runCalibration() {
  const targets = calTargets();
  const cal = { points: targets.map((t) => ({ ...t, samples: [] })), i: 0, start: performance.now() / 1000 };
  const off = tracker.on((s) => {
    const el = s.t - cal.start - cal.i * CAL_DWELL;
    if (cal.i >= cal.points.length || el < CAL_SETTLE || el >= CAL_DWELL) return;
    cal.points[cal.i].samples.push({
      fx: s.fx, fy: s.fy, valid: s.face && s.open >= 0.12,
      cx: s.cx, cy: s.cy, scale: s.scale, open: s.open,
    });
  });
  const ppc = pxPerCm(), D = state.settings.distanceCm;
  const frame = () => {
    const el = performance.now() / 1000 - cal.start;
    cal.i = Math.floor(el / CAL_DWELL);
    if (cal.i >= cal.points.length) { off(); finishCalibration(cal.points); return; }
    const p = cal.points[cal.i];
    const x = stage.w / 2 + Math.tan((p.tx * Math.PI) / 180) * D * ppc;
    const y = stage.h / 2 + Math.tan((p.ty * Math.PI) / 180) * D * ppc;
    stage.target(x, y, (el - cal.i * CAL_DWELL) / CAL_DWELL);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function finishCalibration(points) {
  const res = fitCalibration(points, { mode: state.settings.mode });
  stage.fill('#7f7f7f');
  if (res.ok) {
    state.calib = res;
    overlay(`
      <h2><span class="pill good">Kalibrierung OK</span></h2>
      <dl class="kv">
        <dt>Links/rechts</dt><dd>R² ${fmt(res.r2x)} · Trennung ${fmt(res.sepX, 1)}</dd>
        <dt>Oben/unten</dt><dd>R² ${fmt(res.r2y)} · Trennung ${fmt(res.sepY, 1)}</dd>
        <dt>Mitte wiederholbar</dt><dd>± ${fmt(res.centerSdX, 1)}° / ± ${fmt(res.centerSdY, 1)}°</dd>
      </dl>
      <p>Jetzt startet das Streifenband. <b>Entspannt auf die Streifen schauen</b>, ihnen folgen ist erlaubt. Antippen pausiert die Messung.</p>
      <div class="row"><button class="btn" data-act="repeat">Neu kalibrieren</button><button class="btn primary" data-act="measure">Messung starten</button></div>`);
  } else {
    overlay(`
      <h2><span class="pill bad">Kalibrierung nicht OK</span></h2>
      <ul>${res.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      <div class="row"><button class="btn" data-act="check">Zurück zum Setup-Check</button><button class="btn primary" data-act="repeat">Wiederholen</button></div>`);
  }
  $('#overlay').onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'repeat') { $('#overlay').hidden = true; runCalibration(); }
    if (act === 'check') { exitFullscreen(); show('check'); startCheck(Promise.resolve(motion.enabled)); }
    if (act === 'measure') { $('#overlay').hidden = true; startRun(); }
  };
}

// ---------- Messung ----------
function startRun() {
  const s = state.settings;
  const plan = buildPlan(s);
  const M = state.run = {
    plan,
    i: 0,
    attempt: plan.map(() => 0),
    status: plan.map(() => 'offen'),
    phase: 'pre',
    phaseStart: performance.now() / 1000,
    paused: false,
    samples: [],
    lastFace: null,
    t0: performance.now() / 1000,
    periodPx: Math.max(6, 2 * Math.tan(((s.periodDeg / 2) * Math.PI) / 180) * s.distanceCm * pxPerCm()),
  };
  M.off = tracker.on(onRunSample);
  stage.c.onpointerdown = () => { if (!M.paused && state.run === M) pauseRun('Pausiert'); };
  $('#hud').hidden = false;
  requestAnimationFrame(runFrame);
}

function onRunSample(s) {
  const M = state.run;
  if (!M || M.paused) return;
  let faceSpeed = 0;
  if (s.face && M.lastFace) {
    const dt = s.t - M.lastFace.t;
    if (dt > 0 && dt < 0.25) faceSpeed = Math.hypot(s.cx - M.lastFace.cx, s.cy - M.lastFace.cy) / s.scale / dt;
  }
  if (s.face) M.lastFace = s;
  const valid = !!s.face && s.open >= 0.55 * state.calib.openRef;
  const shake = (s.gyro != null && s.gyro > GYRO_LIMIT) || faceSpeed > FACE_SPEED_LIMIT;
  M.samples.push({
    t: s.t, block: M.i, attempt: M.attempt[M.i], phase: M.phase === 'stim' ? 1 : 0,
    valid, shake, fx: s.fx ?? NaN, fy: s.fy ?? NaN, scale: s.scale ?? NaN, gyro: s.gyro,
  });
}

function runFrame() {
  const M = state.run;
  if (!M || M.paused) return;
  const now = performance.now() / 1000;
  const el = now - M.phaseStart;
  const b = M.plan[M.i];
  const dir = DIRS[b.dir];
  const s = state.settings;
  $('#hud').textContent = `Block ${M.i + 1}/${M.plan.length} · ${dir.arrow} ${b.speed} °/s${M.phase === 'pre' ? ' · gleich geht es los' : ''}`;
  if (M.phase === 'pre') {
    stage.fixation(dir.arrow, `${dir.label} · ${b.speed} °/s`, Math.max(1, Math.ceil(PRE_SEC - el)));
    if (el >= PRE_SEC) { M.phase = 'stim'; M.phaseStart = now; }
  } else {
    const speedPx = ((b.speed * Math.PI) / 180) * s.distanceCm * pxPerCm(); // px/s, Kleinwinkel um die Bildschirmmitte
    stage.stripes(dir.axis, dir.sign * speedPx * el, M.periodPx);
    if (el >= s.blockSec) { endBlock(); return; }
  }
  requestAnimationFrame(runFrame);
}

function analyzeRunBlock(M, i) {
  const b = M.plan[i], att = M.attempt[i], dir = DIRS[b.dir], cal = state.calib;
  const ss = M.samples.filter((x) => x.block === i && x.attempt === att && x.phase === 1);
  const deg = (x) => (dir.axis === 'x' ? cal.ax + cal.bx * x.fx : cal.ay + cal.by * x.fy);
  const scaleMed = median(ss.filter((x) => x.valid).map((x) => x.scale));
  // Näher am Gerät → Gesicht größer → Streifen laufen in Grad schneller
  const speedEff = Number.isFinite(scaleMed) && cal.scale0 > 0 ? (b.speed * scaleMed) / cal.scale0 : b.speed;
  const r = analyzeBlock({
    t: ss.map((x) => x.t),
    p: ss.map((x) => (x.valid ? deg(x) * dir.sign : NaN)),
    valid: ss.map((x) => x.valid),
    shake: ss.map((x) => x.shake),
  }, speedEff);
  return { dir: b.dir, speed: b.speed, speedEff, attempt: att, planIdx: i, ...r };
}

function endBlock() {
  const M = state.run;
  M.status[M.i] = 'fertig';
  const r = analyzeRunBlock(M, M.i);
  if (r.quality === 'ungültig') {
    pauseRun(`Block ${M.i + 1} war nicht auswertbar`, `Augen erkannt: ${pct(r.validPct)} · Wackeln: ${pct(r.shakePct)}. Empfehlung: Block wiederholen.`, true);
    return;
  }
  nextBlock();
}

function nextBlock() {
  const M = state.run;
  M.i++;
  if (M.i >= M.plan.length) { finishRun(); return; }
  M.phase = 'pre';
  M.phaseStart = performance.now() / 1000;
  M.paused = false;
  requestAnimationFrame(runFrame);
}

function restartBlock(i) {
  const M = state.run;
  M.i = i;
  M.attempt[i]++;
  M.status[i] = 'offen';
  M.phase = 'pre';
  M.phaseStart = performance.now() / 1000;
  M.paused = false;
  $('#overlay').hidden = true;
  requestAnimationFrame(runFrame);
}

function pauseRun(title, text = '', afterBlock = false) {
  const M = state.run;
  M.paused = true;
  stage.fill('#7f7f7f');
  const prev = afterBlock ? M.i : M.i - 1;
  overlay(`
    <h2>${esc(title)}</h2>
    ${text ? `<p>${esc(text)}</p>` : `<p>Block ${M.i + 1} von ${M.plan.length}. Der unterbrochene Block wird beim Fortsetzen neu gestartet.</p>`}
    <div class="row">
      <button class="btn danger" data-act="end">Messung beenden</button>
      ${afterBlock ? '' : '<button class="btn" data-act="skip">Block überspringen</button>'}
      ${!afterBlock && prev >= 0 ? '<button class="btn" data-act="prev">Letzten Block wiederholen</button>' : ''}
      ${afterBlock ? '<button class="btn" data-act="next">Trotzdem weiter</button><button class="btn primary" data-act="again">Wiederholen</button>'
        : '<button class="btn primary" data-act="resume">Fortsetzen</button>'}
    </div>`);
  $('#overlay').onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    $('#overlay').hidden = true;
    if (act === 'resume') restartBlock(M.i);
    if (act === 'again') restartBlock(M.i);
    if (act === 'prev') { M.status[M.i] = 'offen'; M.attempt[M.i]++; restartBlock(prev); }
    if (act === 'next') nextBlock();
    if (act === 'skip') { M.status[M.i] = 'übersprungen'; nextBlock(); }
    if (act === 'end') { M.status[M.i] = M.status[M.i] === 'fertig' ? 'fertig' : 'abgebrochen'; finishRun(); }
  };
}

async function finishRun() {
  const M = state.run;
  M.off?.();
  stage.c.onpointerdown = null;
  state.run = null;
  exitFullscreen();
  stopTracking();

  const blocks = M.plan.map((b, i) => (M.status[i] === 'fertig' ? analyzeRunBlock(M, i) : null)).filter(Boolean);
  if (!blocks.length) { toast('Messung beendet, kein Block abgeschlossen. Nichts gespeichert.'); show('home'); return; }

  const cal = state.calib;
  const keep = M.samples.filter((x) => x.attempt === M.attempt[x.block] && M.status[x.block] === 'fertig');
  const r = (v, d) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
  const raw = {
    fields: ['t', 'block', 'phase', 'valid', 'shake', 'ex', 'ey', 'scale', 'gyro'],
    note: 't in s ab Messbeginn; ex/ey Augenposition in Grad (+ = rechts/unten); scale = Augenabstand im Kamerabild (px); gyro = Gerätedrehung °/s',
    rows: keep.map((x) => [r(x.t - M.t0, 3), x.block, x.phase, x.valid ? 1 : 0, x.shake ? 1 : 0,
      x.valid ? r(cal.ax + cal.bx * x.fx, 2) : null, x.valid ? r(cal.ay + cal.by * x.fy, 2) : null, r(x.scale, 1), r(x.gyro, 1)]),
  };
  const s = state.settings;
  const m = {
    format: 'nlb-okr-measurement',
    version: 1,
    id: store.uid(),
    personId: state.personId,
    personName: personName(state.personId),
    createdAt: new Date().toISOString(),
    settings: { mode: s.mode, distanceCm: s.distanceCm, device: s.device, ppi: s.ppi, periodDeg: s.periodDeg, blockSec: s.blockSec, order: s.order },
    device: { screen: [stage.w, stage.h], userAgent: navigator.userAgent, motionSensor: motion.enabled },
    calibration: { ax: cal.ax, bx: cal.bx, ay: cal.ay, by: cal.by, r2x: cal.r2x, r2y: cal.r2y, sepX: cal.sepX, sepY: cal.sepY, centerSdX: cal.centerSdX, centerSdY: cal.centerSdY, headMove: cal.headMove, scale0: cal.scale0, openRef: cal.openRef, points: cal.points },
    plan: M.plan.map((b, i) => ({ ...b, status: M.status[i] })),
    blocks,
    summary: summarize(blocks),
    raw,
  };
  try {
    await store.put('measurements', m);
  } catch (err) {
    console.error(err);
    toast('Speichern im Browser fehlgeschlagen. Bitte sofort exportieren.');
  }
  state.measurements.push(m);
  showResult(m, true);
}

// ---------- Export ----------
const CSV_COLS = ['Person', 'Datum', 'Haltung', 'Richtung', 'Geschwindigkeit °/s', 'eff. Geschwindigkeit °/s', 'Gain', 'Langsame Phase °/s', 'Schlagfrequenz Hz', 'Amplitude °', 'Schläge', 'Augen erkannt %', 'Wackeln %', 'Qualität'];
function csvFor(list) {
  const n = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [CSV_COLS.map(q).join(';')];
  for (const m of list) {
    for (const b of m.blocks) {
      rows.push([q(m.personName), q(dateStr(m.createdAt)), q(m.settings.mode === 'hand' ? 'Hand' : 'Ständer'), q(DIRS[b.dir].label),
        n(b.speed, 1), n(b.speedEff, 2), n(b.gain), n(b.spv, 2), n(b.beatHz, 2), n(b.ampDeg, 2), b.nBeats,
        n(b.validPct * 100, 0), n(b.shakePct * 100, 0), q(b.quality)].join(';'));
    }
  }
  return '﻿' + rows.join('\r\n');
}

function exportMeasurement(m) {
  const base = `OKR_${slug(m.personName)}_${stamp(m.createdAt)}`;
  store.offerFiles([
    { name: `${base}.json`, type: 'application/json', text: JSON.stringify(m) },
    { name: `${base}.csv`, type: 'text/csv', text: csvFor([m]) },
  ]).then((r) => r !== 'aborted' && toast('Export bereitgestellt.'));
}

// ---------- Ergebnis ----------
function qualityPill(q) {
  return `<span class="pill ${q === 'gut' ? 'good' : q === 'mäßig' ? 'warn' : 'bad'}">${esc(q)}</span>`;
}

function showResult(m, fresh = false) {
  if (!m) return;
  destroyAll();
  const s = m.summary;
  const blocks = DIR_ORDER.flatMap((d) => m.blocks.filter((b) => b.dir === d).sort((a, b) => a.speed - b.speed));
  const shaky = m.blocks.some((b) => b.shakePct > 0.1);
  const el = $('#v-result');
  el.innerHTML = `
    <div class="panel">
      <div class="result-head">
        <div>
          <h2>${esc(m.personName)}</h2>
          <div class="meta">${dateStr(m.createdAt)} · ${m.settings.mode === 'hand' ? 'in der Hand' : 'Ständer'} · ${m.settings.distanceCm} cm · Streifen ${fmt(m.settings.periodDeg, 1)}°</div>
        </div>
        <div class="row">
          <button class="btn danger" data-act="delete">Löschen</button>
          <button class="btn primary" data-act="export">Exportieren</button>
        </div>
      </div>
      ${fresh ? '<p class="hint">Gespeichert auf diesem Gerät. Zum Sichern „Exportieren“ tippen und „In Dateien sichern“, AirDrop oder SeaFile wählen.</p>' : ''}
      <div id="del-confirm" class="notice" hidden>Diese Messung wirklich löschen? Exportierte Dateien bleiben erhalten.
        <div class="row" style="margin-top:8px"><button class="btn" data-act="del-no">Behalten</button><button class="btn danger" data-act="del-yes">Endgültig löschen</button></div>
      </div>
    </div>
    <div class="panel">
      <div class="tiles">
        <div class="tile"><div class="k">Gain horizontal</div><div class="v">${fmt(s.gainH)}</div><div class="s">← ${fmt(s.gainByDir.L)} · → ${fmt(s.gainByDir.R)}</div></div>
        <div class="tile"><div class="k">Gain vertikal</div><div class="v">${fmt(s.gainV)}</div><div class="s">↑ ${fmt(s.gainByDir.U)} · ↓ ${fmt(s.gainByDir.D)}</div></div>
        <div class="tile"><div class="k">Asymmetrie R/L</div><div class="v">${signed(s.asymH)} %</div><div class="s">+ = rechts stärker</div></div>
        <div class="tile"><div class="k">Asymmetrie O/U</div><div class="v">${signed(s.asymV)} %</div><div class="s">+ = oben stärker</div></div>
        <div class="tile"><div class="k">Schlagfrequenz</div><div class="v">${fmt(s.beatHz, 1)} Hz</div><div class="s">Mittel aller Blöcke</div></div>
        <div class="tile"><div class="k">Amplitude</div><div class="v">${fmt(s.ampDeg, 1)}°</div><div class="s">${s.validBlocks} von ${s.totalBlocks} Blöcken gültig</div></div>
      </div>
      ${shaky ? '<p class="notice">In einigen Blöcken wurde Wackeln erkannt. Diese Abschnitte sind aus der Gain-Berechnung ausgeschlossen.</p>' : ''}
    </div>
    <div class="panel">
      <h3>Blöcke</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Richtung</th><th class="num">°/s</th><th class="num">eff. °/s</th><th class="num">Gain</th><th class="num">Schläge/s</th><th class="num">Amplitude</th><th class="num">Augen erkannt</th><th class="num">Wackeln</th><th>Qualität</th></tr></thead>
        <tbody>${blocks.map((b) => `<tr>
          <td>${DIRS[b.dir].arrow} ${DIRS[b.dir].label}</td><td class="num">${b.speed}</td><td class="num">${fmt(b.speedEff, 1)}</td>
          <td class="num">${fmt(b.gain)}</td><td class="num">${fmt(b.beatHz, 1)}</td><td class="num">${fmt(b.ampDeg, 1)}°</td>
          <td class="num">${pct(b.validPct)}</td><td class="num">${pct(b.shakePct)}</td><td>${qualityPill(b.quality)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h3>Augenbewegung im Block</h3>
        <label class="sr" for="trace-block">Block</label>
        <select id="trace-block">${blocks.map((b) => `<option value="${m.blocks.indexOf(b)}">${DIRS[b.dir].arrow} ${DIRS[b.dir].label} · ${b.speed} °/s</option>`).join('')}</select>
      </div>
      <p class="hint">Sägezahn: langsame Phase in Laufrichtung, schneller Rücksprung dagegen. Lücken = Augen nicht erkannt (z. B. Lidschlag).</p>
      <div class="chart-box"><canvas id="trace-canvas" aria-label="Augenposition über die Zeit"></canvas></div>
    </div>`;

  const drawTrace = () => {
    const bi = +$('#trace-block').value;
    const b = m.blocks[bi];
    if (!b) return;
    const planIdx = b.planIdx;
    const F = Object.fromEntries(m.raw.fields.map((f, i) => [f, i]));
    const rows = m.raw.rows.filter((r) => r[F.block] === planIdx && r[F.phase] === 1);
    const axis = DIRS[b.dir].axis === 'x' ? F.ex : F.ey;
    const t0 = rows[0]?.[F.t] ?? 0;
    const pts = rows.map((r) => ({ x: r[F.t] - t0, y: r[axis] }));
    traceChart($('#trace-canvas'), pts, DIRS[b.dir].axis === 'x' ? 'Auge horizontal (°, + = rechts)' : 'Auge vertikal (°, + = unten)');
  };
  $('#trace-block').addEventListener('change', drawTrace);
  if (blocks.length) drawTrace();

  el.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') exportMeasurement(m);
    if (act === 'delete') $('#del-confirm').hidden = false;
    if (act === 'del-no') $('#del-confirm').hidden = true;
    if (act === 'del-yes') {
      await store.remove('measurements', m.id);
      state.measurements = state.measurements.filter((x) => x.id !== m.id);
      state.selected.delete(m.id);
      toast('Messung gelöscht.');
      show('home');
    }
  };
  show('result');
  $('#topmeta').textContent = m.personName;
}

// ---------- Vergleich ----------
function showCompare() {
  destroyAll();
  const list = state.measurements.filter((m) => state.selected.has(m.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (list.length < 2) return;
  const ref = list[0];
  const label = (m) => `${m.personName} · ${new Date(m.createdAt).toLocaleDateString('de-DE')}`;
  const speeds = [...new Set(list.flatMap((m) => m.blocks.map((b) => b.speed)))].sort((a, b) => a - b);
  const gainOf = (m, d, v) => {
    const b = m.blocks.find((x) => x.dir === d && x.speed === v && x.quality !== 'ungültig');
    return b ? b.gain : NaN;
  };
  const cell = (val, refVal, digits = 2, isRef = false, unit = '') => {
    if (!Number.isFinite(val)) return '<td class="num">–</td>';
    if (isRef || !Number.isFinite(refVal)) return `<td class="num">${fmt(val, digits)}${unit}</td>`;
    const diff = val - refVal;
    const rel = refVal !== 0 ? (diff / Math.abs(refVal)) * 100 : NaN;
    return `<td class="num">${fmt(val, digits)}${unit}<span class="delta">${signed(diff, digits)}${Number.isFinite(rel) && !unit ? ` (${signed(rel)} %)` : ''}</span></td>`;
  };

  const summaryRows = [
    ['Gain gesamt', (m) => m.summary.gainAll, 2, ''],
    ['Gain horizontal', (m) => m.summary.gainH, 2, ''],
    ['Gain vertikal', (m) => m.summary.gainV, 2, ''],
    ['Asymmetrie R/L', (m) => m.summary.asymH, 0, ' %'],
    ['Asymmetrie O/U', (m) => m.summary.asymV, 0, ' %'],
    ['Schlagfrequenz', (m) => m.summary.beatHz, 1, ' Hz'],
    ['Amplitude', (m) => m.summary.ampDeg, 1, '°'],
  ];

  const el = $('#v-compare');
  el.innerHTML = `
    <div class="panel">
      <h2>Vergleich von ${list.length} Messungen</h2>
      <p class="hint">Bezug ist die älteste Messung (${esc(label(ref))}). Kleine graue Zahlen: Abweichung zum Bezug.</p>
      <div class="legend" style="margin-top:12px">${list.map((m, i) => `<span><i style="background:${seriesColor(i)}"></i>${esc(label(m))}${m.settings.mode === 'hand' ? ' (Hand)' : ''}</span>`).join('')}</div>
    </div>
    <div class="panel">
      <h3>Zahlen</h3>
      <div class="table-wrap"><table>
        <thead><tr><th></th>${list.map((m) => `<th class="num">${esc(label(m))}</th>`).join('')}</tr></thead>
        <tbody>
          <tr class="group"><td colspan="${list.length + 1}">Zusammenfassung</td></tr>
          ${summaryRows.map(([name, get, d, unit]) => `<tr><td>${name}</td>${list.map((m, i) => cell(get(m), get(ref), d, i === 0, unit)).join('')}</tr>`).join('')}
          <tr class="group"><td colspan="${list.length + 1}">Gain je Richtung und Geschwindigkeit</td></tr>
          ${DIR_ORDER.flatMap((d) => speeds.map((v) => `<tr><td>${DIRS[d].arrow} ${DIRS[d].label} · ${v} °/s</td>${list.map((m, i) => cell(gainOf(m, d, v), gainOf(ref, d, v), 2, i === 0)).join('')}</tr>`)).join('')}
        </tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3>Gain je Richtung</h3>
      <div class="chart-grid">${DIR_ORDER.map((d) => `<div class="chart-box"><canvas id="cmp-${d}" aria-label="Gain ${DIRS[d].label}"></canvas></div>`).join('')}</div>
    </div>
    <div class="panel">
      <h3>Asymmetrie</h3>
      <p class="hint">Positiv: rechts bzw. oben stärker. Werte nahe 0 sind symmetrisch.</p>
      <div class="chart-box"><canvas id="cmp-asym" aria-label="Asymmetrie"></canvas></div>
    </div>
    <div class="panel row">
      <button class="btn primary" data-act="export">Vergleich exportieren</button>
    </div>`;

  for (const d of DIR_ORDER) {
    gainChart($(`#cmp-${d}`), list.map((m, i) => ({
      label: label(m),
      color: seriesColor(i),
      points: speeds.map((v) => ({ x: v, y: gainOf(m, d, v) })).filter((p) => Number.isFinite(p.y)),
    })), `${DIRS[d].arrow} ${DIRS[d].label}`);
  }
  asymChart($('#cmp-asym'), list.map((m, i) => ({ label: label(m), color: seriesColor(i), asymH: m.summary.asymH, asymV: m.summary.asymV })));

  el.onclick = (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'export') return;
    const now = new Date().toISOString();
    store.offerFiles([{ name: `OKR_Vergleich_${stamp(now)}.csv`, type: 'text/csv', text: csvFor(list) }])
      .then((r) => r !== 'aborted' && toast('Export bereitgestellt.'));
  };
  show('compare');
  $('#topmeta').textContent = 'Vergleich';
}

// ---------- Start ----------
async function init() {
  try {
    [state.persons, state.measurements] = await Promise.all([store.getAll('persons'), store.getAll('measurements')]);
  } catch (err) {
    console.error(err);
    toast('Gerätespeicher nicht verfügbar (privates Fenster?). Messungen sofort exportieren.');
  }
  show('home');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    toast('Kamera nur über HTTPS verfügbar.');
  }
}
init();

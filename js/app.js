import { DIRS, DIR_ORDER, fitCalibration, analyzeBlock, summarize, median, sd } from './analysis.js';
import { Tracker, Motion } from './tracker.js';
import { Stage } from './stage.js';
import * as store from './store.js';
import { traceChart, gainChart, asymChart, seriesColor, destroyAll } from './charts.js';
import { T, EN, LOCALE } from './i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '–');
const signed = (v, d = 0) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + fmt(v, d) : '–');
const dirLabel = (d) => (EN ? DIRS[d].labelEn : DIRS[d].label);
// Qualität wird intern deutsch gespeichert (Datenformat), angezeigt in der jeweiligen Sprache
const qualityLabel = (q) => (EN ? { gut: 'good', 'mäßig': 'fair', 'ungültig': 'invalid' }[q] ?? q : q);
const modeLabel = (mode) => (mode === 'hand' ? T('in der Hand', 'handheld') : T('Ständer', 'stand'));
const dateStr = (iso) => new Date(iso).toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------- Konstanten ----------
const DEVICE_PRESETS = [
  { id: 'ipad', label: 'iPad / iPad Air / iPad Pro', ppi: 132 },
  { id: 'ipadmini', label: 'iPad mini', ppi: 163 },
  { id: 'iphone', label: T('iPhone (aktuelle Modelle)', 'iPhone (current models)'), ppi: 153 },
  { id: 'iphonese', label: 'iPhone SE / mini', ppi: 163 },
  { id: 'custom', label: T('Eigener Wert', 'Custom value'), ppi: null },
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
  const persons = [...state.persons].sort((a, b) => a.name.localeCompare(b.name, LOCALE));
  pl.innerHTML = persons.length ? persons.map((p) => `
    <li>
      <div class="grow"><div class="title">${esc(p.name)}</div><div class="sub">${counts[p.id] || 0} ${T('Messung(en)', 'measurement(s)')}</div></div>
      <button class="btn primary" data-measure="${p.id}">${T('Messen', 'Measure')}</button>
    </li>`).join('') : `<li class="empty">${T('Noch keine Person angelegt.', 'No people yet.')}</li>`;

  const ml = $('#measure-list');
  const ms = [...state.measurements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  ml.innerHTML = ms.length ? ms.map((m) => {
    const s = m.summary;
    const q = s.validBlocks === s.totalBlocks ? 'good' : s.validBlocks >= s.totalBlocks / 2 ? 'warn' : 'bad';
    return `
    <li>
      <input type="checkbox" data-select="${m.id}" aria-label="${T('Für Vergleich auswählen', 'Select for comparison')}" ${state.selected.has(m.id) ? 'checked' : ''}>
      <button class="link grow" data-open="${m.id}">
        <div class="title">${esc(m.personName)} <span class="sub">· ${dateStr(m.createdAt)}</span></div>
        <div class="sub mono">Gain H ${fmt(s.gainH)} · V ${fmt(s.gainV)} · ${modeLabel(m.settings.mode)}</div>
      </button>
      <span class="pill ${q}">${s.validBlocks}/${s.totalBlocks} ${T('Blöcke', 'blocks')}</span>
    </li>`;
  }).join('') : `<li class="empty">${T('Noch keine Messungen. Person anlegen und „Messen“ tippen, oder Dateien importieren.', 'No measurements yet. Add a person and tap “Measure”, or import files.')}</li>`;

  const n = state.selected.size;
  $('#compare-btn').disabled = n < 2;
  $('#compare-btn').textContent = n ? `${T('Vergleichen', 'Compare')} (${n})` : T('Vergleichen', 'Compare');
  $('#compare-hint').hidden = n >= 2;
  $('#topmeta').textContent = '';
}

$('#person-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#person-name').value.trim();
  if (!name) return;
  if (state.persons.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast(T(`„${name}“ gibt es schon.`, `“${name}” already exists.`)); return; }
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
  if (!state.measurements.length) { toast(T('Es gibt noch keine Messungen.', 'There are no measurements yet.')); return; }
  const bundle = { format: 'nlb-okr-bundle', version: 1, exportedAt: new Date().toISOString(), persons: state.persons, measurements: state.measurements };
  const now = new Date().toISOString();
  store.offerFiles([
    { name: `OKR_${T('Alle', 'All')}_${stamp(now)}.json`, type: 'application/json', text: JSON.stringify(bundle) },
    { name: `OKR_${T('Alle', 'All')}_${stamp(now)}.csv`, type: 'text/csv', text: csvFor(state.measurements) },
  ]).then((r) => r !== 'aborted' && toast(T('Export bereitgestellt.', 'Export ready.')));
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
      toast(T(`„${file.name}“ ist keine OKR-Datei.`, `“${file.name}” is not an OKR file.`));
    }
  }
  e.target.value = '';
  renderHome();
  if (added || skipped) toast(T(`${added} Messung(en) importiert${skipped ? `, ${skipped} schon vorhanden` : ''}.`, `${added} measurement(s) imported${skipped ? `, ${skipped} already present` : ''}.`));
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
    ? `${T(`${plan.length} Blöcke, Messzeit ca. ${Math.ceil(secs / 60)} min inkl. Kalibrierung. Ablauf:`, `${plan.length} blocks, about ${Math.ceil(secs / 60)} min including calibration. Sequence:`)} ${plan.slice(0, 4).map((b) => `${DIRS[b.dir].arrow} ${b.speed}°/s`).join(', ')}${plan.length > 4 ? ' …' : ''}`
    : T('Mindestens eine Richtung und eine Geschwindigkeit wählen.', 'Choose at least one direction and one speed.');
}
$('#setup-form').addEventListener('input', updatePlanSummary);
$('#setup-form').addEventListener('change', updatePlanSummary);

$('#setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = readSetup();
  if (!buildPlan(s).length) { $('#setup-error').textContent = T('Bitte mindestens eine Richtung und eine Geschwindigkeit wählen.', 'Please choose at least one direction and one speed.'); $('#setup-error').hidden = false; return; }
  saveSettings();
  // Bewegungssensor-Erlaubnis muss direkt im Klick angefragt werden (iOS)
  const motionReq = motion.request();
  show('check');
  startCheck(motionReq);
});

// ---------- Setup-Check ----------
const STATUS = { camera: T('Kamera wird gestartet …', 'Starting camera …'), model: T('Gesichtserkennung wird geladen …', 'Loading face detection …') };
let checkBuf = [];
let checkOff = null;
let checkTimer = null;

async function startCheck(motionReq) {
  $('#dist-target').textContent = `${state.settings.distanceCm} cm`;
  $('#dist-confirm').checked = false;
  $('#cam-status').hidden = false;
  $('#cam-status').textContent = STATUS.camera;
  placeCam(true);
  checkBuf = [];
  try {
    await tracker.start((code) => { $('#cam-status').textContent = STATUS[code] ?? ''; $('#cam-status').hidden = !code; });
  } catch (err) {
    console.error(err);
    $('#cam-status').hidden = false;
    $('#cam-status').textContent = err.name === 'NotAllowedError'
      ? T('Kein Kamerazugriff. Bitte in den Einstellungen → Safari → Kamera erlauben und Seite neu laden.', 'No camera access. Please allow the camera under Settings → Safari → Camera and reload the page.')
      : T(`Kamera oder Gesichtserkennung konnte nicht starten (${err.message || err.name}).`, `Camera or face detection could not start (${err.message || err.name}).`);
    return;
  }
  const motionOk = await motionReq;
  if (!motionOk && state.settings.mode === 'hand') toast(T('Bewegungssensor nicht freigegeben. Wackeln wird nur über das Kamerabild erkannt.', 'Motion sensor not allowed. Shaking is detected from the camera image only.'));
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

  add(T('Kamera', 'Camera'), tracker.fps >= 20 ? 'good' : tracker.fps >= 12 ? 'warn' : 'bad', `${tracker.fps} ${T('Bilder/s', 'fps')}`);
  add(T('Gesicht erkannt', 'Face detected'), faceFrac >= 0.9 ? 'good' : faceFrac >= 0.5 ? 'warn' : 'bad', pct(faceFrac));
  const open = median(faces.map((s) => s.open));
  add(T('Augen offen, Iris sichtbar', 'Eyes open, iris visible'), !faces.length ? 'bad' : open >= 0.18 ? 'good' : open >= 0.12 ? 'warn' : 'bad', fmt(open, 2));
  const b = tracker.brightness;
  add(T('Licht', 'Light'), b >= 70 && b <= 230 ? 'good' : b >= 45 ? 'warn' : 'bad', Number.isFinite(b) ? `${Math.round((b / 255) * 100)} %` : '–');
  if (faces.length) {
    const f = faces[faces.length - 1];
    const dx = f.cx / f.w - 0.5, dy = f.cy / f.h - 0.5;
    add(T('Gesicht mittig', 'Face centred'), Math.abs(dx) < 0.25 && Math.abs(dy) < 0.3 ? 'good' : 'bad', Math.abs(dx) >= 0.25 ? (dx > 0 ? T('weiter nach links', 'move left') : T('weiter nach rechts', 'move right')) : Math.abs(dy) >= 0.3 ? (dy > 0 ? T('Kamera tiefer', 'camera lower') : T('Kamera höher', 'camera higher')) : 'ok');
    const sc = median(faces.map((s) => s.scale));
    const jitter = Math.max(sd(faces.map((s) => s.cx)), sd(faces.map((s) => s.cy))) / sc;
    const lim = hand ? 0.08 : 0.03;
    add(hand ? T('Gerät ruhig gehalten', 'Device held steady') : T('Kopf ruhig', 'Head steady'), jitter < lim ? 'good' : jitter < 2 * lim ? 'warn' : 'bad', jitter < lim ? T('ruhig', 'steady') : T('unruhig', 'unsteady'));
    const est = median(faces.map((s) => s.distCm));
    add(T('Abstand (grobe Schätzung)', 'Distance (rough estimate)'), 'info', Number.isFinite(est) ? `≈ ${Math.round(est)} cm` : '–');
  } else {
    add(T('Gesicht mittig', 'Face centred'), 'bad', '–');
    add(hand ? T('Gerät ruhig gehalten', 'Device held steady') : T('Kopf ruhig', 'Head steady'), 'bad', '–');
  }
  if (hand) add(T('Bewegungssensor', 'Motion sensor'), motion.enabled ? 'good' : 'warn', motion.enabled ? T('aktiv', 'active') : T('nicht freigegeben', 'not allowed'));
  return items;
}

function renderChecks() {
  const items = evalChecks();
  $('#checks').innerHTML = items.map((i) => `<li class="${i.status}"><span class="dot"></span><span>${esc(i.label)}</span><span class="val">${esc(i.val)}</span></li>`).join('');
  const ok = items.every((i) => i.status !== 'bad') && $('#dist-confirm').checked && tracker.running;
  $('#start-calib').disabled = !ok;
  $('#check-hint').textContent = !$('#dist-confirm').checked && items.every((i) => i.status !== 'bad')
    ? T('Alles grün. Bitte noch den gemessenen Abstand bestätigen.', 'All green. Please confirm the measured distance.')
    : T('iPad quer, Kamera auf Augenhöhe, Licht von vorne. Abstand mit Lineal oder Maßband messen.', 'iPad in landscape, camera at eye level, light from the front. Measure the distance with a ruler or tape measure.');
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
    <h2>${T('Kalibrierung', 'Calibration')}</h2>
    <p>${T('Gleich erscheint ein Punkt, der nacheinander in der Mitte, links, rechts, oben und unten steht. <b>Bitte dem Punkt nur mit den Augen folgen</b> und ihn ruhig anschauen. Kopf nicht bewegen.', 'A dot will appear in turn at the centre, left, right, top and bottom. <b>Follow the dot with your eyes only</b> and look at it steadily. Do not move your head.')}</p>
    <p class="hint">${T(`Dauer: ca. ${Math.round(CAL_SEQ.length * CAL_DWELL)} Sekunden.`, `Duration: about ${Math.round(CAL_SEQ.length * CAL_DWELL)} seconds.`)}</p>
    <div class="row"><button class="btn" data-act="cancel">${T('Abbrechen', 'Cancel')}</button><button class="btn primary" data-act="go">Start</button></div>`);
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

// Englische Texte zu den Kennungen aus fitCalibration
function issueEn(code) {
  if (code.startsWith('weak:')) {
    const [n, total] = code.slice(5).split('/');
    return `The eyes were detected too rarely at ${n} of ${total} points. Add more light, keep the face centred, remove reflective glasses if needed.`;
  }
  return {
    horizontal: 'Left/right eye movement was not detected cleanly. Follow the dots with your eyes only; do not turn your head.',
    vertical: 'Up/down eye movement was not detected cleanly. Open the eyes wide enough, light from the front, keep the head straight.',
    center: 'The centre point was not looked at consistently. Please fixate each dot steadily.',
    'head-hand': 'The iPad was moved too much during calibration. Please hold it more steadily, rest your elbows.',
    head: 'The head moved during calibration. Please keep the head still or support it.',
  }[code] ?? code;
}

function finishCalibration(points) {
  const res = fitCalibration(points, { mode: state.settings.mode });
  stage.fill('#7f7f7f');
  if (res.ok) {
    state.calib = res;
    overlay(`
      <h2><span class="pill good">${T('Kalibrierung OK', 'Calibration OK')}</span></h2>
      <dl class="kv">
        <dt>${T('Links/rechts', 'Left/right')}</dt><dd>R² ${fmt(res.r2x)} · ${T('Trennung', 'separation')} ${fmt(res.sepX, 1)}</dd>
        <dt>${T('Oben/unten', 'Up/down')}</dt><dd>R² ${fmt(res.r2y)} · ${T('Trennung', 'separation')} ${fmt(res.sepY, 1)}</dd>
        <dt>${T('Mitte wiederholbar', 'Centre repeatable')}</dt><dd>± ${fmt(res.centerSdX, 1)}° / ± ${fmt(res.centerSdY, 1)}°</dd>
      </dl>
      <p>${T('Jetzt startet das Streifenband. <b>Entspannt auf die Streifen schauen</b>, ihnen folgen ist erlaubt. Antippen pausiert die Messung.', 'The stripe pattern starts now. <b>Look at the stripes in a relaxed way</b>; following them is allowed. Tap to pause the measurement.')}</p>
      <div class="row"><button class="btn" data-act="repeat">${T('Neu kalibrieren', 'Recalibrate')}</button><button class="btn primary" data-act="measure">${T('Messung starten', 'Start measurement')}</button></div>`);
  } else {
    overlay(`
      <h2><span class="pill bad">${T('Kalibrierung nicht OK', 'Calibration not OK')}</span></h2>
      <ul>${(EN ? res.codes.map(issueEn) : res.issues).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      <div class="row"><button class="btn" data-act="check">${T('Zurück zum Setup-Check', 'Back to setup check')}</button><button class="btn primary" data-act="repeat">${T('Wiederholen', 'Repeat')}</button></div>`);
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
  stage.c.onpointerdown = () => { if (!M.paused && state.run === M) pauseRun(T('Pausiert', 'Paused')); };
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
  $('#hud').textContent = `Block ${M.i + 1}/${M.plan.length} · ${dir.arrow} ${b.speed} °/s${M.phase === 'pre' ? T(' · gleich geht es los', ' · starting soon') : ''}`;
  if (M.phase === 'pre') {
    const n = Math.max(1, Math.ceil(PRE_SEC - el));
    stage.fixation(dir.arrow, `${dirLabel(b.dir)} · ${b.speed} °/s`, T(`Start in ${n}`, `Starting in ${n}`));
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
    pauseRun(T(`Block ${M.i + 1} war nicht auswertbar`, `Block ${M.i + 1} could not be analysed`), T(`Augen erkannt: ${pct(r.validPct)} · Wackeln: ${pct(r.shakePct)}. Empfehlung: Block wiederholen.`, `Eyes detected: ${pct(r.validPct)} · shaking: ${pct(r.shakePct)}. Recommendation: repeat the block.`), true);
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
    ${text ? `<p>${esc(text)}</p>` : `<p>${T(`Block ${M.i + 1} von ${M.plan.length}. Der unterbrochene Block wird beim Fortsetzen neu gestartet.`, `Block ${M.i + 1} of ${M.plan.length}. The interrupted block restarts when you resume.`)}</p>`}
    <div class="row">
      <button class="btn danger" data-act="end">${T('Messung beenden', 'End measurement')}</button>
      ${afterBlock ? '' : `<button class="btn" data-act="skip">${T('Block überspringen', 'Skip block')}</button>`}
      ${!afterBlock && prev >= 0 ? `<button class="btn" data-act="prev">${T('Letzten Block wiederholen', 'Repeat last block')}</button>` : ''}
      ${afterBlock ? `<button class="btn" data-act="next">${T('Trotzdem weiter', 'Continue anyway')}</button><button class="btn primary" data-act="again">${T('Wiederholen', 'Repeat')}</button>`
        : `<button class="btn primary" data-act="resume">${T('Fortsetzen', 'Resume')}</button>`}
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
  if (!blocks.length) { toast(T('Messung beendet, kein Block abgeschlossen. Nichts gespeichert.', 'Measurement ended, no block completed. Nothing saved.')); show('home'); return; }

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
    toast(T('Speichern im Browser fehlgeschlagen. Bitte sofort exportieren.', 'Saving in the browser failed. Please export immediately.'));
  }
  state.measurements.push(m);
  showResult(m, true);
}

// ---------- Export ----------
const CSV_COLS = EN
  ? ['Person', 'Date', 'Posture', 'Direction', 'Speed °/s', 'Eff. speed °/s', 'Gain', 'Slow phase °/s', 'Beat frequency Hz', 'Amplitude °', 'Beats', 'Eyes detected %', 'Shaking %', 'Quality']
  : ['Person', 'Datum', 'Haltung', 'Richtung', 'Geschwindigkeit °/s', 'eff. Geschwindigkeit °/s', 'Gain', 'Langsame Phase °/s', 'Schlagfrequenz Hz', 'Amplitude °', 'Schläge', 'Augen erkannt %', 'Wackeln %', 'Qualität'];
// Deutsch: Semikolon und Dezimalkomma (Excel DE); Englisch: Komma und Dezimalpunkt
const CSV_SEP = EN ? ',' : ';';
function csvFor(list) {
  const n = (v, d = 3) => (Number.isFinite(v) ? (EN ? v.toFixed(d) : v.toFixed(d).replace('.', ',')) : '');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [CSV_COLS.map(q).join(CSV_SEP)];
  for (const m of list) {
    for (const b of m.blocks) {
      rows.push([q(m.personName), q(dateStr(m.createdAt)), q(m.settings.mode === 'hand' ? T('Hand', 'handheld') : T('Ständer', 'stand')), q(dirLabel(b.dir)),
        n(b.speed, 1), n(b.speedEff, 2), n(b.gain), n(b.spv, 2), n(b.beatHz, 2), n(b.ampDeg, 2), b.nBeats,
        n(b.validPct * 100, 0), n(b.shakePct * 100, 0), q(qualityLabel(b.quality))].join(CSV_SEP));
    }
  }
  return '﻿' + rows.join('\r\n');
}

function exportMeasurement(m) {
  const base = `OKR_${slug(m.personName)}_${stamp(m.createdAt)}`;
  store.offerFiles([
    { name: `${base}.json`, type: 'application/json', text: JSON.stringify(m) },
    { name: `${base}.csv`, type: 'text/csv', text: csvFor([m]) },
  ]).then((r) => r !== 'aborted' && toast(T('Export bereitgestellt.', 'Export ready.')));
}

// ---------- Ergebnis ----------
function qualityPill(q) {
  return `<span class="pill ${q === 'gut' ? 'good' : q === 'mäßig' ? 'warn' : 'bad'}">${esc(qualityLabel(q))}</span>`;
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
          <div class="meta">${dateStr(m.createdAt)} · ${modeLabel(m.settings.mode)} · ${m.settings.distanceCm} cm · ${T('Streifen', 'stripes')} ${fmt(m.settings.periodDeg, 1)}°</div>
        </div>
        <div class="row">
          <button class="btn danger" data-act="delete">${T('Löschen', 'Delete')}</button>
          <button class="btn primary" data-act="export">${T('Exportieren', 'Export')}</button>
        </div>
      </div>
      ${fresh ? `<p class="hint">${T('Gespeichert auf diesem Gerät. Zum Sichern „Exportieren“ tippen und „In Dateien sichern“, AirDrop oder SeaFile wählen.', 'Saved on this device. To back it up, tap “Export” and choose “Save to Files”, AirDrop or SeaFile.')}</p>` : ''}
      <div id="del-confirm" class="notice" hidden>${T('Diese Messung wirklich löschen? Exportierte Dateien bleiben erhalten.', 'Really delete this measurement? Exported files are kept.')}
        <div class="row" style="margin-top:8px"><button class="btn" data-act="del-no">${T('Behalten', 'Keep')}</button><button class="btn danger" data-act="del-yes">${T('Endgültig löschen', 'Delete permanently')}</button></div>
      </div>
    </div>
    <div class="panel">
      <div class="tiles">
        <div class="tile"><div class="k">Gain horizontal</div><div class="v">${fmt(s.gainH)}</div><div class="s">← ${fmt(s.gainByDir.L)} · → ${fmt(s.gainByDir.R)}</div></div>
        <div class="tile"><div class="k">${T('Gain vertikal', 'Gain vertical')}</div><div class="v">${fmt(s.gainV)}</div><div class="s">↑ ${fmt(s.gainByDir.U)} · ↓ ${fmt(s.gainByDir.D)}</div></div>
        <div class="tile"><div class="k">${T('Asymmetrie R/L', 'Asymmetry R/L')}</div><div class="v">${signed(s.asymH)} %</div><div class="s">${T('+ = rechts stärker', '+ = right stronger')}</div></div>
        <div class="tile"><div class="k">${T('Asymmetrie O/U', 'Asymmetry U/D')}</div><div class="v">${signed(s.asymV)} %</div><div class="s">${T('+ = oben stärker', '+ = up stronger')}</div></div>
        <div class="tile"><div class="k">${T('Schlagfrequenz', 'Beat frequency')}</div><div class="v">${fmt(s.beatHz, 1)} Hz</div><div class="s">${T('Mittel aller Blöcke', 'mean of all blocks')}</div></div>
        <div class="tile"><div class="k">Amplitude</div><div class="v">${fmt(s.ampDeg, 1)}°</div><div class="s">${T(`${s.validBlocks} von ${s.totalBlocks} Blöcken gültig`, `${s.validBlocks} of ${s.totalBlocks} blocks valid`)}</div></div>
      </div>
      ${shaky ? `<p class="notice">${T('In einigen Blöcken wurde Wackeln erkannt. Diese Abschnitte sind aus der Gain-Berechnung ausgeschlossen.', 'Shaking was detected in some blocks. These sections are excluded from the gain calculation.')}</p>` : ''}
    </div>
    <div class="panel">
      <h3>${T('Blöcke', 'Blocks')}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>${T('Richtung', 'Direction')}</th><th class="num">°/s</th><th class="num">eff. °/s</th><th class="num">Gain</th><th class="num">${T('Schläge/s', 'Beats/s')}</th><th class="num">Amplitude</th><th class="num">${T('Augen erkannt', 'Eyes detected')}</th><th class="num">${T('Wackeln', 'Shaking')}</th><th>${T('Qualität', 'Quality')}</th></tr></thead>
        <tbody>${blocks.map((b) => `<tr>
          <td>${DIRS[b.dir].arrow} ${dirLabel(b.dir)}</td><td class="num">${b.speed}</td><td class="num">${fmt(b.speedEff, 1)}</td>
          <td class="num">${fmt(b.gain)}</td><td class="num">${fmt(b.beatHz, 1)}</td><td class="num">${fmt(b.ampDeg, 1)}°</td>
          <td class="num">${pct(b.validPct)}</td><td class="num">${pct(b.shakePct)}</td><td>${qualityPill(b.quality)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h3>${T('Augenbewegung im Block', 'Eye movement in the block')}</h3>
        <label class="sr" for="trace-block">Block</label>
        <select id="trace-block">${blocks.map((b) => `<option value="${m.blocks.indexOf(b)}">${DIRS[b.dir].arrow} ${dirLabel(b.dir)} · ${b.speed} °/s</option>`).join('')}</select>
      </div>
      <p class="hint">${T('Sägezahn: langsame Phase in Laufrichtung, schneller Rücksprung dagegen. Lücken = Augen nicht erkannt (z. B. Lidschlag).', 'Sawtooth: slow phase in the direction of motion, fast reset jump against it. Gaps = eyes not detected (e.g. blink).')}</p>
      <div class="chart-box"><canvas id="trace-canvas" aria-label="${T('Augenposition über die Zeit', 'Eye position over time')}"></canvas></div>
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
    traceChart($('#trace-canvas'), pts, DIRS[b.dir].axis === 'x' ? T('Auge horizontal (°, + = rechts)', 'Eye horizontal (°, + = right)') : T('Auge vertikal (°, + = unten)', 'Eye vertical (°, + = down)'));
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
      toast(T('Messung gelöscht.', 'Measurement deleted.'));
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
  const label = (m) => `${m.personName} · ${new Date(m.createdAt).toLocaleDateString(LOCALE)}`;
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
    [T('Gain gesamt', 'Gain overall'), (m) => m.summary.gainAll, 2, ''],
    ['Gain horizontal', (m) => m.summary.gainH, 2, ''],
    [T('Gain vertikal', 'Gain vertical'), (m) => m.summary.gainV, 2, ''],
    [T('Asymmetrie R/L', 'Asymmetry R/L'), (m) => m.summary.asymH, 0, ' %'],
    [T('Asymmetrie O/U', 'Asymmetry U/D'), (m) => m.summary.asymV, 0, ' %'],
    [T('Schlagfrequenz', 'Beat frequency'), (m) => m.summary.beatHz, 1, ' Hz'],
    ['Amplitude', (m) => m.summary.ampDeg, 1, '°'],
  ];

  const el = $('#v-compare');
  el.innerHTML = `
    <div class="panel">
      <h2>${T(`Vergleich von ${list.length} Messungen`, `Comparison of ${list.length} measurements`)}</h2>
      <p class="hint">${T(`Bezug ist die älteste Messung (${esc(label(ref))}). Kleine graue Zahlen: Abweichung zum Bezug.`, `The reference is the oldest measurement (${esc(label(ref))}). Small grey numbers: difference from the reference.`)}</p>
      <div class="legend" style="margin-top:12px">${list.map((m, i) => `<span><i style="background:${seriesColor(i)}"></i>${esc(label(m))}${m.settings.mode === 'hand' ? T(' (Hand)', ' (handheld)') : ''}</span>`).join('')}</div>
    </div>
    <div class="panel">
      <h3>${T('Zahlen', 'Numbers')}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th></th>${list.map((m) => `<th class="num">${esc(label(m))}</th>`).join('')}</tr></thead>
        <tbody>
          <tr class="group"><td colspan="${list.length + 1}">${T('Zusammenfassung', 'Summary')}</td></tr>
          ${summaryRows.map(([name, get, d, unit]) => `<tr><td>${name}</td>${list.map((m, i) => cell(get(m), get(ref), d, i === 0, unit)).join('')}</tr>`).join('')}
          <tr class="group"><td colspan="${list.length + 1}">${T('Gain je Richtung und Geschwindigkeit', 'Gain per direction and speed')}</td></tr>
          ${DIR_ORDER.flatMap((d) => speeds.map((v) => `<tr><td>${DIRS[d].arrow} ${dirLabel(d)} · ${v} °/s</td>${list.map((m, i) => cell(gainOf(m, d, v), gainOf(ref, d, v), 2, i === 0)).join('')}</tr>`)).join('')}
        </tbody>
      </table></div>
    </div>
    <div class="panel">
      <h3>${T('Gain je Richtung', 'Gain per direction')}</h3>
      <div class="chart-grid">${DIR_ORDER.map((d) => `<div class="chart-box"><canvas id="cmp-${d}" aria-label="Gain ${dirLabel(d)}"></canvas></div>`).join('')}</div>
    </div>
    <div class="panel">
      <h3>${T('Asymmetrie', 'Asymmetry')}</h3>
      <p class="hint">${T('Positiv: rechts bzw. oben stärker. Werte nahe 0 sind symmetrisch.', 'Positive: right or up stronger. Values near 0 are symmetrical.')}</p>
      <div class="chart-box"><canvas id="cmp-asym" aria-label="${T('Asymmetrie', 'Asymmetry')}"></canvas></div>
    </div>
    <div class="panel row">
      <button class="btn primary" data-act="export">${T('Vergleich exportieren', 'Export comparison')}</button>
    </div>`;

  for (const d of DIR_ORDER) {
    gainChart($(`#cmp-${d}`), list.map((m, i) => ({
      label: label(m),
      color: seriesColor(i),
      points: speeds.map((v) => ({ x: v, y: gainOf(m, d, v) })).filter((p) => Number.isFinite(p.y)),
    })), `${DIRS[d].arrow} ${dirLabel(d)}`);
  }
  asymChart($('#cmp-asym'), list.map((m, i) => ({ label: label(m), color: seriesColor(i), asymH: m.summary.asymH, asymV: m.summary.asymV })));

  el.onclick = (e) => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'export') return;
    const now = new Date().toISOString();
    store.offerFiles([{ name: `OKR_${T('Vergleich', 'Comparison')}_${stamp(now)}.csv`, type: 'text/csv', text: csvFor(list) }])
      .then((r) => r !== 'aborted' && toast(T('Export bereitgestellt.', 'Export ready.')));
  };
  show('compare');
  $('#topmeta').textContent = T('Vergleich', 'Comparison');
}

// ---------- Start ----------
async function init() {
  try {
    [state.persons, state.measurements] = await Promise.all([store.getAll('persons'), store.getAll('measurements')]);
  } catch (err) {
    console.error(err);
    toast(T('Gerätespeicher nicht verfügbar (privates Fenster?). Messungen sofort exportieren.', 'Device storage not available (private window?). Export measurements immediately.'));
  }
  show('home');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    toast(T('Kamera nur über HTTPS verfügbar.', 'Camera only available over HTTPS.'));
  }
}
init();

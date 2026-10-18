// OKR-Schnellcheck: Asymmetrie rechts/links (und optional oben/unten) und Gain, Vergleich nur mit sich selbst.
import { DIRS, fitCalibration, analyzeBlock, summarizeQuick, median, sd, ASYM_MIN } from './analysis.js?v=2.0.3';
import { Tracker } from './tracker.js?v=2.0.3';
import { Stage, PATTERNS, COLORS } from './stage.js?v=2.0.3';
import * as store from './store.js?v=2.0.3';
import { traceChart, timelineChart, destroyAll } from './charts.js?v=2.0.3';
import { T, EN, LOCALE } from './i18n.js?v=2.0.3';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '–');
const signed = (v, d = 0) => (Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(v), d) : '–');
const dirLabel = (d) => (EN ? DIRS[d].labelEn : DIRS[d].label);
const dateStr = (iso) => new Date(iso).toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateShort = (iso) => new Date(iso).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtCi = (v) => (Number.isFinite(v) && v < 10 ? fmt(v, 1) : fmt(v, 0));
const qualityLabel = (q) => (EN ? { gut: 'good', 'mäßig': 'fair', 'ungültig': 'invalid' }[q] ?? q : q);

// ---------- Konstanten ----------
const DEVICE_PRESETS = [
  { id: 'ipad', label: 'iPad / iPad Air / iPad Pro', ppi: 132 },
  { id: 'ipadmini', label: 'iPad mini', ppi: 163 },
  { id: 'iphone', label: T('iPhone (aktuelle Modelle)', 'iPhone (current models)'), ppi: 153 },
  { id: 'iphonese', label: 'iPhone SE / mini', ppi: 163 },
  { id: 'custom', label: T('Eigener Wert', 'Custom value'), ppi: null },
];
const PATTERN_LABEL = {
  stripes: T('Streifen', 'Stripes'), symbols: T('Symbole', 'Symbols'), star: T('Stern', 'Star'), moon: T('Mond', 'Moon'), sun: T('Sonne', 'Sun'),
  fish: T('Fisch', 'Fish'), dog: T('Hund', 'Dog'), rabbit: T('Hase', 'Rabbit'), elephant: T('Elefant', 'Elephant'),
};
const COLOR_LABEL = { black: T('Schwarz', 'Black'), red: T('Rot', 'Red'), blue: T('Blau', 'Blue') };
const DEFAULT_COND = { pattern: 'stripes', color: 'black', periodDeg: 8, speeds: [8, 12], vertical: false };
const REPS = 3;               // Wiederholungen je Richtung und Geschwindigkeit
const BLOCK_SEC = 8;          // Dauer einer Runde
const PRE_SEC = 3;            // Pause mit Fixierkreuz vor jeder Runde
const CAL_DWELL = 1.8, CAL_SETTLE = 0.7;
const FACE_SPEED_LIMIT = 1.0; // Augenabstände pro Sekunde im Kamerabild → „Wackeln“
const AUTO_START_SEC = 2;     // Setup-Check: so lange alles grün → Kalibrierung startet
const INSTRUCTION = T('„Schau ganz entspannt auf das Bild. Du darfst mit den Augen mitgehen. Halte den Kopf still.“',
  '“Look at the picture in a relaxed way. You may follow it with your eyes. Keep your head still.”');

// ---------- Zustand ----------
const state = { persons: [], measurements: [], view: 'home', personId: null, calib: null, run: null };
const video = $('#cam');
const tracker = new Tracker(video, null);
const stage = new Stage($('#stage'));
const main = $('#main');

function loadDevice() {
  const s = Math.min(screen.width, screen.height);
  const dev = s < 500 ? 'iphone' : s === 744 ? 'ipadmini' : 'ipad';
  const def = { distanceCm: 40, device: dev, ppi: DEVICE_PRESETS.find((p) => p.id === dev).ppi, configured: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem('okr-device') || '{}') }; } catch { return def; }
}
let device = loadDevice();
function saveDevice() { try { localStorage.setItem('okr-device', JSON.stringify(device)); } catch { /* privat */ } }

const pxPerCm = () => device.ppi / 2.54;
// Frühere Einzelfiguren (z. B. „fish“) werden zu „Symbole“
const condOf = (p) => {
  const c = { ...DEFAULT_COND, ...(p?.condition || {}) };
  if (c.pattern !== 'stripes') c.pattern = 'symbols';
  return c;
};
const condKey = (c) => `${c.pattern}|${c.color}|${c.periodDeg}|${c.speeds.join('/')}`;
const condText = (c) => `${PATTERN_LABEL[c.pattern]} · ${COLOR_LABEL[c.color]} · ${fmt(c.periodDeg, 0)}° · ${c.speeds.join(' / ')} °/s`;

function buildPlan(c) {
  const plan = [];
  for (const speed of c.speeds) for (let rep = 1; rep <= REPS; rep++) for (const dir of ['L', 'R']) plan.push({ dir, speed, rep });
  if (c.vertical) for (const speed of c.speeds) for (let rep = 1; rep <= REPS; rep++) for (const dir of ['U', 'D']) plan.push({ dir, speed, rep });
  return plan;
}

// ---------- Hilfen ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
const personById = (id) => state.persons.find((p) => p.id === id);
function slug(s) { return String(s).normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 30) || 'Person'; }
function stamp(iso) { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }
const isQuick = (m) => m.version >= 2;

function setView(view, html) {
  state.view = view;
  destroyAll();
  main.innerHTML = html;
  $('#back').hidden = view === 'home';
  if (view !== 'check') placeCam(false);
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
  if (!visible || !$('#cam-box')) { video.className = 'cam-off'; video.removeAttribute('style'); return; }
  const r = $('#cam-box').getBoundingClientRect();
  video.className = '';
  Object.assign(video.style, { position: 'absolute', left: `${r.left + window.scrollX}px`, top: `${r.top + window.scrollY}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '10px' });
}

$('#back').addEventListener('click', () => {
  stopTracking();
  if ((state.view === 'result' || state.view === 'check') && state.personId) showPerson(state.personId);
  else showHome();
});

// ---------- Übersicht ----------
function showHome() {
  state.personId = null;
  const counts = {};
  for (const m of state.measurements) counts[m.personId] = (counts[m.personId] || 0) + 1;
  const persons = [...state.persons].sort((a, b) => a.name.localeCompare(b.name, LOCALE));
  const preset = DEVICE_PRESETS.find((p) => p.id === device.device);
  setView('home', `
    <div class="home-head">
      <img class="logo" src="${EN ? '../' : ''}img/nlb-logo.jpg" width="150" height="58" alt="NeuroLifeBalance">
      <div><h1>${T('OKR-Schnellcheck', 'OKR quick check')}</h1>
      <p class="hint">${T('Asymmetrie und Gain des optokinetischen Reflexes, Vergleich nur mit den eigenen früheren Messungen', 'Asymmetry and gain of the optokinetic reflex, compared only with the person’s own earlier measurements')}</p></div>
    </div>
    ${device.configured ? '' : `<div class="notice row">${T('Bitte zuerst das Gerät einrichten (Abstand und Gerätetyp). Das ist nur einmal nötig.', 'Please set up the device first (distance and device type). This is only needed once.')} <button class="btn" data-act="device">${T('Gerät einrichten', 'Set up device')}</button></div>`}
    <div class="grid-2">
      <div class="panel">
        <h2>${T('Personen', 'People')}</h2>
        <form id="person-form" class="row">
          <label for="person-name" class="sr">${T('Pseudonym oder Kürzel', 'Pseudonym or code')}</label>
          <input id="person-name" placeholder="${T('Pseudonym oder Kürzel, z. B. P01', 'Pseudonym or code, e.g. P01')}" autocomplete="off" maxlength="40" required>
          <button class="btn" type="submit">${T('Anlegen', 'Add')}</button>
        </form>
        <ul class="list">${persons.length ? persons.map((p) => `
          <li><button class="link grow" data-person="${p.id}">
            <div class="title">${esc(p.name)}</div>
            <div class="sub">${counts[p.id] || 0} ${T('Messung(en)', 'measurement(s)')} · ${esc(condText(condOf(p)))}</div>
          </button><span class="chev" aria-hidden="true">›</span></li>`).join('')
          : `<li class="empty">${T('Noch keine Person angelegt.', 'No people yet.')}</li>`}</ul>
        <p class="hint">${T('Bitte nur Pseudonyme verwenden. Alle Daten bleiben auf diesem Gerät.', 'Please use pseudonyms only. All data stay on this device.')}</p>
      </div>
      <div class="panel">
        <h2>${T('Gerät und Daten', 'Device and data')}</h2>
        <dl class="kv">
          <dt>${T('Abstand', 'Distance')}</dt><dd>${device.distanceCm} cm</dd>
          <dt>${T('Gerät', 'Device')}</dt><dd>${esc(preset?.label ?? '')} (${device.ppi})</dd>
        </dl>
        <div class="row" style="margin-top:12px">
          <button class="btn" data-act="device">${T('Gerät einrichten', 'Set up device')}</button>
          <label class="btn ghost" for="import-file">${T('Importieren', 'Import')}</label>
          <input id="import-file" type="file" accept=".json,application/json" multiple hidden>
          <button class="btn ghost" data-act="export-all">${T('Alle exportieren', 'Export all')}</button>
        </div>
        <h3 style="margin-top:18px">${T('Ablauf', 'Procedure')}</h3>
        <ol class="steps">
          <li>${T('Person wählen, Anweisung vorlesen, „Messung starten“.', 'Choose the person, read out the instruction, “Start measurement”.')}</li>
          <li>${T('Setup-Check: Sobald alles grün ist, startet die Kalibrierung automatisch.', 'Setup check: as soon as everything is green, calibration starts automatically.')}</li>
          <li>${T('Kalibrierung: dem Hasen mit den Augen folgen.', 'Calibration: follow the rabbit with the eyes.')}</li>
          <li>${T('Messung: ← → im Wechsel, je 3-mal bei 2 Geschwindigkeiten (optional auch ↑ ↓). Antippen pausiert.', 'Measurement: ← → alternating, 3 times each at 2 speeds (optionally also ↑ ↓). Tap to pause.')}</li>
          <li>${T('Ergebnis: Asymmetrie und Gain, Verlauf bei der Person.', 'Result: asymmetry and gain, history for the person.')}</li>
        </ol>
        <p class="hint">${T('Safari kann Website-Daten nach längerer Nichtnutzung löschen. Bitte regelmäßig exportieren.', 'Safari may delete website data after a long period of non-use. Please export regularly.')}</p>
      </div>
    </div>`);

  $('#person-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#person-name').value.trim();
    if (!name) return;
    if (state.persons.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast(T(`„${name}“ gibt es schon.`, `“${name}” already exists.`)); return; }
    const p = { id: store.uid(), name, createdAt: new Date().toISOString(), condition: { ...DEFAULT_COND } };
    await store.put('persons', p); state.persons.push(p);
    showHome();
  });
  $('#import-file').addEventListener('change', importFiles);
  main.onclick = (e) => {
    const pid = e.target.closest('[data-person]')?.dataset.person;
    if (pid) return showPerson(pid);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'device') showDevice();
    if (act === 'export-all') exportAll();
  };
  $('#topmeta').textContent = '';
}

// ---------- Geräte-Einrichtung (einmalig) ----------
function showDevice() {
  setView('device', `
    <div class="panel narrow">
      <h2>${T('Gerät einrichten', 'Set up device')}</h2>
      <p class="hint">${T('Einmalig durch die Therapeutin oder den Therapeuten. Gemessen wird immer mit dem iPad quer im Ständer.', 'Done once by the therapist. Measurements are always taken with the iPad in landscape in a stand.')}</p>
      <form id="device-form" class="form">
        <div class="field"><label for="distance">${T('Abstand Auge–Bildschirm', 'Distance eye–screen')}</label>
          <div class="unit"><input id="distance" type="number" inputmode="decimal" min="20" max="80" step="1" value="${device.distanceCm}"><span>cm</span></div></div>
        <div class="field"><label for="device">${T('Gerät', 'Device')}</label>
          <select id="device">${DEVICE_PRESETS.map((p) => `<option value="${p.id}" ${p.id === device.device ? 'selected' : ''}>${esc(p.label)}${p.ppi ? ` (${p.ppi})` : ''}</option>`).join('')}</select></div>
        <div class="field" id="ppi-field" ${device.device === 'custom' ? '' : 'hidden'}><label for="ppi">${T('Bildpunkte pro Zoll', 'Points per inch')}</label>
          <div class="unit"><input id="ppi" type="number" min="80" max="300" step="1" value="${device.ppi}"><span>pt/in</span></div></div>
        <p class="hint">${T('Den Abstand mit Lineal oder Maßband messen und bei jeder Messung gleich halten.', 'Measure the distance with a ruler or tape measure and keep it the same for every measurement.')}</p>
        <div class="row"><button class="btn primary" type="submit">${T('Speichern', 'Save')}</button></div>
      </form>
    </div>`);
  $('#device').addEventListener('change', () => { $('#ppi-field').hidden = $('#device').value !== 'custom'; });
  $('#device-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#device').value;
    device = {
      distanceCm: Math.min(80, Math.max(20, parseFloat($('#distance').value) || 40)),
      device: id,
      ppi: DEVICE_PRESETS.find((p) => p.id === id).ppi ?? (parseFloat($('#ppi').value) || 132),
      configured: true,
    };
    saveDevice(); toast(T('Gerät gespeichert.', 'Device saved.')); showHome();
  });
  $('#topmeta').textContent = T('Gerät', 'Device');
}

// ---------- Person: Start, Bedingungen, Verlauf ----------
function measurementsOf(pid) {
  return state.measurements.filter((m) => m.personId === pid).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function showPerson(pid) {
  const p = personById(pid);
  if (!p) return showHome();
  state.personId = pid;
  const c = condOf(p);
  const all = measurementsOf(pid);
  const groups = new Map();
  for (const m of all.filter(isQuick)) {
    const k = condKey(m.condition);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const legacy = all.filter((m) => !isQuick(m));
  const curKey = condKey(c);
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === curKey ? -1 : b[0] === curKey ? 1 : 0));

  setView('person', `
    <div class="panel">
      <div class="result-head">
        <div><h2>${esc(p.name)}</h2><div class="meta">${esc(condText(c))}${c.vertical ? T(' · mit ↑ ↓', ' · with ↑ ↓') : ''}</div></div>
        <div class="row"><button class="btn primary big" data-act="start" ${device.configured ? '' : 'disabled'}>${T('Messung starten', 'Start measurement')}</button></div>
      </div>
      ${device.configured ? '' : `<p class="notice">${T('Bitte zuerst das Gerät einrichten (Übersicht).', 'Please set up the device first (overview).')}</p>`}
      <div class="instruction"><span class="k">${T('Bitte wörtlich vorlesen', 'Please read out word for word')}</span>${INSTRUCTION}</div>
      <details class="cond">
        <summary>${T('Messbedingungen ändern', 'Change measurement conditions')}</summary>
        <form id="cond-form" class="form">
          <div class="field"><label for="pattern">${T('Muster', 'Pattern')}</label>
            <select id="pattern">${PATTERNS.map((k) => `<option value="${k}" ${k === c.pattern ? 'selected' : ''}>${PATTERN_LABEL[k]}</option>`).join('')}</select></div>
          <fieldset><legend>${T('Farbe', 'Colour')}</legend><div class="seg">
            ${Object.keys(COLORS).map((k) => `<input type="radio" name="color" id="col-${k}" value="${k}" ${k === c.color ? 'checked' : ''}><label for="col-${k}"><i class="swatch" style="background:${COLORS[k]}"></i>${COLOR_LABEL[k]}</label>`).join('')}
          </div></fieldset>
          <div class="field"><label for="period">${T('Breite (Paar Farbe + Weiß)', 'Width (colour + white pair)')}</label>
            <div class="unit"><input id="period" type="number" min="2" max="20" step="0.5" value="${c.periodDeg}"><span>°</span></div></div>
          <div class="field"><label for="speed1">${T('Geschwindigkeiten', 'Speeds')}</label>
            <div class="unit"><input id="speed1" type="number" min="2" max="40" step="1" value="${c.speeds[0]}"><span>/</span><input id="speed2" type="number" min="2" max="40" step="1" value="${c.speeds[1]}" aria-label="${T('Zweite Geschwindigkeit', 'Second speed')}"><span>°/s</span></div></div>
          <label class="confirm"><input type="checkbox" id="vertical" ${c.vertical ? 'checked' : ''}> ${T('Zusätzlich senkrecht messen (↑ ↓)', 'Also measure vertically (↑ ↓)')}</label>
          <p class="hint">${T('Achtung: Messungen mit anderen Bedingungen sind nicht mit früheren vergleichbar und erscheinen im Verlauf getrennt.', 'Note: measurements with different conditions are not comparable with earlier ones and appear separately in the history.')}</p>
          <div class="row"><button class="btn" type="submit">${T('Übernehmen', 'Apply')}</button></div>
        </form>
      </details>
    </div>
    ${ordered.length ? ordered.map(([k, list], gi) => `
      <div class="panel">
        <div class="panel-head"><h3>${T('Verlauf', 'History')} · ${esc(condText(list[0].condition))}</h3>${k === curKey ? '' : `<span class="pill">${T('andere Bedingungen', 'other conditions')}</span>`}</div>
        <div class="chart-grid">
          <div class="chart-box"><canvas id="tl-h-${gi}"></canvas></div>
          <div class="chart-box"><canvas id="tl-g-${gi}"></canvas></div>
          ${list.some((m) => m.result.v) ? `<div class="chart-box"><canvas id="tl-v-${gi}"></canvas></div>` : ''}
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>${T('Datum', 'Date')}</th><th class="num">${T('Rechts/links', 'Right/left')}</th><th class="num">${T('Oben/unten', 'Up/down')}</th><th class="num">Gain</th><th></th></tr></thead>
          <tbody>${list.map((m, i) => `<tr class="clickable" data-open="${m.id}">
            <td>${dateStr(m.createdAt)}${i === 0 ? ` <span class="pill">${T('Ausgangsmessung', 'Baseline')}</span>` : ''}</td>
            <td class="num">${signed(m.result.h.mean)} %</td>
            <td class="num">${m.result.v ? `${signed(m.result.v.mean)} %` : '–'}</td>
            <td class="num">${fmt(m.result.gain)}</td><td class="chev">›</td></tr>`).join('')}</tbody>
        </table></div>
      </div>`).join('')
    : `<div class="panel"><p class="empty">${T('Noch keine Messung. „Messung starten“ tippen.', 'No measurement yet. Tap “Start measurement”.')}</p></div>`}
    ${legacy.length ? `<div class="panel"><h3>${T('Ältere Messungen (Version 1, nicht vergleichbar)', 'Older measurements (version 1, not comparable)')}</h3>
      <ul class="list">${legacy.map((m) => `<li><button class="link grow" data-open="${m.id}"><div class="title">${dateStr(m.createdAt)}</div>
      <div class="sub mono">Gain H ${fmt(m.summary?.gainH)} · V ${fmt(m.summary?.gainV)}</div></button></li>`).join('')}</ul></div>` : ''}`);

  ordered.forEach(([, list], gi) => {
    const labels = list.map((m) => dateShort(m.createdAt));
    timelineChart($(`#tl-h-${gi}`), labels, list.map((m) => m.result.h.mean), { title: T('Asymmetrie rechts/links (%)', 'Asymmetry right/left (%)'), unit: ' %', zero: true, ci: list.map((m) => m.result.h.ci) });
    timelineChart($(`#tl-g-${gi}`), labels, list.map((m) => m.result.gain), { title: 'Gain', digits: 2 });
    if ($(`#tl-v-${gi}`)) timelineChart($(`#tl-v-${gi}`), labels, list.map((m) => m.result.v?.mean), { title: T('Asymmetrie oben/unten (%)', 'Asymmetry up/down (%)'), unit: ' %', zero: true, ci: list.map((m) => m.result.v?.ci) });
  });

  $('#cond-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s1 = parseFloat($('#speed1').value), s2 = parseFloat($('#speed2').value);
    p.condition = {
      pattern: $('#pattern').value,
      color: document.querySelector('input[name="color"]:checked')?.value || 'black',
      periodDeg: Math.min(20, Math.max(2, parseFloat($('#period').value) || 8)),
      speeds: [s1 > 0 ? s1 : 8, s2 > 0 ? s2 : 12],
      vertical: $('#vertical').checked,
    };
    await store.put('persons', p);
    toast(T('Bedingungen übernommen.', 'Conditions applied.'));
    showPerson(pid);
  });
  main.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'start') return startMeasurement();
    const id = e.target.closest('[data-open]')?.dataset.open;
    if (id) showResult(state.measurements.find((m) => m.id === id));
  };
  $('#topmeta').textContent = p.name;
}

// ---------- Messung starten → Setup-Check ----------
let checkBuf = [], checkOff = null, checkTimer = null, greenSince = null;
const STATUS = { camera: T('Kamera wird gestartet …', 'Starting camera …'), model: T('Gesichtserkennung wird geladen …', 'Loading face detection …') };

function startMeasurement() {
  // Vollbild und Display-Sperre müssen direkt im Tipp angefragt werden
  const el = document.documentElement;
  (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch?.(() => {});
  navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
  const c = condOf(personById(state.personId));
  setView('check', `
    <div class="check-layout">
      <div class="cam-box" id="cam-box"><div class="cam-status" id="cam-status">${STATUS.camera}</div></div>
      <div class="panel">
        <h2>${T('Setup-Check', 'Setup check')}</h2>
        <ul class="checks" id="checks"></ul>
        <p class="hint">${T(`iPad quer im Ständer, Kamera auf Augenhöhe, Licht von vorne, Abstand ${device.distanceCm} cm.`, `iPad in landscape in a stand, camera at eye level, light from the front, distance ${device.distanceCm} cm.`)}</p>
        <p class="auto" id="auto"></p>
        <div class="row"><button id="start-calib" class="btn primary" disabled>${T('Kalibrierung jetzt starten', 'Start calibration now')}</button></div>
        <p class="hint">${esc(condText(c))}</p>
      </div>
    </div>`);
  $('#start-calib').addEventListener('click', () => beginCalibration());
  startCheck();
}

async function startCheck() {
  placeCam(true);
  checkBuf = []; greenSince = null;
  try {
    await tracker.start((code) => { const s = $('#cam-status'); if (s) { s.textContent = STATUS[code] ?? ''; s.hidden = !code; } });
  } catch (err) {
    console.error(err);
    const s = $('#cam-status');
    if (s) {
      s.hidden = false;
      s.textContent = err.name === 'NotAllowedError'
        ? T('Kein Kamerazugriff. Bitte in den Einstellungen → Safari → Kamera erlauben und Seite neu laden.', 'No camera access. Please allow the camera under Settings → Safari → Camera and reload the page.')
        : T(`Kamera oder Gesichtserkennung konnte nicht starten (${err.message || err.name}).`, `Camera or face detection could not start (${err.message || err.name}).`);
    }
    return;
  }
  checkOff?.();
  checkOff = tracker.on((s) => { checkBuf.push(s); while (checkBuf.length && s.t - checkBuf[0].t > 1.5) checkBuf.shift(); });
  clearInterval(checkTimer);
  checkTimer = setInterval(renderChecks, 250);
}

function stopCheckLoop() { checkOff?.(); checkOff = null; clearInterval(checkTimer); checkTimer = null; }
function stopTracking() { stopCheckLoop(); tracker.stop(); }

function evalChecks() {
  const faces = checkBuf.filter((s) => s.face);
  const faceFrac = checkBuf.length ? faces.length / checkBuf.length : 0;
  const items = [];
  const add = (label, status, val) => items.push({ label, status, val });
  add(T('Kamera', 'Camera'), tracker.fps >= 20 ? 'good' : tracker.fps >= 12 ? 'warn' : 'bad', `${tracker.fps} ${T('Bilder/s', 'fps')}`);
  add(T('Gesicht erkannt', 'Face detected'), faceFrac >= 0.9 ? 'good' : faceFrac >= 0.5 ? 'warn' : 'bad', pct(faceFrac));
  const open = median(faces.map((s) => s.open));
  add(T('Augen offen', 'Eyes open'), !faces.length ? 'bad' : open >= 0.18 ? 'good' : open >= 0.12 ? 'warn' : 'bad', fmt(open, 2));
  const b = tracker.brightness;
  add(T('Licht', 'Light'), b >= 70 && b <= 230 ? 'good' : b >= 45 ? 'warn' : 'bad', Number.isFinite(b) ? `${Math.round((b / 255) * 100)} %` : '–');
  if (faces.length) {
    const f = faces[faces.length - 1];
    const dx = f.cx / f.w - 0.5, dy = f.cy / f.h - 0.5;
    add(T('Gesicht mittig', 'Face centred'), Math.abs(dx) < 0.25 && Math.abs(dy) < 0.3 ? 'good' : 'bad',
      Math.abs(dx) >= 0.25 ? (dx > 0 ? T('weiter nach links', 'move left') : T('weiter nach rechts', 'move right')) : Math.abs(dy) >= 0.3 ? (dy > 0 ? T('Kamera tiefer', 'camera lower') : T('Kamera höher', 'camera higher')) : 'ok');
    const jitter = Math.max(sd(faces.map((s) => s.cx)), sd(faces.map((s) => s.cy))) / median(faces.map((s) => s.scale));
    add(T('Kopf ruhig', 'Head steady'), jitter < 0.03 ? 'good' : jitter < 0.06 ? 'warn' : 'bad', jitter < 0.03 ? T('ruhig', 'steady') : T('unruhig', 'unsteady'));
  } else {
    add(T('Gesicht mittig', 'Face centred'), 'bad', '–');
    add(T('Kopf ruhig', 'Head steady'), 'bad', '–');
  }
  return items;
}

function renderChecks() {
  if (state.view !== 'check' || !$('#checks')) return;
  const items = evalChecks();
  $('#checks').innerHTML = items.map((i) => `<li class="${i.status}"><span class="dot"></span><span>${esc(i.label)}</span><span class="val">${esc(i.val)}</span></li>`).join('');
  const ok = tracker.running && items.every((i) => i.status !== 'bad');
  $('#start-calib').disabled = !ok;
  const now = performance.now() / 1000;
  if (!ok) { greenSince = null; $('#auto').textContent = ''; return; }
  greenSince ??= now;
  const left = Math.ceil(AUTO_START_SEC - (now - greenSince));
  $('#auto').textContent = left > 0 ? T(`Alles bereit – Kalibrierung startet in ${left} s`, `All set – calibration starts in ${left} s`) : '';
  if (now - greenSince >= AUTO_START_SEC) beginCalibration();
}

// ---------- Vollbild-Ebene ----------
let wakeLock = null;
function showFs() { $('#fs').hidden = false; stage.resize(); updateRotateHint(); }
function exitFullscreen() {
  $('#fs').hidden = true; $('#hud').hidden = true; $('#overlay').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  wakeLock?.release().catch(() => {}); wakeLock = null;
  updateRotateHint();
}
function overlay(html, onclick) {
  const o = $('#overlay');
  o.innerHTML = `<div class="sheet">${html}</div>`;
  o.hidden = false;
  o.onclick = onclick || null;
}

// ---------- Kalibrierung ----------
function calSeq(vertical) {
  return vertical
    ? [[0, 0], [-1, 0], [0, 0], [1, 0], [0, 0], [0, -1], [0, 0], [0, 1], [0, 0]]
    : [[0, 0], [-1, 0], [0, 0], [1, 0], [0, 0]];
}

function beginCalibration() {
  if (state.view !== 'check') return;
  stopCheckLoop();
  state.view = 'calib';
  showFs();
  const c = condOf(personById(state.personId));
  let n = 3;
  const tick = () => {
    stage.fill();
    overlay(`<h2>${T('Gleich geht es los', 'Starting soon')}</h2><p>${T('Schau dem Hasen nach. Kopf stillhalten.', 'Follow the rabbit with your eyes. Keep your head still.')}</p><p class="big-count">${n}</p>`);
    if (n-- <= 0) { $('#overlay').hidden = true; runCalibration(c); return; }
    setTimeout(tick, 1000);
  };
  tick();
}

function runCalibration(c) {
  const seq = calSeq(c.vertical);
  const D = device.distanceCm, ppc = pxPerCm();
  const ax = (Math.atan((0.8 * stage.w) / 2 / ppc / D) * 180) / Math.PI;
  const ay = (Math.atan((0.75 * stage.h) / 2 / ppc / D) * 180) / Math.PI;
  const r1 = (v) => Math.round(v * 10) / 10 || 0;
  const cal = { points: seq.map(([x, y]) => ({ tx: r1(x * ax), ty: r1(y * ay), samples: [] })), i: 0, start: performance.now() / 1000 };
  const off = tracker.on((s) => {
    const el = s.t - cal.start - cal.i * CAL_DWELL;
    if (cal.i >= cal.points.length || el < CAL_SETTLE || el >= CAL_DWELL) return;
    cal.points[cal.i].samples.push({ fx: s.fx, fy: s.fy, valid: s.face && s.open >= 0.12, cx: s.cx, cy: s.cy, scale: s.scale, open: s.open });
  });
  const frame = () => {
    const el = performance.now() / 1000 - cal.start;
    cal.i = Math.floor(el / CAL_DWELL);
    if (cal.i >= cal.points.length) { off(); finishCalibration(cal.points, c); return; }
    const p = cal.points[cal.i];
    const x = stage.w / 2 + Math.tan((p.tx * Math.PI) / 180) * D * ppc;
    const y = stage.h / 2 + Math.tan((p.ty * Math.PI) / 180) * D * ppc;
    stage.target(x, y, (el - cal.i * CAL_DWELL) / CAL_DWELL, 'rabbit', c.color);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function issueEn(code) {
  if (code.startsWith('weak:')) {
    const [n, total] = code.slice(5).split('/');
    return `The eyes were detected too rarely at ${n} of ${total} points. Add more light, keep the face centred, remove reflective glasses if needed.`;
  }
  return {
    horizontal: 'Left/right eye movement was not detected cleanly. Follow the target with your eyes only; do not turn your head.',
    vertical: 'Up/down eye movement was not detected cleanly. Open the eyes wide enough, light from the front, keep the head straight.',
    center: 'The centre point was not looked at consistently. Please fixate each target steadily.',
    head: 'The head moved during calibration. Please keep the head still or support it.',
    'head-hand': 'The device moved during calibration.',
  }[code] ?? code;
}

function finishCalibration(points, c) {
  const res = fitCalibration(points, { mode: 'stand', vertical: c.vertical });
  stage.fill();
  if (res.ok) {
    state.calib = res;
    overlay(`<h2><span class="pill good">${T('Kalibrierung OK', 'Calibration OK')}</span></h2><p>${T('Die Messung startet gleich.', 'The measurement starts in a moment.')}</p>`);
    setTimeout(() => { $('#overlay').hidden = true; startRun(c); }, 1500);
    return;
  }
  overlay(`
    <h2><span class="pill bad">${T('Kalibrierung nicht OK', 'Calibration not OK')}</span></h2>
    <ul>${(EN ? res.codes.map(issueEn) : res.issues).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    <div class="row"><button class="btn" data-act="back">${T('Abbrechen', 'Cancel')}</button><button class="btn primary" data-act="repeat">${T('Wiederholen', 'Repeat')}</button></div>`,
  (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'repeat') { $('#overlay').hidden = true; runCalibration(c); }
    if (act === 'back') { exitFullscreen(); stopTracking(); showPerson(state.personId); }
  });
}

// ---------- Messung ----------
function startRun(c) {
  const plan = buildPlan(c).map((b) => ({ ...b, retry: false }));
  const M = state.run = {
    c, plan, i: 0, attempt: plan.map(() => 0), status: plan.map(() => 'offen'), results: plan.map(() => null),
    retried: false, phase: 'pre', phaseStart: performance.now() / 1000, paused: false, samples: [], lastFace: null,
    scaleSmooth: null, t0: performance.now() / 1000,
    periodPx: Math.max(8, 2 * Math.tan(((c.periodDeg / 2) * Math.PI) / 180) * device.distanceCm * pxPerCm()),
  };
  state.view = 'measure';
  M.off = tracker.on(onRunSample);
  stage.c.onpointerdown = () => { if (!M.paused && state.run === M) pauseRun(); };
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
  if (s.face) {
    M.lastFace = s;
    M.scaleSmooth = M.scaleSmooth == null ? s.scale : 0.9 * M.scaleSmooth + 0.1 * s.scale;
  }
  M.samples.push({
    t: s.t, block: M.i, attempt: M.attempt[M.i], phase: M.phase === 'stim' ? 1 : 0,
    valid: !!s.face && s.open >= 0.55 * state.calib.openRef, shake: faceSpeed > FACE_SPEED_LIMIT,
    fx: s.fx ?? NaN, fy: s.fy ?? NaN, scale: s.scale ?? NaN,
  });
}

// Hinweis, wenn sich der Abstand gegenüber der Kalibrierung deutlich ändert (Gesicht größer = näher)
function distanceHint(M) {
  const r = M.scaleSmooth / state.calib.scale0;
  if (!Number.isFinite(r)) return '';
  if (r > 1.15) return T(' · bitte etwas weiter weg', ' · please move back a little');
  if (r < 0.87) return T(' · bitte etwas näher', ' · please come a little closer');
  return '';
}

function runFrame() {
  const M = state.run;
  if (!M || M.paused) return;
  const now = performance.now() / 1000;
  const el = now - M.phaseStart;
  const b = M.plan[M.i], dir = DIRS[b.dir];
  const left = M.plan.length - M.i;
  const rounds = T(`noch ${left} Runden`, `${left} rounds left`);
  $('#hud').textContent = `${dir.arrow} ${b.speed} °/s · ${rounds}${distanceHint(M)}`;
  if (M.phase === 'pre') {
    stage.fixation(dir.arrow, `${dirLabel(b.dir)} · ${b.speed} °/s`, rounds, { done: M.i, total: M.plan.length });
    if (el >= PRE_SEC) { M.phase = 'stim'; M.phaseStart = now; }
  } else {
    const speedPx = ((b.speed * Math.PI) / 180) * device.distanceCm * pxPerCm();
    stage.pattern(M.c.pattern, M.c.color, dir.axis, dir.sign * speedPx * el, M.periodPx, dir.sign);
    if (el >= BLOCK_SEC) { endBlock(); return; }
  }
  requestAnimationFrame(runFrame);
}

function analyzeRunBlock(M, i) {
  const b = M.plan[i], att = M.attempt[i], dir = DIRS[b.dir], cal = state.calib;
  const ss = M.samples.filter((x) => x.block === i && x.attempt === att && x.phase === 1);
  const deg = (x) => (dir.axis === 'x' ? cal.ax + cal.bx * x.fx : cal.ay + cal.by * x.fy);
  const scaleMed = median(ss.filter((x) => x.valid).map((x) => x.scale));
  // Näher am Gerät → Gesicht größer → Muster läuft in Grad schneller
  const speedEff = Number.isFinite(scaleMed) && cal.scale0 > 0 ? (b.speed * scaleMed) / cal.scale0 : b.speed;
  const r = analyzeBlock({
    t: ss.map((x) => x.t), p: ss.map((x) => (x.valid ? deg(x) * dir.sign : NaN)),
    valid: ss.map((x) => x.valid), shake: ss.map((x) => x.shake),
  }, speedEff);
  return { dir: b.dir, speed: b.speed, rep: b.rep, retry: b.retry, speedEff, attempt: att, planIdx: i, ...r };
}

function endBlock() {
  const M = state.run;
  M.status[M.i] = 'fertig';
  M.results[M.i] = analyzeRunBlock(M, M.i);
  nextBlock();
}

function nextBlock() {
  const M = state.run;
  M.i++;
  if (M.i >= M.plan.length && !M.retried) {
    // Ungültige Runden einmal automatisch am Ende wiederholen
    M.retried = true;
    const bad = M.plan.filter((b, i) => !b.retry && M.results[i]?.quality === 'ungültig');
    for (const b of bad) { M.plan.push({ ...b, retry: true }); M.attempt.push(0); M.status.push('offen'); M.results.push(null); }
  }
  if (M.i >= M.plan.length) { finishRun(); return; }
  M.phase = 'pre'; M.phaseStart = performance.now() / 1000; M.paused = false;
  requestAnimationFrame(runFrame);
}

function pauseRun() {
  const M = state.run;
  M.paused = true;
  stage.fill();
  overlay(`
    <h2>${T('Pausiert', 'Paused')}</h2>
    <p>${T(`Runde ${M.i + 1} von ${M.plan.length}. Die unterbrochene Runde startet beim Fortsetzen neu.`, `Round ${M.i + 1} of ${M.plan.length}. The interrupted round restarts when you resume.`)}</p>
    <div class="row"><button class="btn danger" data-act="end">${T('Messung beenden', 'End measurement')}</button><button class="btn primary" data-act="resume">${T('Fortsetzen', 'Resume')}</button></div>`,
  (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    $('#overlay').hidden = true;
    if (act === 'resume') {
      M.attempt[M.i]++; M.phase = 'pre'; M.phaseStart = performance.now() / 1000; M.paused = false;
      requestAnimationFrame(runFrame);
    }
    if (act === 'end') finishRun();
  });
}

// Je Richtung/Geschwindigkeit/Runde ein Ergebnis: eine gültige Wiederholung ersetzt ein ungültiges Original
function finalBlocks(M) {
  const best = new Map();
  for (const r of M.results) {
    if (!r) continue;
    const k = `${r.dir}|${r.speed}|${r.rep}`;
    const prev = best.get(k);
    if (!prev || (prev.quality === 'ungültig' && r.quality !== 'ungültig')) best.set(k, r);
  }
  return [...best.values()];
}

async function finishRun() {
  const M = state.run;
  M.off?.(); stage.c.onpointerdown = null; state.run = null;
  exitFullscreen(); stopTracking();
  const blocks = finalBlocks(M);
  const p = personById(state.personId);
  if (!blocks.length) { toast(T('Messung beendet, keine Runde abgeschlossen. Nichts gespeichert.', 'Measurement ended, no round completed. Nothing saved.')); showPerson(p.id); return; }
  const cal = state.calib;
  const used = new Set(blocks.map((b) => `${b.planIdx}|${b.attempt}`));
  const keep = M.samples.filter((x) => used.has(`${x.block}|${x.attempt}`));
  const r = (v, d) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
  const m = {
    format: 'nlb-okr-measurement', version: 2, id: store.uid(), personId: p.id, personName: p.name,
    createdAt: new Date().toISOString(),
    condition: { ...M.c, speeds: [...M.c.speeds] },
    device: { ...device, screen: [stage.w, stage.h], userAgent: navigator.userAgent },
    protocol: { reps: REPS, blockSec: BLOCK_SEC, preSec: PRE_SEC },
    calibration: { ax: cal.ax, bx: cal.bx, ay: cal.ay, by: cal.by, r2x: cal.r2x, r2y: cal.r2y, sepX: cal.sepX, sepY: cal.sepY, scale0: cal.scale0, openRef: cal.openRef, points: cal.points },
    plan: M.plan.map((b, i) => ({ ...b, status: M.status[i] })),
    blocks,
    result: summarizeQuick(blocks),
    raw: {
      fields: ['t', 'block', 'attempt', 'phase', 'valid', 'shake', 'ex', 'ey', 'scale'],
      note: 't in s ab Messbeginn; ex/ey Augenposition in Grad (+ = rechts/unten); scale = Augenabstand im Kamerabild (px)',
      rows: keep.map((x) => [r(x.t - M.t0, 3), x.block, x.attempt, x.phase, x.valid ? 1 : 0, x.shake ? 1 : 0,
        x.valid ? r(cal.ax + cal.bx * x.fx, 2) : null, x.valid && M.c.vertical ? r(cal.ay + cal.by * x.fy, 2) : null, r(x.scale, 1)]),
    },
  };
  try { await store.put('measurements', m); } catch (err) { console.error(err); toast(T('Speichern im Browser fehlgeschlagen. Bitte sofort exportieren.', 'Saving in the browser failed. Please export immediately.')); }
  state.measurements.push(m);
  showResult(m, true);
}

// ---------- Ergebnis ----------
function baselineOf(m) {
  return measurementsOf(m.personId).filter((x) => isQuick(x) && condKey(x.condition) === condKey(m.condition))[0];
}

function rlText(h) {
  if (!h || h.n < 2) return { cls: 'warn', title: T('Rechts/links: keine Aussage', 'Right/left: no statement'), body: T('Zu wenige gültige Runden für eine Aussage. Bitte Messung wiederholen.', 'Too few valid rounds for a statement. Please repeat the measurement.') };
  const v = `${signed(h.mean)} %`, ci = `± ${fmtCi(h.ci)} %`;
  const weakRight = h.mean < 0;
  if (h.verdict === 'deutlich') {
    return {
      cls: 'bad',
      title: T(`Richtungsunterschied: ${weakRight ? 'rechts' : 'links'} schwächer`, `Direction difference: ${weakRight ? 'right' : 'left'} weaker`),
      body: T(
        `${v}, deutlich über der Messschwankung (${ci}): Nach ${weakRight ? 'rechts' : 'links'} laufende Muster wurden schwächer verfolgt. Dieses Muster entspricht Läsionsstudien, in denen der OKN zur Seite einer ${weakRight ? 'rechtsseitigen' : 'linksseitigen'} Hirnschädigung schwächer war. Ob es bei dieser Person dieselbe Ursache hat, kann die Messung nicht zeigen. Kleine Unterschiede können auch gerätebedingt sein.`,
        `${v}, clearly above the measurement fluctuation (${ci}): patterns moving ${weakRight ? 'right' : 'left'} were followed less well. This pattern matches lesion studies in which OKN towards the side of ${weakRight ? 'right' : 'left'}-sided brain damage was weaker. Whether this person has the same cause cannot be shown by the measurement. Small differences can also be caused by the device.`),
    };
  }
  if (h.verdict === 'gering') {
    return { cls: 'good', title: T('Kein deutlicher Richtungsunterschied', 'No clear direction difference'),
      body: T(`${v} (Messschwankung ${ci}). Unterschiede unter ${ASYM_MIN} % wertet die App nicht als auffällig.`, `${v} (measurement fluctuation ${ci}). The app does not rate differences below ${ASYM_MIN} % as notable.`) };
  }
  return { cls: 'warn', title: T('Richtungsunterschied unklar', 'Direction difference unclear'),
    body: T(`${v}, aber die Messschwankung ist mit ${ci} zu groß für eine sichere Aussage. Bitte Messung wiederholen.`, `${v}, but the measurement fluctuation of ${ci} is too large for a reliable statement. Please repeat the measurement.`) };
}

function changeLine(cur, base, unit, digits, isBase) {
  if (isBase) return T('Dies ist die Ausgangsmessung. Aussagekräftig ist die Veränderung bei späteren Messungen.', 'This is the baseline measurement. What matters is the change in later measurements.');
  if (!Number.isFinite(cur) || !Number.isFinite(base)) return '';
  return T(`Veränderung zur Ausgangsmessung: ${signed(cur - base, digits)}${unit}`, `Change from baseline: ${signed(cur - base, digits)}${unit}`);
}

function showResult(m, fresh = false) {
  if (!m) return;
  if (!isQuick(m)) return showLegacy(m);
  state.personId = m.personId;
  const res = m.result;
  const base = baselineOf(m);
  const isBase = !base || base.id === m.id;
  const rl = rlText(res.h);
  const v = res.v;
  const vText = v && v.n >= 2
    ? T(`${v.mean >= 0 ? 'Oben' : 'Unten'} stärker (Messschwankung ± ${fmtCi(v.ci)} %). Ein Vorteil nach oben ist bei Gesunden häufig, und senkrechte Unterschiede sind individuell verschieden. Aussagekräftig ist die Veränderung gegenüber den eigenen früheren Messungen.`,
      `${v.mean >= 0 ? 'Up' : 'Down'} stronger (measurement fluctuation ± ${fmtCi(v.ci)} %). An upward advantage is common in healthy people, and vertical differences vary between individuals. What matters is the change compared with the person’s own earlier measurements.`)
    : T('Zu wenige gültige Runden.', 'Too few valid rounds.');
  const blocks = [...m.blocks].sort((a, b) => 'LRUD'.indexOf(a.dir) - 'LRUD'.indexOf(b.dir) || a.speed - b.speed || a.rep - b.rep);
  const pp = T(' Prozentpunkte', ' percentage points');

  setView('result', `
    <div class="panel">
      <div class="result-head">
        <div><h2>${esc(m.personName)}</h2>
        <div class="meta">${dateStr(m.createdAt)} · ${esc(condText(m.condition))}${isBase ? ` · ${T('Ausgangsmessung', 'Baseline')}` : ` · ${T('Ausgangsmessung', 'Baseline')}: ${dateShort(base.createdAt)}`}</div></div>
        <div class="row"><button class="btn danger" data-act="delete">${T('Löschen', 'Delete')}</button><button class="btn primary" data-act="export">${T('Exportieren', 'Export')}</button></div>
      </div>
      ${fresh ? `<p class="hint">${T('Gespeichert auf diesem Gerät. Zum Sichern „Exportieren“ tippen.', 'Saved on this device. To back it up, tap “Export”.')}</p>` : ''}
      <div id="del-confirm" class="notice" hidden>${T('Diese Messung wirklich löschen? Exportierte Dateien bleiben erhalten.', 'Really delete this measurement? Exported files are kept.')}
        <div class="row" style="margin-top:8px"><button class="btn" data-act="del-no">${T('Behalten', 'Keep')}</button><button class="btn danger" data-act="del-yes">${T('Endgültig löschen', 'Delete permanently')}</button></div></div>
    </div>
    <div class="result-tiles">
      <div class="panel rtile ${rl.cls}">
        <div class="k">${T('Asymmetrie rechts/links', 'Asymmetry right/left')}</div>
        <div class="v">${signed(res.h.mean)} %</div>
        <h3>${esc(rl.title)}</h3><p>${esc(rl.body)}</p>
        <p class="hint">${esc(changeLine(res.h.mean, base?.result.h.mean, pp, 0, isBase))}</p>
      </div>
      ${v ? `<div class="panel rtile">
        <div class="k">${T('Asymmetrie oben/unten', 'Asymmetry up/down')}</div>
        <div class="v">${signed(v.mean)} %</div>
        <p>${esc(vText)}</p>
        <p class="hint">${esc(changeLine(v.mean, base?.result.v?.mean, pp, 0, isBase))}</p>
      </div>` : ''}
      <div class="panel rtile">
        <div class="k">Gain</div>
        <div class="v">${fmt(res.gain)}</div>
        <p>${T('Wie schnell die Augen dem Muster folgen (1,0 = gleich schnell). Nur mit eigenen Messungen unter gleichen Bedingungen vergleichbar.', 'How fast the eyes follow the pattern (1.0 = equally fast). Only comparable with the person’s own measurements under the same conditions.')}</p>
        <p class="sub mono">← ${fmt(res.gainByDir.L)} · → ${fmt(res.gainByDir.R)}${v ? ` · ↑ ${fmt(res.gainByDir.U)} · ↓ ${fmt(res.gainByDir.D)}` : ''}</p>
        <p class="hint">${esc(changeLine(res.gain, base?.result.gain, '', 2, isBase))}</p>
      </div>
    </div>
    <details class="panel" id="details">
      <summary>${T('Details: einzelne Runden', 'Details: individual rounds')} (${res.validBlocks}/${res.totalBlocks} ${T('gültig', 'valid')})</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>${T('Richtung', 'Direction')}</th><th class="num">°/s</th><th class="num">${T('Runde', 'Round')}</th><th class="num">Gain</th><th class="num">${T('Augen erkannt', 'Eyes detected')}</th><th class="num">${T('Wackeln', 'Shaking')}</th><th>${T('Qualität', 'Quality')}</th></tr></thead>
        <tbody>${blocks.map((b) => `<tr><td>${DIRS[b.dir].arrow} ${dirLabel(b.dir)}</td><td class="num">${b.speed}</td><td class="num">${b.rep}${b.retry ? '*' : ''}</td>
          <td class="num">${fmt(b.gain)}</td><td class="num">${pct(b.validPct)}</td><td class="num">${pct(b.shakePct)}</td>
          <td><span class="pill ${b.quality === 'gut' ? 'good' : b.quality === 'mäßig' ? 'warn' : 'bad'}">${esc(qualityLabel(b.quality))}</span></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">${T('* automatisch wiederholte Runde. Asymmetrie je Runde: (rechts − links) ÷ Mittelwert; Messschwankung = 95-%-Vertrauensbereich aus den Wiederholungen.', '* automatically repeated round. Asymmetry per round: (right − left) ÷ mean; measurement fluctuation = 95 % confidence interval from the repetitions.')}</p>
      <div class="panel-head" style="margin-top:12px"><h3>${T('Augenbewegung in einer Runde', 'Eye movement in one round')}</h3>
        <select id="trace-block" aria-label="${T('Runde', 'Round')}">${blocks.map((b) => `<option value="${m.blocks.indexOf(b)}">${DIRS[b.dir].arrow} ${b.speed} °/s · ${T('Runde', 'round')} ${b.rep}</option>`).join('')}</select></div>
      <div class="chart-box"><canvas id="trace-canvas"></canvas></div>
    </details>`);

  const drawTrace = () => {
    const b = m.blocks[+$('#trace-block').value];
    if (!b) return;
    const F = Object.fromEntries(m.raw.fields.map((f, i) => [f, i]));
    const rows = m.raw.rows.filter((row) => row[F.block] === b.planIdx && row[F.attempt] === b.attempt && row[F.phase] === 1);
    const ax = DIRS[b.dir].axis === 'x' ? F.ex : F.ey;
    const t0 = rows[0]?.[F.t] ?? 0;
    traceChart($('#trace-canvas'), rows.map((row) => ({ x: row[F.t] - t0, y: row[ax] })),
      DIRS[b.dir].axis === 'x' ? T('Auge horizontal (°, + = rechts)', 'Eye horizontal (°, + = right)') : T('Auge vertikal (°, + = unten)', 'Eye vertical (°, + = down)'));
  };
  $('#trace-block').addEventListener('change', drawTrace);
  $('#details').addEventListener('toggle', (e) => { if (e.target.open) drawTrace(); });

  main.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') exportMeasurement(m);
    if (act === 'delete') $('#del-confirm').hidden = false;
    if (act === 'del-no') $('#del-confirm').hidden = true;
    if (act === 'del-yes') {
      await store.remove('measurements', m.id);
      state.measurements = state.measurements.filter((x) => x.id !== m.id);
      toast(T('Messung gelöscht.', 'Measurement deleted.'));
      showPerson(m.personId);
    }
  };
  $('#topmeta').textContent = m.personName;
}

function showLegacy(m) {
  state.personId = m.personId;
  const s = m.summary || {};
  setView('result', `<div class="panel">
    <h2>${esc(m.personName)} · ${dateStr(m.createdAt)}</h2>
    <p class="notice">${T('Messung aus Version 1 der App (anderer Ablauf). Nicht mit Schnellcheck-Messungen vergleichbar.', 'Measurement from version 1 of the app (different procedure). Not comparable with quick-check measurements.')}</p>
    <dl class="kv"><dt>Gain H</dt><dd>${fmt(s.gainH)}</dd><dt>Gain V</dt><dd>${fmt(s.gainV)}</dd>
    <dt>${T('Asymmetrie R/L', 'Asymmetry R/L')}</dt><dd>${signed(s.asymH)} %</dd><dt>${T('Asymmetrie O/U', 'Asymmetry U/D')}</dt><dd>${signed(s.asymV)} %</dd></dl>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="export">${T('Exportieren', 'Export')}</button></div></div>`);
  main.onclick = (e) => { if (e.target.closest('[data-act]')?.dataset.act === 'export') exportMeasurement(m); };
  $('#topmeta').textContent = m.personName;
}

// ---------- Export / Import ----------
const CSV_SEP = EN ? ',' : ';';
function csvFor(list) {
  const n = (v, d = 3) => (Number.isFinite(v) ? (EN ? v.toFixed(d) : v.toFixed(d).replace('.', ',')) : '');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const cols = EN
    ? ['Person', 'Date', 'Pattern', 'Colour', 'Width °', 'Direction', 'Speed °/s', 'Round', 'Gain', 'Eyes detected %', 'Shaking %', 'Quality', 'Asymmetry R/L %', 'Asymmetry U/D %', 'Gain (mean)']
    : ['Person', 'Datum', 'Muster', 'Farbe', 'Breite °', 'Richtung', 'Geschwindigkeit °/s', 'Runde', 'Gain', 'Augen erkannt %', 'Wackeln %', 'Qualität', 'Asymmetrie R/L %', 'Asymmetrie O/U %', 'Gain (Mittel)'];
  const rows = [cols.map(q).join(CSV_SEP)];
  for (const m of list.filter(isQuick)) {
    for (const b of m.blocks) {
      rows.push([q(m.personName), q(dateStr(m.createdAt)), q(PATTERN_LABEL[m.condition.pattern]), q(COLOR_LABEL[m.condition.color]), n(m.condition.periodDeg, 1),
        q(dirLabel(b.dir)), n(b.speed, 1), b.rep, n(b.gain), n(b.validPct * 100, 0), n(b.shakePct * 100, 0), q(qualityLabel(b.quality)),
        n(m.result.h.mean, 1), n(m.result.v?.mean, 1), n(m.result.gain)].join(CSV_SEP));
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

function exportAll() {
  if (!state.measurements.length) { toast(T('Es gibt noch keine Messungen.', 'There are no measurements yet.')); return; }
  const now = new Date().toISOString();
  const bundle = { format: 'nlb-okr-bundle', version: 2, exportedAt: now, persons: state.persons, measurements: state.measurements };
  store.offerFiles([
    { name: `OKR_${T('Alle', 'All')}_${stamp(now)}.json`, type: 'application/json', text: JSON.stringify(bundle) },
    { name: `OKR_${T('Alle', 'All')}_${stamp(now)}.csv`, type: 'text/csv', text: csvFor(state.measurements) },
  ]).then((r) => r !== 'aborted' && toast(T('Export bereitgestellt.', 'Export ready.')));
}

async function importFiles(e) {
  let added = 0, skipped = 0;
  for (const file of e.target.files) {
    try {
      const data = JSON.parse(await store.readFile(file));
      const list = data.format === 'nlb-okr-bundle' ? data.measurements : data.format === 'nlb-okr-measurement' ? [data] : [];
      for (const p of (data.format === 'nlb-okr-bundle' ? data.persons : [])) {
        if (!state.persons.some((x) => x.id === p.id)) { await store.put('persons', p); state.persons.push(p); }
      }
      for (const m of list) {
        if (state.measurements.some((x) => x.id === m.id)) { skipped++; continue; }
        if (!state.persons.some((x) => x.id === m.personId)) {
          const p = { id: m.personId, name: m.personName, createdAt: m.createdAt, condition: m.condition || { ...DEFAULT_COND } };
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
  showHome();
  if (added || skipped) toast(T(`${added} Messung(en) importiert${skipped ? `, ${skipped} schon vorhanden` : ''}.`, `${added} measurement(s) imported${skipped ? `, ${skipped} already present` : ''}.`));
}

// ---------- Start ----------
async function init() {
  try {
    [state.persons, state.measurements] = await Promise.all([store.getAll('persons'), store.getAll('measurements')]);
  } catch (err) {
    console.error(err);
    toast(T('Gerätespeicher nicht verfügbar (privates Fenster?). Messungen sofort exportieren.', 'Device storage not available (private window?). Export measurements immediately.'));
  }
  showHome();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) toast(T('Kamera nur über HTTPS verfügbar.', 'Camera only available over HTTPS.'));
}
init();

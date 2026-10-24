// Eye Reflex Lab: Asymmetrie rechts/links (und optional oben/unten) und Gain des optokinetischen Reflexes.
// Zwei Versionen: Freemium (messen, nichts speichern) und Studien (Teilnehmende, Messreihen, Export/Import), siehe edition.js.
import { DIRS, fitCalibration, analyzeBlock, summarizeQuick, median, sd, ASYM_MIN } from './analysis.js?v=2.4.1';
import { Tracker } from './tracker.js?v=2.4.1';
import { Stage, PATTERNS, COLORS } from './stage.js?v=2.4.1';
import * as store from './store.js?v=2.4.1';
import { traceChart, timelineChart, destroyAll } from './charts.js?v=2.4.1';
import { t, ltr, LANG, LANGS, LOCALE, setLang } from './i18n.js?v=2.4.1';
import { isStudy, unlockInfo, tryUnlock, lapsed, PURCHASE_URL } from './edition.js?v=2.4.1';
import { encodeFrames, N_VALUES } from './eyetrace.js?v=2.4.1';
import { createEyeTrace } from './eyeview.js?v=2.4.1';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '–');
const signed = (v, d = 0) => (Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(v), d) : '–');
const dirLabel = (d) => t(`dir_${d}`);
const dateStr = (iso) => new Date(iso).toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateShort = (iso) => new Date(iso).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtCi = (v) => (Number.isFinite(v) && v < 10 ? fmt(v, 1) : fmt(v, 0));
// Plattform: iPadOS meldet sich als Mac, deshalb zusätzlich die Touchpunkte prüfen
const UA = navigator.userAgent;
const IS_ANDROID = /Android/i.test(UA);
const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Qualität wird intern deutsch gespeichert (gut/mäßig/ungültig), angezeigt in der gewählten Sprache
const qualityLabel = (q) => t({ gut: 'quality_good', 'mäßig': 'quality_fair', 'ungültig': 'quality_invalid' }[q] ?? q);

// ---------- Konstanten ----------
const DEVICE_PRESETS = [
  { id: 'ipad', label: 'iPad / iPad Air / iPad Pro', ppi: 132 },
  { id: 'ipadmini', label: 'iPad mini', ppi: 163 },
  { id: 'iphone', label: t('iphone_current_models'), ppi: 153 },
  { id: 'iphonese', label: 'iPhone SE / mini', ppi: 163 },
  { id: 'card', label: t('device_card'), ppi: null },
  { id: 'custom', label: t('custom_value'), ppi: null },
];
// Karte im Scheckkartenformat nach ISO/IEC 7810 ID-1
const CARD_MM = { w: 85.6, h: 53.98, r: 3.18 };
const CSS_PPI_ANDROID = 160; // Startwert für den Abgleich (Android-Bezugsdichte)
const PATTERN_LABEL = {
  stripes: t('pattern_stripes'), symbols: t('pattern_symbols'), star: t('shape_star'), moon: t('shape_moon'), sun: t('shape_sun'),
  fish: t('shape_fish'), dog: t('shape_dog'), rabbit: t('shape_rabbit'), elephant: t('shape_elephant'),
};
const COLOR_LABEL = { black: t('colour_black'), red: t('colour_red'), blue: t('colour_blue') };
const DEFAULT_COND = { pattern: 'stripes', color: 'black', periodDeg: 8, speeds: [8, 12], vertical: false };
const REPS = 3;               // Wiederholungen je Richtung und Geschwindigkeit
const BLOCK_SEC = 8;          // Dauer einer Runde
const PRE_SEC = 3;            // Pause mit Fixierkreuz vor jeder Runde
const CAL_DWELL = 1.8, CAL_SETTLE = 0.7;
const FACE_SPEED_LIMIT = 1.0; // Augenabstände pro Sekunde im Kamerabild → „Wackeln“
const AUTO_START_SEC = 2;     // Setup-Check: so lange alles grün → Kalibrierung startet
const INSTRUCTION = t('instruction');

// ---------- Zustand ----------
const state = { persons: [], measurements: [], view: 'home', personId: null, calib: null, run: null, freeCond: null };
const FREE_ID = 'free'; // Freemium: Messung ohne Teilnehmende, wird nicht gespeichert
const video = $('#cam');
const tracker = new Tracker(video, null);
const stage = new Stage($('#stage'));
const main = $('#main');

function loadDevice() {
  const s = Math.min(screen.width, screen.height);
  // Android: zu viele Geräte für feste Werte, deshalb immer Karten-Abgleich
  const dev = IS_ANDROID ? 'card' : s < 500 ? 'iphone' : s === 744 ? 'ipadmini' : 'ipad';
  const def = { distanceCm: 40, device: dev, ppi: DEVICE_PRESETS.find((p) => p.id === dev).ppi ?? CSS_PPI_ANDROID, configured: false };
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
// Freemium: Bedingungen nur für diese Sitzung; Studien: je Teilnehmende gespeichert
const currentCond = () => (isStudy() ? condOf(personById(state.personId)) : condOf({ condition: state.freeCond }));
const condKey = (c) => `${c.pattern}|${c.color}|${c.periodDeg}|${c.speeds.join('/')}`;
const condText = (c) => `${PATTERN_LABEL[c.pattern]} · ${COLOR_LABEL[c.color]} · ${ltr(`${fmt(c.periodDeg, 0)}° · ${c.speeds.join(' / ')} °/s`)}`;

function buildPlan(c) {
  const plan = [];
  for (const speed of c.speeds) for (let rep = 1; rep <= REPS; rep++) for (const dir of ['L', 'R']) plan.push({ dir, speed, rep });
  if (c.vertical) for (const speed of c.speeds) for (let rep = 1; rep <= REPS; rep++) for (const dir of ['U', 'D']) plan.push({ dir, speed, rep });
  return plan;
}

// ---------- Hilfen ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
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
let cardRedraw = null;
window.addEventListener('resize', () => {
  updateRotateHint();
  if (state.view === 'check') placeCam(true);
  cardRedraw?.();
});
window.visualViewport?.addEventListener('resize', () => cardRedraw?.());

// Android/Chrome: eigene Schaltfläche „App installieren“ statt der Leiste des Browsers
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (state.view === 'home') showHome(); });
window.addEventListener('appinstalled', () => { installPrompt = null; if (state.view === 'home') showHome(); });
function installHtml() {
  if (installPrompt) return `<div class="row" style="margin-top:12px"><button class="btn" data-act="install">${t('install_app')}</button></div>`;
  if (isInstalled()) return '';
  if (IS_ANDROID) return `<p class="hint">${t('install_hint_android')}</p>`;
  if (IS_IOS) return `<p class="hint">${t('install_hint_ios')}</p>`;
  return '';
}

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
const dateLong = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });

// Version anzeigen; in Freemium mit Feld für den Freischalt-Code
function editionHtml() {
  const info = unlockInfo();
  if (info) {
    return `<div class="panel">
      <h2>${t('edition_label')}: ${t('edition_study')}</h2>
      <p class="hint">${t('edition_study_desc')}</p>
      <p class="hint">${info.validUntil ? t('unlock_active_until', { date: dateLong(info.validUntil) }) : t('unlock_active')}</p>
    </div>`;
  }
  return `<div class="panel">
      <h2>${t('edition_label')}: ${t('edition_free')}</h2>
      <p class="hint">${t('edition_free_desc')}</p>
      ${lapsed ? `<p class="notice">${t('unlock_expired')}</p>` : ''}
      <h3 style="margin-top:16px">${t('unlock_title')}</h3>
      <p class="hint" style="margin-top:0">${t('edition_study_desc')}</p>
      <form id="unlock-form" class="row" style="margin-top:10px">
        <label for="unlock-code" class="sr">${t('unlock_code')}</label>
        <input id="unlock-code" placeholder="${t('unlock_code')}" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" required>
        <button class="btn" type="submit">${t('unlock_button')}</button>
      </form>
      ${PURCHASE_URL ? `<p style="margin-top:10px"><a class="btn ghost" href="${esc(PURCHASE_URL)}" target="_blank" rel="noopener">${t('unlock_get')}</a></p>` : ''}
    </div>`;
}

function deviceHtml(extraButtons = '') {
  const preset = DEVICE_PRESETS.find((p) => p.id === device.device);
  return `<dl class="kv">
          <dt>${t('distance')}</dt><dd>${device.distanceCm} cm</dd>
          <dt>${t('device')}</dt><dd>${esc(preset?.label ?? '')} (${Math.round(device.ppi)})</dd>
        </dl>
        <div class="row" style="margin-top:12px">
          <button class="btn" data-act="device">${t('set_up_device')}</button>${extraButtons}
        </div>`;
}

function showHome() {
  state.personId = null;
  const study = isStudy();
  const head = `
    <div class="home-head">
      <img class="logo" src="img/nlb-logo.jpg" width="150" height="58" alt="NeuroLifeBalance">
      <div><h1>${t('app_title')}</h1>
      <p class="subtitle">${t('app_subtitle')}</p>
      <p class="hint">${t('asymmetry_and_gain_of_the_optokinetic')}</p></div>
    </div>
    ${device.configured ? '' : `<div class="notice row">${t('please_set_up_the_device_first')} <button class="btn" data-act="device">${t('set_up_device')}</button></div>`}`;
  const foot = `${editionHtml()}
    <p class="hint">${t('not_a_medical_device')}</p>`;

  if (study) {
    const counts = {};
    for (const m of state.measurements) counts[m.personId] = (counts[m.personId] || 0) + 1;
    const persons = [...state.persons].sort((a, b) => a.name.localeCompare(b.name, LOCALE));
    setView('home', `${head}
    <div class="grid-2">
      <div class="panel">
        <h2>${t('people')}</h2>
        <form id="person-form" class="row">
          <label for="person-name" class="sr">${t('pseudonym_or_code')}</label>
          <input id="person-name" placeholder="${t('pseudonym_or_code_e_g_p01')}" autocomplete="off" maxlength="40" required>
          <button class="btn" type="submit">${t('add')}</button>
        </form>
        <ul class="list">${persons.length ? persons.map((p) => `
          <li><button class="link grow" data-person="${p.id}">
            <div class="title">${esc(p.name)}</div>
            <div class="sub">${counts[p.id] || 0} ${t('measurement_s')} · ${esc(condText(condOf(p)))}</div>
          </button><span class="chev" aria-hidden="true">›</span></li>`).join('')
          : `<li class="empty">${t('no_people_yet')}</li>`}</ul>
        <p class="hint">${t('please_use_pseudonyms_only_all_data')}</p>
      </div>
      <div class="panel">
        <h2>${t('device_and_data')}</h2>
        ${deviceHtml(`
          <label class="btn ghost" for="import-file">${t('import')}</label>
          <input id="import-file" type="file" accept=".json,application/json" multiple hidden>
          <button class="btn ghost" data-act="export-all">${t('export_all')}</button>`)}
        <h3 style="margin-top:18px">${t('procedure')}</h3>
        <ol class="steps">
          <li>${t('choose_the_person_read_out_the')}</li>
          <li>${t('setup_check_as_soon_as_everything')}</li>
          <li>${t('calibration_follow_the_rabbit_with_the')}</li>
          <li>${t('measurement_alternating_3_times_each_at')}</li>
          <li>${t('result_asymmetry_and_gain_history_for')}</li>
        </ol>
        <p class="hint">${t('safari_may_delete_website_data_after')}</p>
        ${installHtml()}
      </div>
    </div>
    ${foot}`);
    $('#person-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#person-name').value.trim();
      if (!name) return;
      if (state.persons.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast(t('person_exists', { name })); return; }
      const p = { id: store.uid(), name, createdAt: new Date().toISOString(), condition: { ...DEFAULT_COND } };
      await store.put('persons', p); state.persons.push(p);
      showHome();
    });
    $('#import-file').addEventListener('change', importFiles);
  } else {
    // Freemium: direkt messen; Bedingungen gelten nur für diese Sitzung, nichts wird gespeichert
    const c = currentCond();
    const stored = state.measurements.length;
    setView('home', `${head}
    <div class="grid-2">
      <div class="panel">
        <div class="result-head">
          <div><h2>${t('experiment')}</h2><div class="meta">${esc(condText(c))}${c.vertical ? ` · ${t('with_vertical')}` : ''}</div></div>
          <div class="row"><button class="btn primary big" data-act="start" ${device.configured ? '' : 'disabled'}>${t('start_measurement')}</button></div>
        </div>
        <div class="instruction"><span class="k">${t('please_read_out_word_for_word')}</span>${INSTRUCTION}</div>
        ${condFormHtml(c, t('free_conditions_note'))}
      </div>
      <div class="panel">
        <h2>${t('device')}</h2>
        ${deviceHtml()}
        ${stored ? `<div class="notice" style="margin-top:14px">${t('free_saved_data', { n: stored })}
          <div class="row" style="margin-top:8px"><button class="btn ghost" data-act="export-all">${t('export_all')}</button></div></div>` : ''}
        <h3 style="margin-top:18px">${t('procedure')}</h3>
        <ol class="steps">
          <li>${t('steps_free_start')}</li>
          <li>${t('setup_check_as_soon_as_everything')}</li>
          <li>${t('calibration_follow_the_rabbit_with_the')}</li>
          <li>${t('measurement_alternating_3_times_each_at')}</li>
          <li>${t('steps_free_result')}</li>
        </ol>
        ${installHtml()}
      </div>
    </div>
    ${foot}`);
    $('#cond-form').addEventListener('submit', (e) => {
      e.preventDefault();
      state.freeCond = readCondForm();
      toast(t('conditions_applied'));
      showHome();
    });
  }

  $('#unlock-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await tryUnlock($('#unlock-code').value);
    toast(t(ok ? 'unlock_ok' : 'unlock_invalid'));
    if (ok) showHome();
  });
  main.onclick = (e) => {
    const pid = e.target.closest('[data-person]')?.dataset.person;
    if (pid) return showPerson(pid);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'start') return startMeasurement();
    if (act === 'device') showDevice();
    if (act === 'export-all') exportAll();
    if (act === 'install' && installPrompt) installPrompt.prompt().then(() => { installPrompt = null; showHome(); }).catch(() => {});
  };
  $('#topmeta').textContent = '';
}

// ---------- Geräte-Einrichtung (einmalig) ----------
function showDevice() {
  stopTracking(); // Kamera ist bei der Einrichtung sicher aus
  let cardPpi = device.device === 'card' && device.configured ? device.ppi : null;
  setView('device', `
    <div class="panel narrow">
      <h2>${t('set_up_device')}</h2>
      <p class="hint">${t('done_once_by_the_therapist_measurements')}</p>
      <form id="device-form" class="form">
        <div class="field"><label for="distance">${t('distance_eye_screen')}</label>
          <div class="unit"><input id="distance" type="number" inputmode="decimal" min="20" max="80" step="1" value="${device.distanceCm}"><span>cm</span></div></div>
        <div class="field"><label for="device">${t('device')}</label>
          <select id="device">${DEVICE_PRESETS.map((p) => `<option value="${p.id}" ${p.id === device.device ? 'selected' : ''}>${esc(p.label)}${p.ppi ? ` (${p.ppi})` : ''}</option>`).join('')}</select></div>
        <div class="field" id="ppi-field" ${device.device === 'custom' ? '' : 'hidden'}><label for="ppi">${t('points_per_inch')}</label>
          <div class="unit"><input id="ppi" type="number" min="80" max="300" step="1" value="${Math.round(device.ppi || CSS_PPI_ANDROID)}"><span>pt/in</span></div></div>
        <div id="card-field" class="card-field" ${device.device === 'card' ? '' : 'hidden'}>
          <p>${t('card_instructions')}</p>
          <p class="hint">${t('card_check')} ${t('card_privacy')}</p>
          <div class="row"><button type="button" class="btn" id="card-open">${t('card_start')}</button><span class="hint" id="card-status"></span></div>
        </div>
        <p class="hint">${t('measure_the_distance_with_a_ruler')}</p>
        <div class="row"><button class="btn primary" type="submit">${t('save')}</button></div>
      </form>
    </div>`);

  const showStatus = () => {
    $('#card-status').textContent = cardPpi ? t('card_set', { value: `${fmt(cardPpi, 1)} pt/in` }) : t('card_not_set');
  };
  showStatus();
  $('#device').addEventListener('change', () => {
    const id = $('#device').value;
    $('#ppi-field').hidden = id !== 'custom';
    $('#card-field').hidden = id !== 'card';
  });
  $('#card-open').addEventListener('click', () => openCardMatch(cardPpi || device.ppi || CSS_PPI_ANDROID, (ppi) => { cardPpi = ppi; showStatus(); }));

  $('#device-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#device').value;
    if (id === 'card' && !cardPpi) { toast(t('card_not_set')); return; }
    const ppi = id === 'card' ? cardPpi
      : id === 'custom' ? parseFloat($('#ppi').value) || 132
      : DEVICE_PRESETS.find((p) => p.id === id).ppi;
    device = {
      distanceCm: Math.min(80, Math.max(20, parseFloat($('#distance').value) || 40)),
      device: id,
      ppi,
      configured: true,
    };
    saveDevice(); toast(t('device_saved')); showHome();
  });
  $('#topmeta').textContent = t('device');
}

// Karten-Abgleich im Vollbild: Rahmen in Kartengröße am Bildschirmrand, Regler daneben (quer) bzw. darunter (hochkant)
function openCardMatch(startPpi, onDone) {
  const el = document.createElement('div');
  el.id = 'cardmatch';
  el.className = 'cardmatch';
  el.innerHTML = `
    <div class="card-frame" id="card-frame"><span class="card-label" dir="ltr">${fmt(CARD_MM.w, 1)} × ${fmt(CARD_MM.h, 0)} mm</span></div>
    <div class="cardmatch-side">
      <p>${t('card_short')}</p>
      <div class="card-controls">
        <button type="button" class="btn" data-card="-0.5" aria-label="${t('card_smaller')}">−</button>
        <input type="range" id="card-size" min="90" max="260" step="0.5" value="${startPpi}" aria-label="${t('card_size')}">
        <button type="button" class="btn" data-card="0.5" aria-label="${t('card_larger')}">+</button>
      </div>
      <p class="notice" id="card-zoom-warn" hidden>${t('card_zoom_warning')}</p>
      <div class="row"><button type="button" class="btn" data-done="0">${t('cancel')}</button><button type="button" class="btn primary" data-done="1">${t('card_done')}</button></div>
    </div>`;
  document.body.appendChild(el);
  const size = $('#card-size', el);
  cardRedraw = () => {
    const ppi = parseFloat(size.value);
    const pxmm = ppi / 25.4;
    let w = CARD_MM.w * pxmm, h = CARD_MM.h * pxmm;
    if (w > el.clientWidth - 12) [w, h] = [h, w]; // passt quer nicht: hochkant
    Object.assign($('#card-frame', el).style, { width: `${w}px`, height: `${h}px`, borderRadius: `${CARD_MM.r * pxmm}px` });
    $('#card-zoom-warn', el).hidden = !(window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.02);
  };
  size.addEventListener('input', cardRedraw);
  el.addEventListener('click', (e) => {
    const step = parseFloat(e.target.closest('[data-card]')?.dataset.card);
    if (step) { size.value = Math.min(+size.max, Math.max(+size.min, parseFloat(size.value) + step)); cardRedraw(); return; }
    const done = e.target.closest('[data-done]')?.dataset.done;
    if (done === undefined) return;
    if (done === '1') onDone(parseFloat(size.value));
    cardRedraw = null;
    el.remove();
  });
  cardRedraw();
}

// ---------- Person: Start, Bedingungen, Verlauf ----------
function measurementsOf(pid) {
  return state.measurements.filter((m) => m.personId === pid).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function showPerson(pid) {
  const p = personById(pid);
  if (!p || !isStudy()) return showHome();
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
        <div><h2>${esc(p.name)}</h2><div class="meta">${esc(condText(c))}${c.vertical ? ` · ${t('with_vertical')}` : ''}</div></div>
        <div class="row"><button class="btn primary big" data-act="start" ${device.configured ? '' : 'disabled'}>${t('start_measurement')}</button></div>
      </div>
      ${device.configured ? '' : `<p class="notice">${t('please_set_up_device_overview')}</p>`}
      <div class="instruction"><span class="k">${t('please_read_out_word_for_word')}</span>${INSTRUCTION}</div>
      ${condFormHtml(c, t('note_measurements_with_different_conditions_are'))}
    </div>
    ${ordered.length ? ordered.map(([k, list], gi) => `
      <div class="panel">
        <div class="panel-head"><h3>${t('history')} · ${esc(condText(list[0].condition))}</h3>${k === curKey ? '' : `<span class="pill">${t('other_conditions')}</span>`}</div>
        <div class="chart-grid">
          <div class="chart-box"><canvas id="tl-h-${gi}"></canvas></div>
          <div class="chart-box"><canvas id="tl-g-${gi}"></canvas></div>
          ${list.some((m) => m.result.v) ? `<div class="chart-box"><canvas id="tl-v-${gi}"></canvas></div>` : ''}
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>${t('date')}</th><th class="num">${t('right_left')}</th><th class="num">${t('up_down')}</th><th class="num">${t('gain')}</th><th></th></tr></thead>
          <tbody>${list.map((m, i) => `<tr class="clickable" data-open="${m.id}">
            <td>${dateStr(m.createdAt)}${i === 0 ? ` <span class="pill">${t('baseline')}</span>` : ''}</td>
            <td class="num">${signed(m.result.h.mean)} %</td>
            <td class="num">${m.result.v ? `${signed(m.result.v.mean)} %` : '–'}</td>
            <td class="num">${fmt(m.result.gain)}</td><td class="chev">›</td></tr>`).join('')}</tbody>
        </table></div>
      </div>`).join('')
    : `<div class="panel"><p class="empty">${t('no_measurement_yet_tap_start_measurement')}</p></div>`}
    ${legacy.length ? `<div class="panel"><h3>${t('older_measurements_version_1_not_comparable')}</h3>
      <ul class="list">${legacy.map((m) => `<li><button class="link grow" data-open="${m.id}"><div class="title">${dateStr(m.createdAt)}</div>
      <div class="sub mono">Gain H ${fmt(m.summary?.gainH)} · V ${fmt(m.summary?.gainV)}</div></button></li>`).join('')}</ul></div>` : ''}`);

  ordered.forEach(([, list], gi) => {
    const labels = list.map((m) => dateShort(m.createdAt));
    timelineChart($(`#tl-h-${gi}`), labels, list.map((m) => m.result.h.mean), { title: t('chart_asym_rl'), unit: ' %', zero: true, ci: list.map((m) => m.result.h.ci) });
    timelineChart($(`#tl-g-${gi}`), labels, list.map((m) => m.result.gain), { title: t('gain'), digits: 2 });
    if ($(`#tl-v-${gi}`)) timelineChart($(`#tl-v-${gi}`), labels, list.map((m) => m.result.v?.mean), { title: t('chart_asym_ud'), unit: ' %', zero: true, ci: list.map((m) => m.result.v?.ci) });
  });

  $('#cond-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    p.condition = readCondForm();
    await store.put('persons', p);
    toast(t('conditions_applied'));
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

// Versuchsbedingungen: Formular (aufklappbar) und Auslesen
function condFormHtml(c, note) {
  return `<details class="cond">
        <summary>${t('change_measurement_conditions')}</summary>
        <form id="cond-form" class="form">
          <div class="field"><label for="pattern">${t('pattern')}</label>
            <select id="pattern">${PATTERNS.map((k) => `<option value="${k}" ${k === c.pattern ? 'selected' : ''}>${PATTERN_LABEL[k]}</option>`).join('')}</select></div>
          <fieldset><legend>${t('colour')}</legend><div class="seg">
            ${Object.keys(COLORS).map((k) => `<input type="radio" name="color" id="col-${k}" value="${k}" ${k === c.color ? 'checked' : ''}><label for="col-${k}"><i class="swatch" style="background:${COLORS[k]}"></i>${COLOR_LABEL[k]}</label>`).join('')}
          </div></fieldset>
          <div class="field"><label for="period">${t('width_colour_white_pair')}</label>
            <div class="unit"><input id="period" type="number" min="2" max="20" step="0.5" value="${c.periodDeg}"><span>°</span></div></div>
          <div class="field"><label for="speed1">${t('speeds')}</label>
            <div class="unit"><input id="speed1" type="number" min="2" max="40" step="1" value="${c.speeds[0]}"><span>/</span><input id="speed2" type="number" min="2" max="40" step="1" value="${c.speeds[1]}" aria-label="${t('second_speed')}"><span>°/s</span></div></div>
          <label class="confirm"><input type="checkbox" id="vertical" ${c.vertical ? 'checked' : ''}> ${t('also_measure_vertically')}</label>
          <p class="hint">${note}</p>
          <div class="row"><button class="btn" type="submit">${t('apply')}</button></div>
        </form>
      </details>`;
}
function readCondForm() {
  const s1 = parseFloat($('#speed1').value), s2 = parseFloat($('#speed2').value);
  return {
    pattern: $('#pattern').value,
    color: document.querySelector('input[name="color"]:checked')?.value || 'black',
    periodDeg: Math.min(20, Math.max(2, parseFloat($('#period').value) || 8)),
    speeds: [s1 > 0 ? s1 : 8, s2 > 0 ? s2 : 12],
    vertical: $('#vertical').checked,
  };
}

// ---------- Messung starten → Setup-Check ----------
let checkBuf = [], checkOff = null, checkTimer = null, greenSince = null;
const STATUS = { camera: t('starting_camera'), model: t('loading_face_detection') };

function startMeasurement() {
  // Vollbild und Display-Sperre müssen direkt im Tipp angefragt werden
  const el = document.documentElement;
  const fs = el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
  // Android: im Vollbild auf Querformat festlegen (iOS kennt das nicht, Fehler werden ignoriert)
  Promise.resolve(fs).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
  const c = currentCond();
  setView('check', `
    <div class="check-layout">
      <div class="cam-box" id="cam-box"><div class="cam-status" id="cam-status">${STATUS.camera}</div></div>
      <div class="panel">
        <h2>${t('setup_check')}</h2>
        <ul class="checks" id="checks"></ul>
        <p class="hint">${t('setup_hint', { cm: device.distanceCm })}</p>
        <p class="auto" id="auto"></p>
        <div class="row"><button id="start-calib" class="btn primary" disabled>${t('start_calibration_now')}</button></div>
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
        ? t(IS_IOS ? 'no_camera_access_please_allow_the' : IS_ANDROID ? 'no_camera_access_android' : 'no_camera_access_other')
        : t('camera_start_failed', { error: err.message || err.name });
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
  add(t('camera'), tracker.fps >= 20 ? 'good' : tracker.fps >= 12 ? 'warn' : 'bad', `${tracker.fps} ${t('fps')}`);
  add(t('face_detected'), faceFrac >= 0.9 ? 'good' : faceFrac >= 0.5 ? 'warn' : 'bad', pct(faceFrac));
  const open = median(faces.map((s) => s.open));
  add(t('eyes_open'), !faces.length ? 'bad' : open >= 0.18 ? 'good' : open >= 0.12 ? 'warn' : 'bad', fmt(open, 2));
  const b = tracker.brightness;
  add(t('light'), b >= 70 && b <= 230 ? 'good' : b >= 45 ? 'warn' : 'bad', Number.isFinite(b) ? `${Math.round((b / 255) * 100)} %` : '–');
  if (faces.length) {
    const f = faces[faces.length - 1];
    const dx = f.cx / f.w - 0.5, dy = f.cy / f.h - 0.5;
    add(t('face_centred'), Math.abs(dx) < 0.25 && Math.abs(dy) < 0.3 ? 'good' : 'bad',
      Math.abs(dx) >= 0.25 ? (dx > 0 ? t('move_left') : t('move_right')) : Math.abs(dy) >= 0.3 ? (dy > 0 ? t('camera_lower') : t('camera_higher')) : 'ok');
    const jitter = Math.max(sd(faces.map((s) => s.cx)), sd(faces.map((s) => s.cy))) / median(faces.map((s) => s.scale));
    add(t('head_steady'), jitter < 0.03 ? 'good' : jitter < 0.06 ? 'warn' : 'bad', jitter < 0.03 ? t('steady') : t('unsteady'));
  } else {
    add(t('face_centred'), 'bad', '–');
    add(t('head_steady'), 'bad', '–');
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
  $('#auto').textContent = left > 0 ? t('auto_start_in', { s: left }) : '';
  if (now - greenSince >= AUTO_START_SEC) beginCalibration();
}

// ---------- Vollbild-Ebene ----------
let wakeLock = null;
function showFs() { $('#fs').hidden = false; stage.resize(); updateRotateHint(); }
function exitFullscreen() {
  $('#fs').hidden = true; $('#hud').hidden = true; $('#overlay').hidden = true;
  try { screen.orientation?.unlock?.(); } catch { /* nicht unterstützt */ }
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
  const c = currentCond();
  let n = 3;
  const tick = () => {
    stage.fill();
    overlay(`<h2>${t('starting_soon')}</h2><p>${t('follow_the_rabbit_with_your_eyes')}</p><p class="big-count">${n}</p>`);
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

function issueText(code) {
  if (code.startsWith('weak:')) {
    const [n, total] = code.slice(5).split('/');
    return t('calib_issue_weak', { n, total });
  }
  return t(`calib_issue_${code.replace('-', '_')}`);
}

function finishCalibration(points, c) {
  const res = fitCalibration(points, { mode: 'stand', vertical: c.vertical });
  stage.fill();
  if (res.ok) {
    state.calib = res;
    overlay(`<h2><span class="pill good">${t('calibration_ok')}</span></h2><p>${t('the_measurement_starts_in_a_moment')}</p>`);
    setTimeout(() => { $('#overlay').hidden = true; startRun(c); }, 1500);
    return;
  }
  overlay(`
    <h2><span class="pill bad">${t('calibration_not_ok')}</span></h2>
    <ul>${res.codes.map(issueText).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    <div class="row"><button class="btn" data-act="back">${t('cancel')}</button><button class="btn primary" data-act="repeat">${t('repeat')}</button></div>`,
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
    eye: s.face && s.eyeLm ? s.eyeLm : null,
  });
  if (s.w && s.h) M.videoSize = [s.w, s.h]; // Kamerabildgröße für die Augenspur
}

// Hinweis, wenn sich der Abstand gegenüber der Kalibrierung deutlich ändert (Gesicht größer = näher)
function distanceHint(M) {
  const r = M.scaleSmooth / state.calib.scale0;
  if (!Number.isFinite(r)) return '';
  if (r > 1.15) return ` · ${t('please_move_back_a_little')}`;
  if (r < 0.87) return ` · ${t('please_come_a_little_closer')}`;
  return '';
}

function runFrame() {
  const M = state.run;
  if (!M || M.paused) return;
  const now = performance.now() / 1000;
  const el = now - M.phaseStart;
  const b = M.plan[M.i], dir = DIRS[b.dir];
  const left = M.plan.length - M.i;
  const rounds = t('rounds_left', { n: left });
  $('#hud').textContent = `${dir.arrow} ${ltr(`${b.speed} °/s`)} · ${rounds}${distanceHint(M)}`;
  if (M.phase === 'pre') {
    stage.fixation(dir.arrow, `${dirLabel(b.dir)} · ${ltr(`${b.speed} °/s`)}`, rounds, { done: M.i, total: M.plan.length });
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
    <h2>${t('paused')}</h2>
    <p>${t('paused_info', { i: M.i + 1, n: M.plan.length })}</p>
    <div class="row"><button class="btn danger" data-act="end">${t('end_measurement')}</button><button class="btn primary" data-act="resume">${t('resume')}</button></div>`,
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
  const free = !isStudy();
  const p = free ? { id: FREE_ID, name: '' } : personById(state.personId);
  if (!blocks.length) { toast(t('measurement_ended_no_round_completed_nothing')); if (free) showHome(); else showPerson(p.id); return; }
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
    // Augenspur: Gesichtspunkte der Augen je Bild der Zeilen mit phase = 1 (gleiche Reihenfolge wie raw.rows)
    eyeTrace: {
      version: 1,
      video: M.videoSize || [1280, 720],
      signX: cal.bx < 0 ? -1 : 1,
      signY: M.c.vertical && cal.by < 0 ? -1 : 1,
      frames: encodeFrames(keep.filter((x) => x.phase === 1).map((x) => (x.valid && x.eye?.length === N_VALUES ? x.eye : null))),
    },
  };
  if (!free) {
    try { await store.put('measurements', m); } catch (err) { console.error(err); toast(t('saving_in_the_browser_failed_please')); }
    state.measurements.push(m);
  }
  showResult(m, true);
}

// ---------- Ergebnis ----------
function baselineOf(m) {
  return measurementsOf(m.personId).filter((x) => isQuick(x) && condKey(x.condition) === condKey(m.condition))[0];
}

function rlText(h) {
  if (!h || h.n < 2) return { cls: 'warn', title: t('right_left_no_statement'), body: t('too_few_valid_rounds_for_a') };
  const v = ltr(`${signed(h.mean)} %`), ci = ltr(`± ${fmtCi(h.ci)} %`);
  const side = h.mean < 0 ? 'right' : 'left'; // schwächer verfolgte Richtung
  if (h.verdict === 'deutlich') {
    return { cls: 'note', title: t(`rl_clear_title_${side}`), body: t(`rl_clear_body_${side}`, { v, ci }) };
  }
  if (h.verdict === 'gering') {
    return { cls: '', title: t('no_clear_direction_difference'), body: t('rl_small_body', { v, ci, min: ASYM_MIN }) };
  }
  return { cls: 'warn', title: t('direction_difference_unclear'), body: t('rl_unclear_body', { v, ci }) };
}

function changeLine(cur, base, unit, digits, isBase) {
  if (isBase) return t('this_is_the_baseline_measurement_what');
  if (!Number.isFinite(cur) || !Number.isFinite(base)) return '';
  return t('change_from_baseline', { value: ltr(`${signed(cur - base, digits)}${unit}`) });
}

function showResult(m, fresh = false) {
  if (!m) return;
  if (!isQuick(m)) return showLegacy(m);
  const free = m.personId === FREE_ID;
  state.personId = free ? null : m.personId;
  const res = m.result;
  const base = free ? null : baselineOf(m);
  const isBase = !free && (!base || base.id === m.id);
  const hintIf = (text) => (text ? `<p class="hint">${esc(text)}</p>` : '');
  const rl = rlText(res.h);
  const v = res.v;
  const vText = v && v.n >= 2
    ? t(v.mean >= 0 ? 'ud_body_up' : 'ud_body_down', { ci: ltr(`± ${fmtCi(v.ci)} %`) })
    : t('too_few_valid_rounds');
  const blocks = [...m.blocks].sort((a, b) => 'LRUD'.indexOf(a.dir) - 'LRUD'.indexOf(b.dir) || a.speed - b.speed || a.rep - b.rep);
  const pp = ` ${t('percentage_points')}`;
  const hasTrace = !!m.eyeTrace?.frames;

  setView('result', `
    <div class="panel">
      <div class="result-head">
        <div><h2>${free ? t('result_title') : esc(m.personName)}</h2>
        <div class="meta">${dateStr(m.createdAt)} · ${esc(condText(m.condition))}${free ? '' : isBase ? ` · ${t('baseline')}` : ` · ${t('baseline')}: ${dateShort(base.createdAt)}`}</div></div>
        <div class="row">${free
          ? `<button class="btn primary" data-act="again" ${device.configured ? '' : 'disabled'}>${t('new_measurement')}</button>`
          : `<button class="btn danger" data-act="delete">${t('delete')}</button><button class="btn primary" data-act="export">${t('export')}</button>`}</div>
      </div>
      ${free ? `<p class="hint">${t('free_result_not_saved')}</p>` : fresh ? `<p class="hint">${t('saved_on_this_device_to_back')}</p>` : ''}
      <div id="del-confirm" class="notice" hidden>${t('really_delete_this_measurement_exported_files')}
        <div class="row" style="margin-top:8px"><button class="btn" data-act="del-no">${t('keep')}</button><button class="btn danger" data-act="del-yes">${t('delete_permanently')}</button></div></div>
    </div>
    <div class="result-tiles">
      <div class="panel rtile ${rl.cls}">
        <div class="k">${t('asymmetry_right_left')}</div>
        <div class="v">${signed(res.h.mean)} %</div>
        <h3>${esc(rl.title)}</h3><p>${esc(rl.body)}</p>
        ${free ? '' : hintIf(changeLine(res.h.mean, base?.result.h.mean, pp, 0, isBase))}
      </div>
      ${v ? `<div class="panel rtile">
        <div class="k">${t('asymmetry_up_down')}</div>
        <div class="v">${signed(v.mean)} %</div>
        <p>${esc(vText)}</p>
        ${free ? '' : hintIf(changeLine(v.mean, base?.result.v?.mean, pp, 0, isBase))}
      </div>` : ''}
      <div class="panel rtile">
        <div class="k">${t('gain')}</div>
        <div class="v">${fmt(res.gain)}</div>
        <p>${t('how_fast_the_eyes_follow_the')}</p>
        <p class="sub mono">← ${fmt(res.gainByDir.L)} · → ${fmt(res.gainByDir.R)}${v ? ` · ↑ ${fmt(res.gainByDir.U)} · ↓ ${fmt(res.gainByDir.D)}` : ''}</p>
        ${free ? '' : hintIf(changeLine(res.gain, base?.result.gain, '', 2, isBase))}
      </div>
    </div>
    ${hasTrace ? '<div class="panel eyetrace" id="eyetrace"></div>' : ''}
    <details class="panel" id="details">
      <summary>${t('details_individual_rounds')} (${res.validBlocks}/${res.totalBlocks} ${t('valid')})</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>${t('direction')}</th><th class="num">°/s</th><th class="num">${t('round')}</th><th class="num">${t('gain')}</th><th class="num">${t('eyes_detected')}</th><th class="num">${t('shaking')}</th><th>${t('quality')}</th></tr></thead>
        <tbody>${blocks.map((b) => `<tr><td>${DIRS[b.dir].arrow} ${dirLabel(b.dir)}</td><td class="num">${b.speed}</td><td class="num">${b.rep}${b.retry ? '*' : ''}</td>
          <td class="num">${fmt(b.gain)}</td><td class="num">${pct(b.validPct)}</td><td class="num">${pct(b.shakePct)}</td>
          <td><span class="pill ${b.quality === 'gut' ? 'good' : b.quality === 'mäßig' ? 'warn' : 'bad'}">${esc(qualityLabel(b.quality))}</span></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">${t('automatically_repeated_round_asymmetry_per_round')}</p>
      ${hasTrace ? '' : `<div class="panel-head" style="margin-top:12px"><h3>${t('eye_movement_in_one_round')}</h3>
        <select id="trace-block" aria-label="${t('round')}">${blocks.map((b) => `<option value="${m.blocks.indexOf(b)}">${DIRS[b.dir].arrow} ${b.speed} °/s · ${t('round')} ${b.rep}</option>`).join('')}</select></div>
      <div class="chart-box"><canvas id="trace-canvas"></canvas></div>`}
    </details>
    <p class="hint">${t('not_a_medical_device')}</p>`);

  const drawTrace = () => {
    const b = m.blocks[+$('#trace-block').value];
    if (!b) return;
    const F = Object.fromEntries(m.raw.fields.map((f, i) => [f, i]));
    const rows = m.raw.rows.filter((row) => row[F.block] === b.planIdx && row[F.attempt] === b.attempt && row[F.phase] === 1);
    const ax = DIRS[b.dir].axis === 'x' ? F.ex : F.ey;
    const t0 = rows[0]?.[F.t] ?? 0;
    traceChart($('#trace-canvas'), rows.map((row) => ({ x: row[F.t] - t0, y: row[ax] })),
      DIRS[b.dir].axis === 'x' ? t('eye_horizontal_right') : t('eye_vertical_down'));
  };
  if (hasTrace) {
    // Augenspur: Studien mit Abspielen, Freemium als Standbild
    createEyeTrace($('#eyetrace'), m, { interactive: !free, blocks });
  } else {
    $('#trace-block').addEventListener('change', drawTrace);
    $('#details').addEventListener('toggle', (e) => { if (e.target.open) drawTrace(); });
  }

  main.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'again') return startMeasurement();
    if (act === 'export') exportMeasurement(m);
    if (act === 'delete') $('#del-confirm').hidden = false;
    if (act === 'del-no') $('#del-confirm').hidden = true;
    if (act === 'del-yes') {
      await store.remove('measurements', m.id);
      state.measurements = state.measurements.filter((x) => x.id !== m.id);
      toast(t('measurement_deleted'));
      showPerson(m.personId);
    }
  };
  $('#topmeta').textContent = free ? '' : m.personName;
}

function showLegacy(m) {
  state.personId = m.personId;
  const s = m.summary || {};
  setView('result', `<div class="panel">
    <h2>${esc(m.personName)} · ${dateStr(m.createdAt)}</h2>
    <p class="notice">${t('measurement_from_version_1_of_the')}</p>
    <dl class="kv"><dt>${t('gain')} H</dt><dd>${fmt(s.gainH)}</dd><dt>${t('gain')} V</dt><dd>${fmt(s.gainV)}</dd>
    <dt>${t('asymmetry_r_l')}</dt><dd>${signed(s.asymH)} %</dd><dt>${t('asymmetry_u_d')}</dt><dd>${signed(s.asymV)} %</dd></dl>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="export">${t('export')}</button></div></div>`);
  main.onclick = (e) => { if (e.target.closest('[data-act]')?.dataset.act === 'export') exportMeasurement(m); };
  $('#topmeta').textContent = m.personName;
}

// ---------- Export / Import ----------
// Dezimalkomma → Semikolon als Trenner (wie Excel es in diesen Sprachen erwartet)
const DEC = (1.5).toLocaleString(LOCALE).replace(/\d/g, '')[0] || '.';
const CSV_SEP = DEC === ',' ? ';' : ',';
const CSV_COLS = ['person', 'date', 'pattern', 'colour', 'width', 'direction', 'speed', 'round', 'gain', 'eyes', 'shaking', 'quality', 'asym_rl', 'asym_ud', 'gain_mean'];
function csvFor(list) {
  const n = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d).replace('.', DEC) : '');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const cols = CSV_COLS.map((c) => t(`csv_${c}`));
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
  ]).then((r) => r !== 'aborted' && toast(t('export_ready')));
}

function exportAll() {
  if (!state.measurements.length) { toast(t('there_are_no_measurements_yet')); return; }
  const now = new Date().toISOString();
  const bundle = { format: 'nlb-okr-bundle', version: 2, exportedAt: now, persons: state.persons, measurements: state.measurements };
  store.offerFiles([
    { name: `OKR_${t('export_file_all')}_${stamp(now)}.json`, type: 'application/json', text: JSON.stringify(bundle) },
    { name: `OKR_${t('export_file_all')}_${stamp(now)}.csv`, type: 'text/csv', text: csvFor(state.measurements) },
  ]).then((r) => r !== 'aborted' && toast(t('export_ready')));
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
      toast(t('not_okr_file', { name: file.name }));
    }
  }
  e.target.value = '';
  showHome();
  if (added || skipped) toast(t(skipped ? 'imported_skipped' : 'imported', { n: added, skipped }));
}

// ---------- Start ----------
// Feste Texte der Seite und Sprachauswahl
function initShell() {
  document.title = t('doc_title');
  $('#back').textContent = t('back_overview');
  $('#brand-name').textContent = t('app_title');
  $('#rotate div').textContent = t('rotate_device');
  const sel = $('#lang-select');
  sel.innerHTML = LANGS.map((l) => `<option value="${l.code}" lang="${l.code}" ${l.code === LANG ? 'selected' : ''}>${l.flag ? `${l.flag}\u2002\u00a0` : ''}${esc(l.name)}</option>`).join('');
  sel.setAttribute('aria-label', t('language'));
  sel.hidden = LANGS.length < 2;
  sel.addEventListener('change', () => setLang(sel.value));
}

async function init() {
  initShell();
  try {
    [state.persons, state.measurements] = await Promise.all([store.getAll('persons'), store.getAll('measurements')]);
  } catch (err) {
    console.error(err);
    toast(t('device_storage_not_available_private_window'));
  }
  // Freischaltung per Link, z. B. aus einer Kurs-Mail oder einem QR-Code; der Code verschwindet danach aus der Adresse
  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    const ok = await tryUnlock(code);
    const u = new URL(location.href); u.searchParams.delete('code'); history.replaceState(null, '', u);
    toast(t(ok ? 'unlock_ok' : 'unlock_invalid'));
  }
  showHome();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) toast(t('camera_only_available_over_https'));
}
init();

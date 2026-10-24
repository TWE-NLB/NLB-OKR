// Anzeige der Augenspur: vergrößerte, aus den gespeicherten Gesichtspunkten nachgezeichnete Augen (gespiegelt wie in
// einem Spiegel), Striche für Mitgleiten und Rücksprung, Kurve mit Zeitstrich, Werte in Grad und mm.
// Studien: Abspielen mit Zeitlupe und Wahl des Durchgangs. Freemium: Standbild eines Durchgangs.
import { decodeFrames, eyeGeometry, mmSeries, phaseLabels, trialStats, smoothSlow, median, IRIS_MM } from './eyetrace.js?v=2.4.1';
import { DIRS } from './analysis.js?v=2.4.1';
import { t, ltr, LOCALE } from './i18n.js?v=2.4.1';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (v, d) => (Number.isFinite(v) ? v.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const signed = (v, d) => (Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(v), d) : '–');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

// Gespeicherte Bilder den Rohdaten-Zeilen zuordnen (Bilder gehören zu den Zeilen mit phase = 1)
function prepare(m) {
  const F = Object.fromEntries(m.raw.fields.map((f, i) => [f, i]));
  const frames = decodeFrames(m.eyeTrace.frames);
  const byRow = new Array(m.raw.rows.length).fill(null);
  let k = 0;
  m.raw.rows.forEach((r, i) => { if (r[F.phase] === 1) byRow[i] = frames[k++] ?? null; });
  return { F, byRow };
}

// Alles, was für einen Durchgang angezeigt wird
function trialData(m, prep, b) {
  const { F, byRow } = prep;
  const rows = m.raw.rows;
  const idx = [];
  rows.forEach((r, i) => { if (r[F.block] === b.planIdx && r[F.attempt] === b.attempt && r[F.phase] === 1) idx.push(i); });
  if (idx.length < 10) return null;
  const dir = DIRS[b.dir];
  const col = dir.axis === 'x' ? F.ex : F.ey;
  const t0 = rows[idx[0]][F.t];
  const time = idx.map((i) => rows[i][F.t] - t0);
  const deg = idx.map((i) => (rows[i][col] == null ? NaN : rows[i][col]));
  const frames = idx.map((i) => byRow[i]);
  const [w, h] = m.eyeTrace.video;
  const mm = mmSeries(frames, w, h, m.eyeTrace.signX, m.eyeTrace.signY);
  const mmAxis = dir.axis === 'x' ? mm.x : mm.y;
  const valid = idx.map((i, k) => rows[i][F.valid] === 1 && Number.isFinite(deg[k]));
  const labels = phaseLabels(time, deg.map((v) => v * dir.sign), valid, b.speedEff || b.speed);
  const pMm = mmAxis.map((v) => v * dir.sign);
  const stats = trialStats(time, deg.map((v) => v * dir.sign), pMm, labels);
  const geoms = frames.map((f) => (f ? eyeGeometry(f, w, h) : null));
  if (geoms.filter(Boolean).length < 10) return null;
  const eyeW = median(geoms.filter(Boolean).flatMap((g) => g.eyes.map((e) => Math.hypot(e.outer[0] - e.inner[0], e.outer[1] - e.inner[1]))));
  // Umrechnung Grad → mm für die rechte Achse der Kurve (lineare Anpassung über alle Bilder)
  const pairs = deg.map((d, k) => [d, mmAxis[k]]).filter(([a, c]) => Number.isFinite(a) && Number.isFinite(c));
  let slope = NaN, icpt = NaN;
  if (pairs.length > 20) {
    const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, mc = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
    const sxx = pairs.reduce((s, p) => s + (p[0] - ma) ** 2, 0), sxy = pairs.reduce((s, p) => s + (p[0] - ma) * (p[1] - mc), 0);
    if (sxx > 0) { slope = sxy / sxx; icpt = mc - slope * ma; }
  }
  // Spur: Mittel beider Augen in Kamera-Bildpunkten entlang der Laufachse, Mitgleiten geglättet
  const axSign = dir.axis === 'x' ? m.eyeTrace.signX : m.eyeTrace.signY;
  const trail = smoothSlow(time, pMm, labels).map((v) => (v * dir.sign * axSign) / mm.mmPerPx);
  // Striche vergrößern, damit die kleine Bewegung (Bruchteile eines mm) sichtbar wird:
  // ein typischer Rücksprung erscheint etwa so breit wie 0,8 Irisdurchmesser
  let zoom = 1;
  if (stats.fastMm > 0) zoom = Math.max(1, Math.min(25, Math.round((0.8 * IRIS_MM) / stats.fastMm)));
  else {
    const hs = trail.filter(Number.isFinite).sort((a, c) => a - c);
    const range = hs.length ? hs[Math.floor(hs.length * 0.95)] - hs[Math.floor(hs.length * 0.05)] : NaN;
    if (range > 0) zoom = Math.max(1, Math.min(8, Math.round((0.8 * mm.irisPx) / range)));
  }
  return { b, dir, time, deg, mmAxis, labels, stats, geoms, eyeW, trail, mmPerPx: mm.mmPerPx, dur: time[time.length - 1], slope, icpt, zoom };
}

// Index des Bildes zum Zeitpunkt tt (letztes Bild mit Zeit ≤ tt)
function frameAt(td, tt) {
  let lo = 0, hi = td.time.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (td.time[mid] <= tt) lo = mid; else hi = mid - 1; }
  return lo;
}

function setupCanvas(cv, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.parentElement.clientWidth || 600;
  cv.style.height = `${cssH}px`;
  cv.width = Math.round(w * dpr); cv.height = Math.round(cssH * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: cssH };
}

// Geschlossene, geglättete Kurve durch Punkte (Lidrand)
function smoothClosed(ctx, pts) {
  const n = pts.length;
  ctx.beginPath();
  const m0 = [(pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2];
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.closePath();
}

// Ein Auge in Augen-Koordinaten zeichnen: Mitte zwischen den Augenwinkeln bei (cx, cy), gespiegelt.
// Gibt die Lage der Iris-Mitte auf dem Bildschirm zurück.
function drawEye(ctx, g, e, cx, cy, s) {
  const L = (p) => { const d = sub(p, e.center); return [cx - dot(d, g.ex) * s, cy + dot(d, g.ny) * s]; };
  const outline = [e.outer, ...e.up, e.inner, ...e.lo.slice().reverse()].map(L);
  smoothClosed(ctx, outline);
  ctx.fillStyle = '#fbfbf8'; ctx.fill();
  ctx.save();
  smoothClosed(ctx, outline); ctx.clip();
  const ic = L(e.iris), r = (e.irisPx / 2) * s;
  const grad = ctx.createRadialGradient(ic[0], ic[1], r * 0.3, ic[0], ic[1], r);
  grad.addColorStop(0, '#7b9db5'); grad.addColorStop(0.85, '#4f6f86'); grad.addColorStop(1, '#2f4352');
  ctx.beginPath(); ctx.arc(ic[0], ic[1], r, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); ctx.arc(ic[0], ic[1], r * 0.42, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
  ctx.beginPath(); ctx.arc(ic[0] - r * 0.25, ic[1] - r * 0.3, r * 0.12, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fill();
  ctx.restore();
  smoothClosed(ctx, outline);
  ctx.lineWidth = 2; ctx.strokeStyle = '#3b464d'; ctx.stroke();
  return ic;
}

export function createEyeTrace(root, m, { interactive, blocks }) {
  const prep = prepare(m);
  const usable = blocks.filter((b) => trialData(m, prep, b));
  if (!usable.length) {
    root.innerHTML = `<h3>${t('eye_trace_title')}</h3><p class="hint">${t('eye_trace_too_few')}</p>`;
    return;
  }
  // Vorgabe: erster gültiger waagerechter Durchgang mit guter Qualität
  const start = usable.find((b) => b.quality === 'gut' && DIRS[b.dir].axis === 'x') || usable[0];
  const colors = { slow: css('--accent') || '#1e5a7a', fast: css('--s2') || '#eb6834', ink: css('--ink'), ink2: css('--ink-2'), line: css('--line'), grid: css('--grid') };

  root.innerHTML = `
    <div class="panel-head"><h3>${t('eye_trace_title')}</h3>
      ${interactive ? `<select class="et-trial" aria-label="${t('round')}">${usable.map((b) => `<option value="${m.blocks.indexOf(b)}" ${b === start ? 'selected' : ''}>${DIRS[b.dir].arrow} ${ltr(`${b.speed} °/s`)} · ${t('round')} ${b.rep}</option>`).join('')}</select>` : ''}</div>
    <div class="et-legend"><span><i style="background:${colors.slow}"></i>${t('eye_trace_slow')}</span><span><i style="background:${colors.fast}"></i>${t('eye_trace_fast')}</span><span>${t('eye_trace_fast_len')}</span></div>
    <canvas class="et-eye"></canvas>
    <p class="et-width"></p>
    <canvas class="et-chart"></canvas>
    ${interactive ? `<div class="et-controls">
      <button type="button" class="btn et-play">${t('eye_trace_play')}</button>
      <label class="sr" for="et-speed">${t('eye_trace_speed')}</label>
      <select id="et-speed" class="et-speed">${[0.25, 0.5, 1].map((v) => `<option value="${v}" ${v === 0.5 ? 'selected' : ''}>${ltr(`${fmt(v, v === 1 ? 0 : 2)}×`)}</option>`).join('')}</select>
      <input type="range" class="et-seek" dir="ltr" min="0" max="1000" value="0" aria-label="${t('eye_trace_time')}">
    </div>` : ''}
    <p class="et-now"></p>
    <p class="hint et-summary"></p>
    <p class="hint">${interactive ? '' : `${t('eye_trace_free_note')} `}${t('eye_trace_note')}</p>`;

  const cvEye = root.querySelector('.et-eye'), cvChart = root.querySelector('.et-chart');
  const cvTrail = document.createElement('canvas'); // Zwischenebene für die Spur (Ausblenden älterer Abschnitte)
  let td = null, tNow = 0, playing = false, speed = 0.5, last = 0, raf = 0;

  function load(b) {
    td = trialData(m, prep, b);
    // Standbild: Zeitpunkt in der Mitte des Durchgangs während des Mitgleitens
    tNow = interactive ? 0 : td.time[nearestSlow(td, td.dur / 2)];
    const st = td.stats;
    // Zeichen und Einheiten in den Zahlenblock, damit sie auch im Hebräischen auf der richtigen Seite stehen
    root.querySelector('.et-width').textContent = st.nFast >= 3 && Number.isFinite(st.fastMm) ? t('eye_trace_width', {
      mm: ltr(fmt(st.fastMm, 2)), deg: ltr(`${fmt(st.fastDeg, 1)}°`), n: ltr(String(st.nFast)), ci: ltr(`± ${fmt(st.fastCiMm, 2)}`),
    }) : '';
    root.querySelector('.et-summary').textContent = t('eye_trace_summary', {
      sDeg: ltr(`${fmt(st.slowDeg, 1)} °/s`), sMm: ltr(fmt(st.slowMm, 2)),
      nDeg: ltr(`± ${fmt(st.noiseDeg, 2)}°`), nMm: ltr(`± ${fmt(st.noiseMm, 2)}`),
    });
    draw();
  }
  function nearestSlow(d, tt) {
    const i0 = frameAt(d, tt);
    for (let k = 0; k < d.time.length; k++) {
      for (const i of [i0 + k, i0 - k]) if (d.labels[i] === 'slow' && d.geoms[i]) return i;
    }
    return i0;
  }

  function draw() {
    if (!td) return;
    const W = cvEye.clientWidth || root.clientWidth;
    const eyeH = Math.max(150, Math.min(340, W * 0.36));
    const E = setupCanvas(cvEye, eyeH);
    const C = setupCanvas(cvChart, 170);
    let i = frameAt(td, tNow);
    // letztes Bild mit erkanntem Gesicht verwenden
    let j = i; while (j > 0 && !td.geoms[j]) j--;
    const g = td.geoms[j] || td.geoms.find(Boolean);
    drawEyes(E, g, i);
    drawChart(C);
    const pos = `${signed(td.deg[i], 1)}° · ${signed(td.mmAxis[i], 2)} mm`;
    const phase = td.labels[i] === 'fast' ? t('eye_trace_fast') : td.labels[i] === 'slow' ? t('eye_trace_slow') : '–';
    root.querySelector('.et-now').textContent = t('eye_trace_now', { time: ltr(fmt(td.time[i], 1)), pos: ltr(pos), phase, arrow: td.dir.arrow });
    const seek = root.querySelector('.et-seek');
    if (seek && !seek.matches(':active')) seek.value = String(Math.round((tNow / td.dur) * 1000));
  }

  function drawEyes({ ctx, w, h }, g, i) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = css('--surface-2') || '#f6f8f8'; ctx.fillRect(0, 0, w, h);
    const slotW = w / 2;
    const s = Math.min((slotW * 0.72) / td.eyeW, (h * 0.5) / (td.eyeW * 0.6));
    const horiz = td.dir.axis === 'x';
    const cy = h * (horiz ? 0.4 : 0.5); // waagerecht: Augen etwas über der Mitte, darunter Platz für die Spur
    // gespiegelt: rechtes Auge der Person (Augen-Index 0) erscheint rechts
    const origins = [drawEye(ctx, g, g.eyes[0], slotW * 1.5, cy, s), drawEye(ctx, g, g.eyes[1], slotW * 0.5, cy, s)];
    // Spur der letzten 1,2 s wie bei einem Schreiber: Bewegung entlang der Laufachse vergrößert (td.zoom), ältere Bilder
    // wandern quer dazu weg (waagerechter Reiz: nach unten, senkrechter: zur Seite). So wird Mitgleiten zum schrägen
    // Strich und der Rücksprung zum Gegenstrich; dessen Länge ist die Breite der Reflexbewegung.
    const WINDOW = 1.2, GAP = 0.25;
    const len = horiz ? h - cy - 14 : slotW * 0.5 - 10;
    let r = i; while (r > 0 && !Number.isFinite(td.trail[r])) r--;
    const isFast = (k) => td.labels[k] === 'fast';
    const lone = (k) => isFast(k) && !isFast(k - 1) && !isFast(k + 1);
    const pts = [], byK = new Map();
    let prev = -1;
    for (let k = 0; k <= i; k++) {
      const age = td.time[i] - td.time[k];
      if (age > WINDOW || !Number.isFinite(td.trail[k])) continue;
      if (prev >= 0 && td.time[k] - td.time[prev] > GAP) pts.push(null); // größere Lücke nicht überbrücken
      const along = (td.trail[k] - td.trail[r]) * td.zoom * s, across = (age / WINDOW) * len;
      const q = { age, d: horiz ? [-along, across] : [-across, along],
        fast: prev >= 0 && ((isFast(prev) && isFast(k)) || lone(k) || lone(prev)) };
      pts.push(q); byK.set(k, q); prev = k;
    }
    const at = (O, q) => [O[0] + q.d[0], O[1] + q.d[1]];
    const dpr = window.devicePixelRatio || 1;
    if (cvTrail.width !== cvEye.width || cvTrail.height !== cvEye.height) { cvTrail.width = cvEye.width; cvTrail.height = cvEye.height; }
    const lc = cvTrail.getContext('2d');
    for (const O of origins) {
      lc.setTransform(dpr, 0, 0, dpr, 0, 0); lc.clearRect(0, 0, w, h);
      lc.lineCap = 'round'; lc.lineJoin = 'round';
      // erst der helle Rand für die ganze Spur, dann die farbigen Abschnitte als zusammenhängende Linien
      lc.strokeStyle = 'rgba(255,255,255,.9)'; lc.lineWidth = 7;
      lc.beginPath();
      pts.forEach((q, n) => { if (!q) return; const p = at(O, q); if (!pts[n - 1]) lc.moveTo(p[0], p[1]); else lc.lineTo(p[0], p[1]); });
      lc.stroke();
      lc.lineWidth = 3.5;
      for (let n = 1; n < pts.length;) {
        if (!pts[n] || !pts[n - 1]) { n++; continue; }
        const fast = pts[n].fast, p0 = at(O, pts[n - 1]);
        lc.beginPath(); lc.moveTo(p0[0], p0[1]);
        while (n < pts.length && pts[n] && pts[n].fast === fast) { const p = at(O, pts[n]); lc.lineTo(p[0], p[1]); n++; }
        lc.strokeStyle = fast ? colors.fast : colors.slow; lc.stroke();
      }
      // ältere Abschnitte blasser
      const end = horiz ? [O[0], O[1] + len] : [O[0] - len, O[1]];
      const fade = lc.createLinearGradient(O[0], O[1], end[0], end[1]);
      fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,.3)');
      lc.globalCompositeOperation = 'destination-in'; lc.fillStyle = fade; lc.fillRect(0, 0, w, h);
      lc.globalCompositeOperation = 'source-over';
      ctx.drawImage(cvTrail, 0, 0, w, h);
    }
    // Breite jedes abgeschlossenen Rücksprungs in mm, neben dem Anfang des Gegenstrichs (am rechts gezeigten Auge)
    ctx.font = '600 13px system-ui, sans-serif'; ctx.direction = 'ltr'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.5;
    for (const j of td.stats.jumps) {
      const a = byK.get(j.from), b = byK.get(j.to);
      if (!a || !b || j.to > i || !(j.mm > 0)) continue;
      const pa = at(origins[0], a), pb = at(origins[0], b);
      let x = pa[0], y = pa[1];
      if (horiz) { const right = pa[0] >= pb[0]; ctx.textAlign = right ? 'left' : 'right'; ctx.textBaseline = 'middle'; x += right ? 8 : -8; }
      else { const down = pa[1] >= pb[1]; ctx.textAlign = 'center'; ctx.textBaseline = down ? 'top' : 'bottom'; y += down ? 7 : -7; }
      const txt = `${fmt(j.mm, 2)} mm`;
      ctx.globalAlpha = 0.4 + 0.6 * (1 - a.age / WINDOW);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(txt, x, y);
      ctx.fillStyle = '#b4471f'; ctx.fillText(txt, x, y);
    }
    ctx.globalAlpha = 1;
    // Maßstab 1 mm
    const mmPx = Number.isFinite(td.mmPerPx) ? (1 / td.mmPerPx) * s : NaN;
    ctx.fillStyle = colors.ink2; ctx.strokeStyle = colors.ink2; ctx.lineWidth = 2;
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.direction = 'ltr';
    if (Number.isFinite(mmPx)) {
      ctx.beginPath(); ctx.moveTo(12, h - 14); ctx.lineTo(12 + mmPx, h - 14); ctx.stroke();
      ctx.textAlign = 'left'; ctx.fillText('1 mm', 18 + mmPx, h - 14);
    }
    // Laufrichtung des Reizes und Vergrößerung der Striche
    ctx.textAlign = 'left'; ctx.font = '600 15px system-ui, sans-serif'; ctx.direction = 'inherit';
    ctx.fillText(`${td.dir.arrow} ${t('eye_trace_stimulus')}`, 12, 16);
    if (td.zoom > 1) { ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(t('eye_trace_zoom', { n: td.zoom }), w - 12, 16); }
  }

  function drawChart({ ctx, w, h }) {
    ctx.clearRect(0, 0, w, h);
    const l = 40, r = Number.isFinite(td.slope) ? 58 : 12, top = 12, bot = 24;
    ctx.direction = 'ltr';
    const vals = td.deg.filter(Number.isFinite);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const X = (tt) => l + (tt / td.dur) * (w - l - r);
    const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (h - top - bot);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = colors.ink2; ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
    // Gitter und Achsen: links Grad, rechts mm
    const step = niceStep((hi - lo) / 4);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      ctx.beginPath(); ctx.moveTo(l, Y(v)); ctx.lineTo(w - r, Y(v)); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(`${fmt(v, step < 1 ? 1 : 0)}°`, l - 4, Y(v));
      if (Number.isFinite(td.slope)) { ctx.textAlign = 'left'; ctx.fillText(`${fmt(td.icpt + td.slope * v, 2)} mm`, w - r + 4, Y(v)); }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let s = 0; s <= td.dur + 0.01; s += 2) ctx.fillText(`${fmt(s, 0)} s`, X(s), h - bot + 6);
    // Kurve: Mitgleiten und Rücksprung in eigenen Farben
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (let k = 1; k < td.time.length; k++) {
      if (!Number.isFinite(td.deg[k - 1]) || !Number.isFinite(td.deg[k])) continue;
      ctx.strokeStyle = td.labels[k] === 'fast' ? colors.fast : colors.slow;
      ctx.beginPath(); ctx.moveTo(X(td.time[k - 1]), Y(td.deg[k - 1])); ctx.lineTo(X(td.time[k]), Y(td.deg[k])); ctx.stroke();
    }
    // Zeitstrich
    ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(tNow), top); ctx.lineTo(X(tNow), h - bot); ctx.stroke();
  }
  function niceStep(x) {
    const p = 10 ** Math.floor(Math.log10(x || 1)), f = x / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  // Abspielen
  function tick(now) {
    if (!root.isConnected) { playing = false; return; }
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    tNow += dt * speed;
    if (tNow >= td.dur) { tNow = td.dur; playing = false; updatePlay(); }
    draw();
    if (playing) raf = requestAnimationFrame(tick);
  }
  function updatePlay() {
    const btn = root.querySelector('.et-play');
    if (btn) btn.textContent = playing ? t('eye_trace_pause') : t('eye_trace_play');
  }
  if (interactive) {
    root.querySelector('.et-play').addEventListener('click', () => {
      playing = !playing;
      if (playing) { if (tNow >= td.dur) tNow = 0; last = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
      updatePlay();
    });
    root.querySelector('.et-speed').addEventListener('change', (e) => { speed = parseFloat(e.target.value) || 0.5; });
    root.querySelector('.et-seek').addEventListener('input', (e) => { tNow = (e.target.value / 1000) * td.dur; draw(); });
    root.querySelector('.et-trial').addEventListener('change', (e) => {
      playing = false; cancelAnimationFrame(raf); updatePlay();
      load(m.blocks[+e.target.value]);
    });
    // Klick in die Kurve springt an diese Stelle
    cvChart.addEventListener('pointerdown', (e) => {
      const rect = cvChart.getBoundingClientRect();
      const l = 40, r = Number.isFinite(td.slope) ? 58 : 12;
      tNow = Math.max(0, Math.min(td.dur, ((e.clientX - rect.left - l) / (rect.width - l - r)) * td.dur));
      draw();
    });
  }
  const ro = new ResizeObserver(() => { if (!root.isConnected) { ro.disconnect(); return; } draw(); });
  ro.observe(root);
  load(start);
}

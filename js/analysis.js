// Reine Auswertungsfunktionen ohne DOM-Zugriff (testbar mit `jsc -m test/analysis.test.js`).
// Konvention: Winkel in Grad, +x = Bildschirm rechts, +y = Bildschirm unten (aus Sicht der Testperson).

export const DIRS = {
  L: { key: 'L', axis: 'x', sign: -1, arrow: '←', label: 'nach links', labelEn: 'leftward' },
  R: { key: 'R', axis: 'x', sign: 1, arrow: '→', label: 'nach rechts', labelEn: 'rightward' },
  U: { key: 'U', axis: 'y', sign: -1, arrow: '↑', label: 'nach oben', labelEn: 'upward' },
  D: { key: 'D', axis: 'y', sign: 1, arrow: '↓', label: 'nach unten', labelEn: 'downward' },
};
export const DIR_ORDER = ['L', 'R', 'U', 'D'];

export function median(a) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(a) {
  const s = a.filter(Number.isFinite);
  return s.length ? s.reduce((x, y) => x + y, 0) / s.length : NaN;
}

export function sd(a) {
  const s = a.filter(Number.isFinite);
  if (s.length < 2) return NaN;
  const m = mean(s);
  return Math.sqrt(s.reduce((acc, x) => acc + (x - m) ** 2, 0) / (s.length - 1));
}

function quantile(a, q) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

export function linfit(xs, ys) {
  const n = xs.length;
  if (n < 2) return { a: NaN, b: NaN, r2: NaN };
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const b = sxx ? sxy / sxx : NaN;
  const a = my - b * mx;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : NaN;
  return { a, b, r2 };
}

// points: [{tx, ty, samples:[{fx, fy, valid, cx, cy, scale, open}]}] – nur Samples nach der Einschwingzeit.
// opts.mode: 'stand' | 'hand'
export function fitCalibration(points, opts = {}) {
  const issues = [];
  const codes = []; // sprachunabhängige Kennung je Problem (für die englische Oberfläche)
  const issue = (code, text) => { codes.push(code); issues.push(text); };
  const pts = points.map((p) => {
    const v = p.samples.filter((s) => s.valid);
    return {
      tx: p.tx, ty: p.ty,
      n: v.length,
      frac: p.samples.length ? v.length / p.samples.length : 0,
      fx: median(v.map((s) => s.fx)),
      fy: median(v.map((s) => s.fy)),
      sdx: sd(v.map((s) => s.fx)),
      sdy: sd(v.map((s) => s.fy)),
    };
  });

  const weak = pts.filter((p) => p.frac < 0.6 || p.n < 5);
  if (weak.length) {
    issue(`weak:${weak.length}/${pts.length}`, `Bei ${weak.length} von ${pts.length} Punkten wurden die Augen zu selten erkannt. Mehr Licht, Gesicht mittig halten, spiegelnde Brille ggf. abnehmen.`);
  }

  const usable = pts.filter((p) => p.n >= 5);
  const H = usable.filter((p) => p.ty === 0);
  const V = usable.filter((p) => p.tx === 0);
  const fx = linfit(H.map((p) => p.fx), H.map((p) => p.tx));
  const fy = linfit(V.map((p) => p.fy), V.map((p) => p.ty));

  const sep = (list, key, sdKey, tKey) => {
    if (list.length < 3) return NaN;
    const lo = list.reduce((m, p) => (p[tKey] < m[tKey] ? p : m));
    const hi = list.reduce((m, p) => (p[tKey] > m[tKey] ? p : m));
    const noise = mean([lo[sdKey], hi[sdKey]]) || 1e-6;
    return Math.abs(hi[key] - lo[key]) / noise;
  };
  const sepX = sep(H, 'fx', 'sdx', 'tx');
  const sepY = sep(V, 'fy', 'sdy', 'ty');

  if (!(fx.r2 >= 0.8) || !(sepX >= 4)) {
    issue('horizontal', 'Links/rechts-Bewegung der Augen wurde nicht sauber erkannt. Bitte den Punkten nur mit den Augen folgen, den Kopf nicht drehen.');
  }
  const vertical = opts.vertical !== false;
  if (vertical && (!(fy.r2 >= 0.7) || !(sepY >= 3))) {
    issue('vertical', 'Oben/unten-Bewegung der Augen wurde nicht sauber erkannt. Augen weit genug öffnen, Licht von vorne, Kopf gerade halten.');
  }

  const centers = usable.filter((p) => p.tx === 0 && p.ty === 0);
  const cxDeg = centers.map((p) => fx.a + fx.b * p.fx);
  const cyDeg = vertical ? centers.map((p) => fy.a + fy.b * p.fy) : [];
  const centerSdX = sd(cxDeg), centerSdY = vertical ? sd(cyDeg) : NaN;
  if (centerSdX > 1.5 || centerSdY > 2.5) {
    issue('center', 'Der Mittelpunkt wurde nicht gleichmäßig angeschaut. Bitte bei jedem Punkt ruhig fixieren.');
  }

  const all = points.flatMap((p) => p.samples).filter((s) => s.valid);
  const scale0 = median(all.map((s) => s.scale));
  const range = (k) => (quantile(all.map((s) => s[k]), 0.95) - quantile(all.map((s) => s[k]), 0.05)) / scale0;
  const headMove = Math.max(range('cx'), range('cy'));
  const headLimit = opts.mode === 'hand' ? 0.6 : 0.25;
  if (headMove > headLimit) {
    issue(opts.mode === 'hand' ? 'head-hand' : 'head', opts.mode === 'hand'
      ? 'Das iPad wurde während der Kalibrierung zu stark bewegt. Bitte ruhiger halten, Ellbogen abstützen.'
      : 'Der Kopf hat sich während der Kalibrierung bewegt. Bitte Kopf stillhalten oder abstützen.');
  }

  return {
    ok: issues.length === 0,
    issues,
    codes,
    ax: fx.a, bx: fx.b, ay: fy.a, by: fy.b,
    r2x: fx.r2, r2y: fy.r2, sepX, sepY, centerSdX, centerSdY,
    headMove, scale0,
    openRef: median(all.map((s) => s.open)),
    points: pts.map(({ tx, ty, n, frac, fx: px, fy: py }) => ({ tx, ty, n, frac, fx: px, fy: py })),
  };
}

// s: {t:[], p:[], valid:[], shake:[]} – p in Grad, positiv = Laufrichtung der Streifen.
// speed: effektive Streifengeschwindigkeit in °/s.
export function analyzeBlock(s, speed, opts = {}) {
  const skip = opts.skipSec ?? 1.0;
  const n = s.t.length;
  const empty = { gain: NaN, spv: NaN, beatHz: NaN, ampDeg: NaN, nBeats: 0, validPct: 0, shakePct: 0, nSlow: 0, quality: 'ungültig', durSec: 0 };
  if (n < 10) return empty;

  const t0 = s.t[0];
  const idx = [];
  for (let i = 0; i < n; i++) if (s.t[i] - t0 >= skip) idx.push(i);
  if (idx.length < 10) return empty;

  // 3-Punkt-Median gegen Ausreißer
  const ps = s.p.slice();
  for (let i = 1; i < n - 1; i++) {
    if (s.valid[i - 1] && s.valid[i] && s.valid[i + 1]) {
      const tri = [s.p[i - 1], s.p[i], s.p[i + 1]].sort((a, b) => a - b);
      ps[i] = tri[1];
    }
  }

  const v = new Array(n).fill(NaN);
  for (let i = 1; i < n - 1; i++) {
    const dt = s.t[i + 1] - s.t[i - 1];
    if (s.valid[i - 1] && s.valid[i] && s.valid[i + 1] && dt > 0 && dt <= 0.15) {
      v[i] = (ps[i + 1] - ps[i - 1]) / dt;
    }
  }

  const resetThr = Math.max(25, 1.2 * speed);
  const fwdThr = 2.5 * speed + 25;
  const reset = v.map((x) => x < -resetThr);
  const fwd = v.map((x) => x > fwdThr);
  const sacc = reset.map((r, i) => r || fwd[i]);

  const slow = [];
  let validCount = 0, shakeCount = 0;
  for (const i of idx) {
    if (s.valid[i]) validCount++;
    if (s.shake[i]) shakeCount++;
    if (!Number.isFinite(v[i]) || s.shake[i]) continue;
    if (sacc[i] || sacc[i - 1] || sacc[i + 1]) continue;
    slow.push(v[i]);
  }

  // Schnelle Phasen (Rückstellsakkaden) als zusammenhängende Läufe zählen
  const amps = [];
  const first = idx[0], last = idx[idx.length - 1];
  for (let i = first; i <= last; i++) {
    if (!reset[i]) continue;
    let j = i;
    while (j + 1 <= last && reset[j + 1]) j++;
    const before = i - 1, after = j + 1;
    if (before >= 0 && after < n && s.valid[before] && s.valid[after]) {
      // größter Abfall innerhalb des Laufs, damit die langsame Drift nicht abgezogen wird
      let peak = -Infinity, amp = 0;
      for (let k = before; k <= after; k++) {
        if (!s.valid[k]) continue;
        peak = Math.max(peak, s.p[k]);
        amp = Math.max(amp, peak - s.p[k]);
      }
      if (amp >= 0.5) amps.push(amp);
    }
    i = j;
  }

  const durSec = s.t[last] - s.t[first];
  const validPct = validCount / idx.length;
  const shakePct = shakeCount / idx.length;
  const spv = slow.length >= 10 ? median(slow) : NaN;
  const quality = validPct >= 0.7 && shakePct <= 0.2 ? 'gut'
    : validPct >= 0.5 && shakePct <= 0.4 ? 'mäßig' : 'ungültig';

  return {
    gain: Number.isFinite(spv) && speed > 0 ? spv / speed : NaN,
    spv,
    beatHz: durSec > 0 ? amps.length / durSec : NaN,
    ampDeg: amps.length ? median(amps) : NaN,
    nBeats: amps.length,
    validPct, shakePct,
    nSlow: slow.length,
    quality, durSec,
  };
}

export function asymmetry(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a + b === 0) return NaN;
  return ((a - b) / ((a + b) / 2)) * 100;
}

// blocks: [{dir, speed, gain, beatHz, ampDeg, quality}]
export function summarize(blocks) {
  const ok = blocks.filter((b) => b.quality !== 'ungültig' && Number.isFinite(b.gain));
  const byDir = {};
  for (const d of DIR_ORDER) byDir[d] = mean(ok.filter((b) => b.dir === d).map((b) => b.gain));
  return {
    gainByDir: byDir,
    gainH: mean([byDir.L, byDir.R]),
    gainV: mean([byDir.U, byDir.D]),
    gainAll: mean(ok.map((b) => b.gain)),
    asymH: asymmetry(byDir.R, byDir.L),
    asymV: asymmetry(byDir.U, byDir.D),
    beatHz: mean(ok.map((b) => b.beatHz)),
    ampDeg: mean(ok.map((b) => b.ampDeg)),
    validBlocks: ok.length,
    totalBlocks: blocks.length,
  };
}

// ---------------- Schnellcheck: Asymmetrie aus Wiederholungspaaren
// Kritische t-Werte (zweiseitig, 95 %) für df = 1 … 12
const T95 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179];
// Unterhalb dieser Asymmetrie (in %) wertet die App einen Unterschied nicht als auffällig.
// Festlegung der App, kein Literaturwert.
export const ASYM_MIN = 10;

const usable = (b) => b && b.quality !== 'ungültig' && Number.isFinite(b.gain);

// Ein Asymmetriewert je Paar (gleiche Geschwindigkeit, gleiche Wiederholung).
// (a − b) ÷ Mittelwert × 100: R/L → positiv = rechts stärker; U/D → positiv = oben stärker.
export function pairAsymmetries(blocks, a, b) {
  const vals = [];
  for (const x of blocks.filter((k) => k.dir === a && usable(k))) {
    const y = blocks.find((k) => k.dir === b && k.speed === x.speed && k.rep === x.rep && usable(k));
    if (y) vals.push(asymmetry(x.gain, y.gain));
  }
  return vals.filter(Number.isFinite);
}

export function asymStats(vals) {
  const n = vals.length;
  const m = mean(vals);
  const s = sd(vals);
  const ci = n >= 2 ? (T95[Math.min(n - 1, T95.length - 1)] * s) / Math.sqrt(n) : NaN;
  let verdict = 'unklar';
  if (n >= 2 && Number.isFinite(m)) {
    if (Math.abs(m) < ASYM_MIN) verdict = 'gering';
    else if (Math.abs(m) - ci > 0) verdict = 'deutlich';
  }
  return { n, mean: m, sd: s, ci, verdict, values: vals };
}

export function summarizeQuick(blocks) {
  const ok = blocks.filter(usable);
  const byDir = {};
  for (const d of DIR_ORDER) byDir[d] = mean(ok.filter((b) => b.dir === d).map((b) => b.gain));
  return {
    h: asymStats(pairAsymmetries(blocks, 'R', 'L')),
    v: blocks.some((b) => b.dir === 'U' || b.dir === 'D') ? asymStats(pairAsymmetries(blocks, 'U', 'D')) : null,
    gain: mean(ok.map((b) => b.gain)),
    gainByDir: byDir,
    validBlocks: ok.length,
    totalBlocks: blocks.length,
  };
}

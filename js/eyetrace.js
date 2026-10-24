// Augenspur: je Kamerabild die Gesichtspunkte der Augen speichern (keine Bilder) und daraus
// die Augenposition in mm berechnen. Reine Funktionen ohne DOM (testbar mit jsc).

// Sichtbarer Irisdurchmesser bei Erwachsenen (Mittelwert, sehr einheitlich): Maßstab für mm
export const IRIS_MM = 11.7;

// Je Auge 17 Punkte: Außenwinkel, Innenwinkel, Oberlid ×5 und Unterlid ×5 (je von außen nach innen),
// Iris-Mitte, Iris-Rand ×4. Indizes des 478-Punkte-Modells von MediaPipe.
export const EYE_LANDMARKS = [
  33, 133, 161, 160, 159, 158, 157, 163, 144, 145, 153, 154, 468, 469, 470, 471, 472, // rechtes Auge der Person
  263, 362, 388, 387, 386, 385, 384, 390, 373, 374, 380, 381, 473, 474, 475, 476, 477, // linkes Auge der Person
];
export const PER_EYE = 17;
export const N_VALUES = EYE_LANDMARKS.length * 2; // x und y, normiert auf die Bildgröße (0…1)

const Q = 30000;          // Auflösung beim Speichern: 1/30000 der Bildbreite
const MISSING = -32768;   // kein Gesicht in diesem Bild

// ---------- Speichern: Int16 → Base64 (kompakt, ca. 1 MB je Messung) ----------
const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPH[(n >> 18) & 63] + ALPH[(n >> 12) & 63] + (b === undefined ? '=' : ALPH[(n >> 6) & 63]) + (c === undefined ? '=' : ALPH[n & 63]);
  }
  return out;
}

function b64decode(str) {
  const clean = str.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (ALPH.indexOf(clean[i]) << 18) | (ALPH.indexOf(clean[i + 1]) << 12)
      | ((i + 2 < clean.length ? ALPH.indexOf(clean[i + 2]) : 0) << 6) | (i + 3 < clean.length ? ALPH.indexOf(clean[i + 3]) : 0);
    bytes[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) bytes[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) bytes[o++] = n & 255;
  }
  return bytes.subarray(0, o);
}

// frames: Liste aus Arrays (N_VALUES normierte Koordinaten) oder null
export function encodeFrames(frames) {
  const bytes = new Uint8Array(frames.length * N_VALUES * 2);
  let o = 0;
  for (const f of frames) {
    for (let i = 0; i < N_VALUES; i++) {
      let v = MISSING;
      if (f && Number.isFinite(f[i])) v = Math.round(Math.max(-1.09, Math.min(1.09, f[i])) * Q);
      const u = v & 0xffff;
      bytes[o++] = u & 255;
      bytes[o++] = u >> 8;
    }
  }
  return b64encode(bytes);
}

export function decodeFrames(str) {
  const bytes = b64decode(str || '');
  const n = Math.floor(bytes.length / (N_VALUES * 2));
  const frames = [];
  for (let k = 0; k < n; k++) {
    const f = new Float32Array(N_VALUES);
    let missing = false;
    for (let i = 0; i < N_VALUES; i++) {
      const o = (k * N_VALUES + i) * 2;
      let v = bytes[o] | (bytes[o + 1] << 8);
      if (v & 0x8000) v -= 0x10000;
      if (v === MISSING) { missing = true; break; }
      f[i] = v / Q;
    }
    frames.push(missing ? null : f);
  }
  return frames;
}

// ---------- Geometrie ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function median(a) {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Punkte eines Bildes in Kamera-Bildpunkten, je Auge geordnet; Iris dem nächstgelegenen Auge zuordnen
export function eyeGeometry(f, w, h) {
  const P = (k) => [f[2 * k] * w, f[2 * k + 1] * h];
  const eyes = [0, 1].map((e) => {
    const b = e * PER_EYE;
    return {
      outer: P(b), inner: P(b + 1),
      up: [2, 3, 4, 5, 6].map((j) => P(b + j)),
      lo: [7, 8, 9, 10, 11].map((j) => P(b + j)),
      iris: P(b + 12), rim: [13, 14, 15, 16].map((j) => P(b + j)),
    };
  });
  for (const e of eyes) e.center = mid(e.outer, e.inner);
  if (dist(eyes[0].iris, eyes[0].center) > dist(eyes[1].iris, eyes[0].center)) {
    [eyes[0].iris, eyes[1].iris] = [eyes[1].iris, eyes[0].iris];
    [eyes[0].rim, eyes[1].rim] = [eyes[1].rim, eyes[0].rim];
  }
  // Achse zwischen den Augen (gleicht Kopfneigung aus): e zeigt im Kamerabild nach rechts, n nach unten
  let ex = sub(eyes[1].center, eyes[0].center);
  const len = Math.hypot(ex[0], ex[1]) || 1;
  ex = [ex[0] / len, ex[1] / len];
  if (ex[0] < 0) ex = [-ex[0], -ex[1]];
  const ny = [-ex[1], ex[0]];
  for (const e of eyes) {
    e.irisPx = (dist(e.rim[0], e.rim[2]) + dist(e.rim[1], e.rim[3])) / 2;
    const d = sub(e.iris, e.center);
    e.h = dot(d, ex);
    e.v = dot(d, ny);
  }
  return { eyes, ex, ny };
}

// Augenposition je Bild in mm: Iris relativ zur Mitte zwischen den Augenwinkeln, Mittel beider Augen.
// Maßstab: Irisdurchmesser (Median über alle Bilder) = IRIS_MM. signX/signY richten die Achsen wie die
// Kalibrierung aus (+x = rechts aus Sicht der Person, +y = unten).
export function mmSeries(frames, w, h, signX = 1, signY = 1) {
  const hx = [], vy = [], diam = [];
  for (const f of frames) {
    if (!f) { hx.push(NaN); vy.push(NaN); diam.push(NaN); continue; }
    const g = eyeGeometry(f, w, h);
    hx.push((g.eyes[0].h + g.eyes[1].h) / 2);
    vy.push((g.eyes[0].v + g.eyes[1].v) / 2);
    diam.push((g.eyes[0].irisPx + g.eyes[1].irisPx) / 2);
  }
  const irisPx = median(diam);
  const mmPerPx = irisPx > 0 ? IRIS_MM / irisPx : NaN;
  return {
    x: hx.map((v) => signX * v * mmPerPx),
    y: vy.map((v) => signY * v * mmPerPx),
    irisPx, mmPerPx,
  };
}

// Schwankung von Bild zu Bild (Standardabweichung), robust geschätzt aus zweiten Differenzen:
// das gleichmäßige Mitgleiten fällt dabei heraus, Rücksprünge stören den Median nicht.
export function noiseSd(x) {
  const d = [];
  for (let i = 1; i < x.length - 1; i++) {
    if ([x[i - 1], x[i], x[i + 1]].every(Number.isFinite)) d.push(x[i] - (x[i - 1] + x[i + 1]) / 2);
  }
  if (d.length < 10) return NaN;
  const m = median(d);
  return (1.4826 * median(d.map((v) => Math.abs(v - m)))) / Math.sqrt(1.5);
}

// Mitgleiten oder Rücksprung je Bild, mit denselben Schwellen wie die Gain-Auswertung (analysis.js).
// p: Position in Grad, positiv = Laufrichtung des Musters; speed in °/s.
export function phaseLabels(t, p, valid, speed) {
  const n = t.length;
  const v = new Array(n).fill(NaN);
  for (let i = 1; i < n - 1; i++) {
    const dt = t[i + 1] - t[i - 1];
    if (valid[i - 1] && valid[i] && valid[i + 1] && dt > 0 && dt <= 0.15) v[i] = (p[i + 1] - p[i - 1]) / dt;
  }
  const resetThr = Math.max(25, 1.2 * speed);
  const fwdThr = 2.5 * speed + 25;
  return v.map((x, i) => {
    if (!valid[i]) return null;
    if (!Number.isFinite(x)) return 'slow';
    return x < -resetThr || x > fwdThr ? 'fast' : 'slow';
  });
}

// Kennwerte eines Durchgangs in Grad und mm (pDeg/pMm positiv in Laufrichtung)
export function trialStats(t, pDeg, pMm, labels) {
  const vel = (p) => {
    const out = [];
    for (let i = 1; i < t.length - 1; i++) {
      const dt = t[i + 1] - t[i - 1];
      if (labels[i - 1] === 'slow' && labels[i] === 'slow' && labels[i + 1] === 'slow' && dt > 0 && dt <= 0.15
        && Number.isFinite(p[i + 1]) && Number.isFinite(p[i - 1])) out.push((p[i + 1] - p[i - 1]) / dt);
    }
    return out.length >= 10 ? median(out) : NaN;
  };
  // Rücksprünge: Läufe aus „fast“, Amplitude = größter Abfall gegen die Laufrichtung
  const amps = (p) => {
    const res = [];
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== 'fast') continue;
      let j = i;
      while (j + 1 < labels.length && labels[j + 1] === 'fast') j++;
      let peak = -Infinity, amp = 0;
      for (let k = Math.max(0, i - 1); k <= Math.min(p.length - 1, j + 1); k++) {
        if (!Number.isFinite(p[k])) continue;
        peak = Math.max(peak, p[k]);
        amp = Math.max(amp, peak - p[k]);
      }
      if (amp > 0) res.push(amp);
      i = j;
    }
    return res;
  };
  const aDeg = amps(pDeg).filter((a) => a >= 0.5);
  const aMm = amps(pMm).filter((a) => a >= 0.1);
  return {
    slowDeg: vel(pDeg), slowMm: vel(pMm),
    fastDeg: aDeg.length ? median(aDeg) : NaN, fastMm: aMm.length ? median(aMm) : NaN,
    nFast: aDeg.length,
    noiseDeg: noiseSd(pDeg), noiseMm: noiseSd(pMm),
  };
}

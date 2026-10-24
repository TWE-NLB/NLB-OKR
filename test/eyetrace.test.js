// Ausführen: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/eyetrace.test.js
import { encodeFrames, decodeFrames, mmSeries, noiseSd, phaseLabels, trialStats, eyeGeometry, smoothSlow, jumps, N_VALUES, PER_EYE, IRIS_MM } from '../js/eyetrace.js';

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
let fails = 0;
const check = (name, cond, info) => { print(`${cond ? 'OK  ' : 'FAIL'} ${name} ${info ?? ''}`); if (!cond) fails++; };

// Synthetisches Gesicht im Kamerabild (1280 × 720): Augen 60 px breit, Iris 30 px Durchmesser (= 11,7 mm).
// irisShiftPx: Iris nach rechts im Kamerabild (= nach links aus Sicht der Person).
const W = 1280, H = 720;
function frame(irisShiftPx, swapIris = false, roll = 0) {
  const f = new Float32Array(N_VALUES);
  const put = (k, x, y) => {
    const cx = 640, cy = 360; // um die Bildmitte drehen (Kopfneigung)
    const xr = cx + (x - cx) * Math.cos(roll) - (y - cy) * Math.sin(roll);
    const yr = cy + (x - cx) * Math.sin(roll) + (y - cy) * Math.cos(roll);
    f[2 * k] = xr / W; f[2 * k + 1] = yr / H;
  };
  const centers = [560, 720]; // rechtes Auge der Person liegt im Kamerabild links
  centers.forEach((c, e) => {
    const b = e * PER_EYE;
    const outerX = e === 0 ? c - 30 : c + 30, innerX = e === 0 ? c + 30 : c - 30;
    put(b, outerX, 360); put(b + 1, innerX, 360);
    for (let j = 0; j < 5; j++) { const x = outerX + ((innerX - outerX) * (j + 1)) / 6; put(b + 2 + j, x, 348); put(b + 7 + j, x, 372); }
    const irisEye = swapIris ? 1 - e : e, ic = centers[irisEye] + irisShiftPx;
    const ib = irisEye * PER_EYE;
    put(ib + 12, ic, 360); put(ib + 13, ic + 15, 360); put(ib + 14, ic, 345); put(ib + 15, ic - 15, 360); put(ib + 16, ic, 375);
  });
  return f;
}

// 1) Speichern und Laden
const frames = [frame(0), null, frame(5)];
const back = decodeFrames(encodeFrames(frames));
check('Bilder nach Laden gleich viele', back.length === 3, back.length);
check('fehlendes Bild bleibt leer', back[1] === null);
const maxErr = Math.max(...Array.from(frames[2]).map((v, i) => Math.abs(v - back[2][i])));
check('Genauigkeit beim Speichern < 0,001 Bildpunkte·1/W', maxErr * W < 0.05, (maxErr * W).toFixed(4) + ' px');

// 2) mm-Maßstab über den Irisdurchmesser: 30 px = 11,7 mm → 6 px Verschiebung = 2,34 mm
const s = mmSeries([frame(6), frame(0), frame(-6)], W, H, 1, 1);
check('Irisdurchmesser 30 px erkannt', Math.abs(s.irisPx - 30) < 0.1, s.irisPx.toFixed(2));
check('6 px = 2,34 mm', Math.abs(s.x[0] - 2.34) < 0.02, s.x[0].toFixed(3));
check('Vorzeichen folgt signX', Math.abs(mmSeries([frame(6)], W, H, -1, 1).x[0] + 2.34) < 0.02);
check('vertauschte Iris-Punkte werden zugeordnet', Math.abs(mmSeries([frame(6, true)], W, H, 1, 1).x[0] - 2.34) < 0.02);
check('Kopfneigung 10° ändert den Wert nicht', Math.abs(mmSeries([frame(6, false, 0.1745)], W, H, 1, 1).x[0] - 2.34) < 0.03,
  mmSeries([frame(6, false, 0.1745)], W, H, 1, 1).x[0].toFixed(3));
check('Geometrie: Iris-Durchmesser je Auge', Math.abs(eyeGeometry(frame(0), W, H).eyes[1].irisPx - 30) < 0.1);

// 3) Sägezahn: Mitgleiten 8 °/s (≈ 1,6 mm/s bei 0,2 mm/°), Rücksprung alle 0,5 s
const t = [], pDeg = [], pMm = [], valid = [];
let pos = 0, next = 0.5;
for (let i = 0; i < 8 * 30; i++) {
  const ti = i / 30;
  if (ti >= next) { pos -= 4; next += 0.5; }
  pos += 8 / 30;
  t.push(ti); pDeg.push(pos + rnd() * 0.2); pMm.push(pos * 0.2 + rnd() * 0.04); valid.push(true);
}
const labels = phaseLabels(t, pDeg, valid, 10);
const st = trialStats(t, pDeg, pMm, labels);
check('Mitgleiten ≈ 8 °/s', Math.abs(st.slowDeg - 8) < 0.8, st.slowDeg.toFixed(2));
check('Mitgleiten ≈ 1,6 mm/s', Math.abs(st.slowMm - 1.6) < 0.2, st.slowMm.toFixed(3));
check('Rücksprünge ≈ 15', Math.abs(st.nFast - 15) <= 2, st.nFast);
check('Rücksprung ≈ 3,7°', Math.abs(st.fastDeg - 3.73) < 0.5, st.fastDeg.toFixed(2));
check('Rücksprung ≈ 0,75 mm', Math.abs(st.fastMm - 0.75) < 0.12, st.fastMm.toFixed(3));
// Gleichverteiltes Rauschen ±0,1° hat SD 0,058°; ±0,02 mm hat SD 0,012 mm
check('Messschwankung Grad ≈ 0,06', Math.abs(st.noiseDeg - 0.058) < 0.03, st.noiseDeg.toFixed(3));
check('Messschwankung mm ≈ 0,012', Math.abs(st.noiseMm - 0.0115) < 0.006, st.noiseMm.toFixed(4));
check('Breite je Rücksprung in mm vorhanden', st.jumps.length === st.nFast && st.jumps.every((j) => Math.abs(j.mm - 0.75) < 0.1),
  st.jumps.map((j) => j.mm.toFixed(2)).join(' '));
check('Schwankung des Mittelwerts klein', st.fastCiMm > 0 && st.fastCiMm < 0.03, st.fastCiMm.toFixed(4));

// 4) Glätten: gleichmäßiges Gleiten bleibt gleich, Zittern wird kleiner, Rücksprünge bleiben scharf
const sm = smoothSlow(t, pDeg, labels);
const clean = []; pos = 0; next = 0.5;
for (let i = 0; i < t.length; i++) { if (t[i] >= next) { pos -= 4; next += 0.5; } pos += 8 / 30; clean.push(pos); }
const errRaw = [], errSm = [];
labels.forEach((l, i) => { if (l === 'slow') { errRaw.push(Math.abs(pDeg[i] - clean[i])); errSm.push(Math.abs(sm[i] - clean[i])); } });
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
check('Glätten halbiert das Zittern', mean(errSm) < 0.6 * mean(errRaw), `${mean(errRaw).toFixed(3)} → ${mean(errSm).toFixed(3)}`);
check('Rücksprung-Bilder bleiben unverändert', labels.every((l, i) => l !== 'fast' || sm[i] === pDeg[i]));
const lin = t.map((x) => 2 + 5 * x), linSm = smoothSlow(t, lin, t.map(() => 'slow'));
check('Gerade bleibt Gerade (auch am Rand)', linSm.every((v, i) => Math.abs(v - lin[i]) < 1e-9));
const jj = jumps([0, 1, 2, 3, -1, 0, 1], [null, 'slow', 'slow', 'fast', 'fast', 'slow', 'slow']);
check('Rücksprung: Anfang, Ende, Breite', jj.length === 1 && jj[0].from === 3 && jj[0].to === 4 && jj[0].amp === 4, JSON.stringify(jj));

check('Rauschen ohne Werte = NaN', Number.isNaN(noiseSd([1, 2])));
check('IRIS_MM 11,7', IRIS_MM === 11.7);

print(fails ? `${fails} Test(s) fehlgeschlagen` : 'Alle Tests bestanden');

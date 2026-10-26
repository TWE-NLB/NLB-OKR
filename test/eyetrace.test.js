// Augenspur (js/eyetrace.js): Speichern, Geometrie, mm-Maßstab, Phasen, Breite der Reflexbewegung, Glätten
import { suite, test, assert } from './engine.js';
import { encodeFrames, decodeFrames, mmSeries, noiseSd, phaseLabels, trialStats, eyeGeometry, smoothSlow, jumps, N_VALUES, PER_EYE, IRIS_MM } from '../js/eyetrace.js';

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);

// Künstliches Gesicht im Kamerabild (1280 × 720): Augen 60 px breit, Iris 30 px Durchmesser (= 11,7 mm).
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

suite('Augenspur: Speichern und Laden', () => {
  const frames = [frame(0), null, frame(5)];
  const back = decodeFrames(encodeFrames(frames));
  test('gleich viele Bilder nach dem Laden', () => assert.equal(back.length, 3));
  test('fehlendes Bild bleibt leer', () => assert.equal(back[1], null));
  test('Genauigkeit < 0,05 Kamera-Bildpunkte', () => {
    const maxErr = Math.max(...Array.from(frames[2]).map((v, i) => Math.abs(v - back[2][i])));
    assert.between(maxErr * W, 0, 0.05);
  });
  test('leere Eingabe ergibt keine Bilder', () => assert.equal(decodeFrames('').length, 0));
});

suite('Augenspur: Geometrie und mm-Maßstab', () => {
  const s = mmSeries([frame(6), frame(0), frame(-6)], W, H, 1, 1);
  test('Irisdurchmesser 30 px erkannt', () => assert.close(s.irisPx, 30, 0.1));
  test('6 px Verschiebung = 2,34 mm', () => assert.close(s.x[0], 2.34, 0.02));
  test('Vorzeichen folgt signX', () => assert.close(mmSeries([frame(6)], W, H, -1, 1).x[0], -2.34, 0.02));
  test('vertauschte Iris-Punkte werden dem richtigen Auge zugeordnet', () => assert.close(mmSeries([frame(6, true)], W, H, 1, 1).x[0], 2.34, 0.02));
  test('Kopfneigung 10° ändert den Wert nicht', () => assert.close(mmSeries([frame(6, false, 0.1745)], W, H, 1, 1).x[0], 2.34, 0.03));
  test('Irisdurchmesser je Auge', () => assert.close(eyeGeometry(frame(0), W, H).eyes[1].irisPx, 30, 0.1));
  test('Konstante IRIS_MM = 11,7', () => assert.equal(IRIS_MM, 11.7));
});

// Sägezahn: Mitgleiten 8 °/s (0,2 mm/°), Rücksprung 4° alle 0,5 s
const t = [], pDeg = [], pMm = [], valid = [], clean = [];
{
  let pos = 0, next = 0.5;
  for (let i = 0; i < 8 * 30; i++) {
    const ti = i / 30;
    if (ti >= next) { pos -= 4; next += 0.5; }
    pos += 8 / 30;
    t.push(ti); clean.push(pos); pDeg.push(pos + rnd() * 0.2); pMm.push(pos * 0.2 + rnd() * 0.04); valid.push(true);
  }
}
const labels = phaseLabels(t, pDeg, valid, 10);
const st = trialStats(t, pDeg, pMm, labels);

suite('Augenspur: Kennwerte eines Durchgangs', () => {
  test('Mitgleiten ≈ 8 °/s', () => assert.close(st.slowDeg, 8, 0.8));
  test('Mitgleiten ≈ 1,6 mm/s', () => assert.close(st.slowMm, 1.6, 0.2));
  test('≈ 15 Rücksprünge erkannt', () => assert.close(st.nFast, 15, 2));
  test('Rücksprung ≈ 3,7°', () => assert.close(st.fastDeg, 3.73, 0.5));
  test('Breite der Reflexbewegung ≈ 0,75 mm', () => assert.close(st.fastMm, 0.75, 0.12));
  test('Breite je Rücksprung vorhanden und plausibel', () => {
    assert.equal(st.jumps.length, st.nFast);
    st.jumps.forEach((j) => assert.close(j.mm, 0.75, 0.1));
  });
  test('Schwankung des Mittelwerts klein (< 0,03 mm)', () => assert.between(st.fastCiMm, 0, 0.03));
  test('Messschwankung Grad ≈ 0,06', () => assert.close(st.noiseDeg, 0.058, 0.03));
  test('Messschwankung mm ≈ 0,012', () => assert.close(st.noiseMm, 0.0115, 0.006));
  test('Rauschen ohne genug Werte = NaN', () => assert.isNaN(noiseSd([1, 2])));
  test('ungültige Bilder bekommen keine Phase', () => {
    const l = phaseLabels([0, 0.033, 0.067], [0, 0.1, 0.2], [true, false, true], 10);
    assert.equal(l[1], null);
  });
});

suite('Augenspur: Glätten und Rücksprünge', () => {
  const sm = smoothSlow(t, pDeg, labels);
  test('Glätten verringert das Zittern deutlich', () => {
    const errRaw = [], errSm = [];
    labels.forEach((l, i) => { if (l === 'slow') { errRaw.push(Math.abs(pDeg[i] - clean[i])); errSm.push(Math.abs(sm[i] - clean[i])); } });
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    assert.ok(mean(errSm) < 0.6 * mean(errRaw), `${mean(errRaw).toFixed(3)} → ${mean(errSm).toFixed(3)}`);
  });
  test('Rücksprung-Bilder bleiben unverändert', () => assert.ok(labels.every((l, i) => l !== 'fast' || sm[i] === pDeg[i])));
  test('Gerade bleibt Gerade (auch am Rand)', () => {
    const lin = t.map((x) => 2 + 5 * x);
    smoothSlow(t, lin, t.map(() => 'slow')).forEach((v, i) => assert.close(v, lin[i], 1e-9));
  });
  test('Rücksprung: Anfang, Ende und Breite', () => {
    assert.deepEqual(jumps([0, 1, 2, 3, -1, 0, 1], [null, 'slow', 'slow', 'fast', 'fast', 'slow', 'slow']), [{ from: 3, to: 4, amp: 4 }]);
  });
  test('ohne Rücksprung keine Einträge', () => assert.equal(jumps([0, 1, 2], ['slow', 'slow', 'slow']).length, 0));
});

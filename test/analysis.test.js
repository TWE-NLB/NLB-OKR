// Auswertung (js/analysis.js): Gain, Kalibrierung, Richtungsunterschied – mit künstlichen Augenbewegungen
import { suite, test, assert } from './engine.js';
import { analyzeBlock, fitCalibration, summarize, summarizeQuick, asymStats } from '../js/analysis.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);

// Künstlicher Sägezahn: 30 Bilder/s, Mitgleiten mit gain × speed, Rücksprung alle `period` s
function sawtooth(speed, gain, period, sec, noise = 0.15) {
  const t = [], p = [], valid = [], shake = [];
  let pos = 0, nextReset = period;
  for (let i = 0; i < sec * 30; i++) {
    const ti = i / 30;
    if (ti >= nextReset) { pos -= gain * speed * period; nextReset += period; }
    pos += gain * speed / 30;
    t.push(ti); p.push(pos + rnd() * noise); valid.push(i % 37 !== 0); shake.push(false);
  }
  return { t, p, valid, shake };
}

// Kalibrierpunkt: Merkmal = 0,02 pro Grad, negatives Vorzeichen (Kamerabild gespiegelt)
function point(tx, ty) {
  const samples = [];
  for (let i = 0; i < 25; i++) samples.push({ fx: -0.02 * tx + rnd() * 0.004, fy: -0.012 * ty + rnd() * 0.004, valid: true, cx: 300 + rnd(), cy: 200 + rnd(), scale: 100, open: 0.3 });
  return { tx, ty, samples };
}

suite('Auswertung eines Durchgangs (analyzeBlock)', () => {
  const r = analyzeBlock(sawtooth(20, 0.8, 0.4, 10), 20);
  test('Gain ≈ 0,8 bei 20 °/s', () => assert.close(r.gain, 0.8, 0.08));
  test('Schlagfrequenz ≈ 2,5 Hz', () => assert.close(r.beatHz, 2.5, 0.4));
  test('Rücksprung-Amplitude ≈ 5,9°', () => assert.close(r.ampDeg, 5.87, 0.6));
  test('Qualität „gut“', () => assert.equal(r.quality, 'gut'));
  test('Gain ≈ 0,95 bei 10 °/s', () => assert.close(analyzeBlock(sawtooth(10, 0.95, 0.6, 10), 10).gain, 0.95, 0.1));
  test('Zu wenige Daten → ungültig', () => {
    assert.equal(analyzeBlock({ t: [1, 2], p: [0, 0], valid: [true, true], shake: [false, false] }, 20).quality, 'ungültig');
  });
});

suite('Kalibrierung (fitCalibration)', () => {
  const cal = fitCalibration([point(0, 0), point(-12, 0), point(0, 0), point(12, 0), point(0, 0), point(0, -8), point(0, 0), point(0, 8), point(0, 0)], { mode: 'stand' });
  test('9 Punkte → OK', () => assert.ok(cal.ok, cal.issues.join(' | ')));
  test('Steigung x ≈ −50 °/Einheit', () => assert.close(cal.bx, -50, 3));
  test('Nur waagerecht (5 Punkte) → OK', () => {
    const c = fitCalibration([point(0, 0), point(-12, 0), point(0, 0), point(12, 0), point(0, 0)], { mode: 'stand', vertical: false });
    assert.ok(c.ok, c.issues.join(' | '));
  });
  test('Ohne Augenbewegung → nicht OK', () => {
    const flat = [point(0, 0), point(-12, 0), point(12, 0), point(0, -8), point(0, 8)]
      .map((p) => ({ ...p, samples: p.samples.map((s) => ({ ...s, fx: rnd() * 0.004, fy: rnd() * 0.004 })) }));
    assert.ok(!fitCalibration(flat).ok);
  });
});

suite('Zusammenfassung und Richtungsunterschied', () => {
  const sum = summarize([
    { dir: 'L', speed: 20, gain: 0.8, beatHz: 2, ampDeg: 5, quality: 'gut' },
    { dir: 'R', speed: 20, gain: 1.0, beatHz: 2, ampDeg: 5, quality: 'gut' },
    { dir: 'U', speed: 20, gain: 0.5, beatHz: 2, ampDeg: 5, quality: 'ungültig' },
  ]);
  test('Unterschied R/L ≈ 22 %', () => assert.close(sum.asymH, 22.2, 0.5));
  test('Ungültige Durchgänge zählen nicht', () => assert.equal(sum.validBlocks, 2));

  const qb = [];
  for (const speed of [8, 12]) for (const rep of [1, 2, 3]) {
    qb.push({ dir: 'L', speed, rep, gain: 0.8 + (rep - 2) * 0.01, quality: 'gut' });
    qb.push({ dir: 'R', speed, rep, gain: 0.6 + (rep - 2) * 0.015, quality: 'gut' });
  }
  const qs = summarizeQuick(qb);
  test('Schnellauswertung: Unterschied R/L ≈ −29 %', () => assert.close(qs.h.mean, -28.6, 2));
  test('Klarer Unterschied → „deutlich“', () => assert.equal(qs.h.verdict, 'deutlich'));
  test('Ohne senkrechte Durchgänge kein senkrechter Wert', () => assert.equal(qs.v, null));
  test('Kleiner Unterschied → „gering“', () => assert.equal(asymStats([3, -2, 4, 1, 0, 2]).verdict, 'gering'));
  test('Große Streuung → „unklar“', () => assert.equal(asymStats([30, -10, 40, -5, 25, -20]).verdict, 'unklar'));
  test('Ungültiger Durchgang fällt aus dem Paar', () => {
    assert.equal(summarizeQuick([{ dir: 'L', speed: 8, rep: 1, gain: 0.8, quality: 'gut' }, { dir: 'R', speed: 8, rep: 1, gain: 0.5, quality: 'ungültig' }]).h.n, 0);
  });
});

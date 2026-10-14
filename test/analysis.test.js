// Ausführen: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/analysis.test.js
import { analyzeBlock, fitCalibration, summarize } from '../js/analysis.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
let fails = 0;
const check = (name, cond, info) => { print(`${cond ? 'OK  ' : 'FAIL'} ${name} ${info ?? ''}`); if (!cond) fails++; };

// Synthetischer OKN-Sägezahn: 30 fps, Gain 0,8, Rückstellung alle 0,4 s
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

const r = analyzeBlock(sawtooth(20, 0.8, 0.4, 10), 20);
check('Gain ≈ 0,8', Math.abs(r.gain - 0.8) < 0.08, r.gain.toFixed(3));
check('Schlagfrequenz ≈ 2,5 Hz', Math.abs(r.beatHz - 2.5) < 0.4, r.beatHz.toFixed(2));
// Sprung von Bild zu Bild: 6,4° Rückstellung minus 0,53° Drift im selben Bild
check('Amplitude ≈ 5,9°', Math.abs(r.ampDeg - 5.87) < 0.6, r.ampDeg.toFixed(2));
check('Qualität gut', r.quality === 'gut', r.quality);

const slow = analyzeBlock(sawtooth(10, 0.95, 0.6, 10), 10);
check('Gain 10°/s ≈ 0,95', Math.abs(slow.gain - 0.95) < 0.1, slow.gain.toFixed(3));

const none = analyzeBlock({ t: [1, 2], p: [0, 0], valid: [true, true], shake: [false, false] }, 20);
check('Zu wenig Daten → ungültig', none.quality === 'ungültig');

// Kalibrierung: Merkmal = 0,02 pro Grad, negatives Vorzeichen (Kamerabild gespiegelt)
function point(tx, ty) {
  const samples = [];
  for (let i = 0; i < 25; i++) samples.push({ fx: -0.02 * tx + rnd() * 0.004, fy: -0.012 * ty + rnd() * 0.004, valid: true, cx: 300 + rnd(), cy: 200 + rnd(), scale: 100, open: 0.3 });
  return { tx, ty, samples };
}
const cal = fitCalibration([point(0, 0), point(-12, 0), point(0, 0), point(12, 0), point(0, 0), point(0, -8), point(0, 0), point(0, 8), point(0, 0)], { mode: 'stand' });
check('Kalibrierung OK', cal.ok, cal.issues.join(' | '));
check('Steigung x ≈ -50 °/Einheit', Math.abs(cal.bx + 50) < 3, cal.bx.toFixed(1));

const flat = [point(0, 0), point(-12, 0), point(12, 0), point(0, -8), point(0, 8)].map((p) => ({ ...p, samples: p.samples.map((s) => ({ ...s, fx: rnd() * 0.004, fy: rnd() * 0.004 })) }));
check('Ohne Augenbewegung → nicht OK', !fitCalibration(flat).ok);

const sum = summarize([
  { dir: 'L', speed: 20, gain: 0.8, beatHz: 2, ampDeg: 5, quality: 'gut' },
  { dir: 'R', speed: 20, gain: 1.0, beatHz: 2, ampDeg: 5, quality: 'gut' },
  { dir: 'U', speed: 20, gain: 0.5, beatHz: 2, ampDeg: 5, quality: 'ungültig' },
]);
check('Asymmetrie R/L ≈ 22 %', Math.abs(sum.asymH - 22.2) < 0.5, sum.asymH.toFixed(1));
check('Ungültige Blöcke ignoriert', sum.validBlocks === 2);

print(fails ? `${fails} Test(s) fehlgeschlagen` : 'Alle Tests bestanden');

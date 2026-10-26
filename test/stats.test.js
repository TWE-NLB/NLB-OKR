// Statistik-Grundfunktionen (js/analysis.js) inklusive Randfälle: leere Listen, fehlende Werte, Division durch null
import { suite, test, assert } from './engine.js';
import { median, mean, sd, linfit, asymmetry, asymStats, ASYM_MIN, DIRS, DIR_ORDER } from '../js/analysis.js';

suite('Statistik: Mittelwerte und Streuung', () => {
  test('Median ungerade Anzahl', () => assert.equal(median([3, 1, 2]), 2));
  test('Median gerade Anzahl', () => assert.equal(median([4, 1, 3, 2]), 2.5));
  test('Median ignoriert fehlende Werte', () => assert.equal(median([NaN, 5, null, 1, 3]), 3));
  test('Median leer = NaN', () => assert.isNaN(median([])));
  test('Mittelwert', () => assert.equal(mean([1, 2, 3, 6]), 3));
  test('Mittelwert leer = NaN', () => assert.isNaN(mean([NaN])));
  test('Standardabweichung (Stichprobe)', () => assert.close(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 0.001));
  test('Standardabweichung mit 1 Wert = NaN', () => assert.isNaN(sd([5])));
});

suite('Statistik: Gerade durch Punkte (linfit)', () => {
  const f = linfit([0, 1, 2, 3], [1, 3, 5, 7]);
  test('Steigung 2', () => assert.close(f.b, 2, 1e-12));
  test('Achsenabschnitt 1', () => assert.close(f.a, 1, 1e-12));
  test('Bestimmtheit r² = 1', () => assert.close(f.r2, 1, 1e-12));
  test('zu wenige Punkte → NaN', () => assert.isNaN(linfit([1], [1]).b));
  test('alle x gleich → keine Steigung', () => assert.isNaN(linfit([2, 2, 2], [1, 2, 3]).b));
});

suite('Statistik: Richtungsunterschied', () => {
  test('gleiche Werte → 0 %', () => assert.equal(asymmetry(0.8, 0.8), 0));
  test('1,0 gegen 0,8 → 22,2 %', () => assert.close(asymmetry(1.0, 0.8), 22.22, 0.01));
  test('Vorzeichen dreht mit der Reihenfolge', () => assert.close(asymmetry(0.8, 1.0), -22.22, 0.01));
  test('Summe 0 → NaN (keine Division durch null)', () => assert.isNaN(asymmetry(0, 0)));
  test('fehlender Wert → NaN', () => assert.isNaN(asymmetry(NaN, 1)));
  test('ein einziges Paar → „unklar“', () => assert.equal(asymStats([25]).verdict, 'unklar'));
  test('Schwelle für „gering“ ist 10 %', () => assert.equal(ASYM_MIN, 10));
});

suite('Richtungen', () => {
  test('vier Richtungen in fester Reihenfolge', () => assert.deepEqual(DIR_ORDER, ['L', 'R', 'U', 'D']));
  test('jede Richtung hat Achse, Vorzeichen und Pfeil', () => DIR_ORDER.forEach((d) => {
    const x = DIRS[d];
    assert.ok(['x', 'y'].includes(x.axis) && Math.abs(x.sign) === 1 && x.arrow, `Richtung ${d} unvollständig`);
  }));
});

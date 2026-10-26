// Kleine Test-Engine ohne Abhängigkeiten. Läuft mit JavaScriptCore (macOS, `jsc -m`), Node oder im Browser.
//   import { suite, test, assert } from './engine.js';
//   suite('Auswertung', () => { test('Gain ≈ 0,8', () => assert.close(gain, 0.8, 0.05)); });
// Ausgabe je Test eine Zeile, am Ende die maschinenlesbare Zeile „RESULT pass=… fail=…“ für das Quality-Gate.

const out = typeof print === 'function' ? print : (s) => console.log(s);
const registry = [];
let current = null;

export function suite(name, fn) {
  current = { name, tests: [] };
  registry.push(current);
  fn();
  current = null;
}

export function test(name, fn) {
  if (!current) throw new Error(`test("${name}") steht außerhalb von suite()`);
  current.tests.push({ name, fn });
}

export class AssertionError extends Error {}
const show = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toPrecision(5);
  try { return JSON.stringify(v); } catch { return String(v); }
};
const fail = (msg) => { throw new AssertionError(msg); };

export const assert = {
  ok(cond, msg = 'Bedingung nicht erfüllt') { if (!cond) fail(msg); },
  equal(actual, expected, msg) { if (actual !== expected) fail(msg ?? `erwartet ${show(expected)}, erhalten ${show(actual)}`); },
  deepEqual(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(msg ?? `erwartet ${show(expected)}, erhalten ${show(actual)}`);
  },
  // Zahl innerhalb einer Toleranz
  close(actual, expected, tol, msg) {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) fail(msg ?? `erwartet ${show(expected)} ± ${show(tol)}, erhalten ${show(actual)}`);
  },
  between(actual, lo, hi, msg) {
    if (!(actual >= lo && actual <= hi)) fail(msg ?? `erwartet ${show(lo)} … ${show(hi)}, erhalten ${show(actual)}`);
  },
  isNaN(actual, msg) { if (!Number.isNaN(actual)) fail(msg ?? `erwartet NaN, erhalten ${show(actual)}`); },
  throws(fn, msg = 'Fehler erwartet, aber keiner ausgelöst') {
    try { fn(); } catch { return; }
    fail(msg);
  },
};

// Führt alle Tests aus; gibt die Anzahl der Fehler zurück und beendet unter jsc mit Exit-Code 0/1.
export async function run() {
  let pass = 0, failed = 0;
  const t0 = Date.now();
  for (const s of registry) {
    out(`\n▸ ${s.name}`);
    for (const tc of s.tests) {
      try {
        await tc.fn();
        pass++; out(`  ✓ ${tc.name}`);
      } catch (e) {
        failed++; out(`  ✗ ${tc.name}\n      → ${e instanceof AssertionError ? e.message : `Programmfehler: ${e}`}`);
      }
    }
  }
  out(`\n${failed ? `${failed} von ${pass + failed} Tests fehlgeschlagen` : `Alle ${pass} Tests bestanden`} (${Date.now() - t0} ms)`);
  out(`RESULT pass=${pass} fail=${failed}`);
  if (typeof quit === 'function') quit(failed ? 1 : 0);
  return failed;
}

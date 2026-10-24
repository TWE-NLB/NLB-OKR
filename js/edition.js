// Versionen: Freemium (messen, nichts speichern) und Studien (Teilnehmende, Messreihen, Export/Import).
// Einfache Freischaltung per Code: Die App kennt nur SHA-256-Prüfsummen gültiger Codes (config/editions.json),
// nie die Codes selbst. Neue Codes erzeugt tools/new_code.py. Bewusst einfach: Wer den Programmcode verändert,
// kann die Sperre umgehen.

const VERSION = new URL(import.meta.url).search; // gleiche ?v= wie die Programmdateien (Cache)
const STORE_KEY = 'okr-edition';
const SALT = 'eye-reflex-lab|';

export const CONFIG = await fetch(new URL(`../config/editions.json${VERSION}`, import.meta.url), { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}));
const CODES = Array.isArray(CONFIG.codes) ? CONFIG.codes : [];

// Für später: Adresse, unter der man einen Code erhält (z. B. Kursbuchung oder Shop). Leer = nicht anzeigen.
export const PURCHASE_URL = CONFIG.purchaseUrl || '';

const normalize = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const today = () => new Date().toISOString().slice(0, 10);
const validEntry = (hash) => CODES.find((c) => c.hash === hash && (!c.validUntil || c.validUntil >= today()));

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
}
let unlock = load();
// früher freigeschaltet, Code inzwischen abgelaufen oder entfernt
export let lapsed = false;
if (unlock && !validEntry(unlock.hash)) { lapsed = true; unlock = null; }

export const isStudy = () => !!unlock;
export const unlockInfo = () => (unlock ? { validUntil: validEntry(unlock.hash)?.validUntil || null } : null);

// Gibt true zurück, wenn der Code gültig ist; die Freischaltung gilt dann auf diesem Gerät.
export async function tryUnlock(code) {
  const norm = normalize(code);
  if (!norm || !crypto?.subtle) return false;
  const hash = await sha256(SALT + norm);
  if (!validEntry(hash)) return false;
  unlock = { hash, at: new Date().toISOString() };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(unlock)); } catch { /* privat */ }
  lapsed = false;
  return true;
}

// Sprachen: Alle Texte stehen in lang/<code>.json, die Liste der Sprachen in lang/languages.json.
// Neue Sprache: lang/en.json kopieren, übersetzen und in languages.json eintragen. Der Code bleibt unverändert.
// Auswahl: ?lang=xx in der Adresse > gespeicherte Wahl > Sprache des Geräts > Englisch.

const VERSION = new URL(import.meta.url).search; // gleiche ?v= wie die Programmdateien (Cache)
const FALLBACK = 'en';                            // fehlt ein Text, wird Englisch gezeigt
const STORE_KEY = 'okr-lang';
const url = (file) => new URL(`../lang/${file}${VERSION}`, import.meta.url);

async function json(file) {
  const r = await fetch(url(file), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return r.json();
}

export const LANGS = await json('languages.json');
const known = (code) => LANGS.find((l) => l.code === code);

function pick() {
  const fromUrl = new URLSearchParams(location.search).get('lang')?.toLowerCase();
  if (known(fromUrl)) { try { localStorage.setItem(STORE_KEY, fromUrl); } catch { /* privat */ } return fromUrl; }
  try { const s = localStorage.getItem(STORE_KEY); if (known(s)) return s; } catch { /* privat */ }
  for (const l of navigator.languages || [navigator.language]) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (known(c)) return c;
  }
  return known(FALLBACK) ? FALLBACK : LANGS[0].code;
}

const meta = known(pick());
export const LANG = meta.code;
export const LOCALE = meta.locale;
export const RTL = meta.dir === 'rtl';

const [texts, fallback] = await Promise.all([
  json(`${LANG}.json`),
  LANG === FALLBACK ? null : json(`${FALLBACK}.json`).catch(() => null),
]);

document.documentElement.lang = LANG;
document.documentElement.dir = RTL ? 'rtl' : 'ltr';

// t('key', { name: 'P01' }) → Text mit eingesetzten Werten ({name})
export function t(key, vars) {
  let s = texts[key] ?? fallback?.[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

// Zahlen mit Vorzeichen und Einheit in Text von rechts nach links als eine Einheit halten (z. B. „−12 %“)
export const ltr = (s) => (RTL ? `⁦${s}⁩` : s);

export function setLang(code) {
  if (!known(code) || code === LANG) return;
  try { localStorage.setItem(STORE_KEY, code); } catch { /* privat */ }
  const u = new URL(location.href);
  u.searchParams.set('lang', code);
  location.replace(u);
}

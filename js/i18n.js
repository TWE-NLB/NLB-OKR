// Sprache aus <html lang="…">: Deutsch unter /, Englisch unter /EN/.
export const LANG = (document.documentElement.lang || 'de').slice(0, 2).toLowerCase();
export const EN = LANG === 'en';
export const LOCALE = EN ? 'en-GB' : 'de-DE';
export const T = (de, en) => (EN ? en : de);

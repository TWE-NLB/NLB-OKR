#!/usr/bin/env python3
"""Quality-Gate für Eye Reflex Lab: führt ALLE Prüfungen aus. Nur wenn alles grün ist, darf veröffentlicht werden.

Aufruf:  python3 tools/quality_gate.py          (aus dem Projektordner, auch automatisch vor jedem git push)
Ergebnis: Exit-Code 0 = alles grün, 1 = mindestens eine Prüfung rot. Beschreibung aller Prüfungen: test/README.md
"""
import json
import re
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
JS_FILES = sorted((ROOT / 'js').glob('*.js'))
TEST_FILES = sorted((ROOT / 'test').glob('*.js'))

results = []  # (Name, ok, Details)
SUMMARY = {}  # Kurzinfo je Prüfung für die Ausgabe


def check(name):
    def deco(fn):
        t0 = time.time()
        try:
            problems = fn() or []
        except Exception as e:  # Absturz einer Prüfung zählt als rot
            problems = [f'Prüfung abgestürzt: {e!r}']
        results.append((name, not problems, problems, time.time() - t0))
        return fn
    return deco


def read(p):
    return Path(p).read_text(encoding='utf-8')


# 1 ─ Modultests (test/run.js mit der Test-Engine)
@check('Modultests (test/run.js)')
def unit_tests():
    if not Path(JSC).exists():
        return ['JavaScriptCore (jsc) nicht gefunden – Tests laufen nur unter macOS']
    r = subprocess.run([JSC, '-m', 'test/run.js'], cwd=ROOT, capture_output=True, text=True, timeout=120)
    m = re.search(r'RESULT pass=(\d+) fail=(\d+)', r.stdout)
    if not m:
        return ['keine Ergebnis-Zeile – Testlauf abgebrochen', *(r.stdout + r.stderr).strip().splitlines()[-8:]]
    passed, failed = int(m.group(1)), int(m.group(2))
    SUMMARY['unit'] = f'{passed} Tests'
    if failed:
        return [line.strip() for line in r.stdout.splitlines() if line.strip().startswith(('✗', '→'))]
    if passed == 0:
        return ['keine Tests ausgeführt']
    # jede *.test.js-Datei muss in run.js eingebunden sein
    runner = read(ROOT / 'test/run.js')
    return [f'{f.name} ist nicht in test/run.js eingebunden' for f in TEST_FILES if f.name.endswith('.test.js') and f.name not in runner]


# 2 ─ Syntax aller Programmdateien
@check('Syntax aller Programmdateien (js/, test/)')
def syntax():
    problems = []
    for f in JS_FILES + TEST_FILES:
        code = f"checkModuleSyntax(read({json.dumps(str(f))}))"
        r = subprocess.run([JSC, '-e', code], capture_output=True, text=True, timeout=30)
        if r.returncode != 0 or 'Error' in r.stderr + r.stdout:
            problems.append(f'{f.relative_to(ROOT)}: {(r.stderr or r.stdout).strip().splitlines()[0]}')
    return problems


# 3 ─ Sprachdateien vollständig und gleich aufgebaut
@check('Sprachdateien (gleiche Texte, Platzhalter, nicht leer)')
def languages():
    problems = []
    langs = json.loads(read(ROOT / 'lang/languages.json'))
    codes = [l['code'] for l in langs]
    for l in langs:
        for k in ('code', 'name', 'locale', 'flag'):
            if not l.get(k):
                problems.append(f'languages.json: {l.get("code")} ohne „{k}“')
        if l.get('dir', 'ltr') not in ('ltr', 'rtl'):
            problems.append(f'languages.json: {l.get("code")} dir muss ltr oder rtl sein')
    data = {}
    for c in codes:
        p = ROOT / f'lang/{c}.json'
        if not p.exists():
            problems.append(f'lang/{c}.json fehlt')
            continue
        data[c] = json.loads(read(p))
    for f in (ROOT / 'lang').glob('*.json'):
        if f.stem not in codes and f.name != 'languages.json':
            problems.append(f'{f.name} steht nicht in languages.json')
    if 'de' not in data:
        return problems + ['Referenzsprache de fehlt']
    ref = data['de']
    ph = lambda s: sorted(set(re.findall(r'\{(\w+)\}', s)))
    for c, d in data.items():
        for k in sorted(set(ref) - set(d)):
            problems.append(f'{c}.json: Text „{k}“ fehlt')
        for k in sorted(set(d) - set(ref)):
            problems.append(f'{c}.json: Text „{k}“ gibt es in de.json nicht')
        for k, v in d.items():
            if not isinstance(v, str) or not v.strip():
                problems.append(f'{c}.json: „{k}“ ist leer')
            elif k in ref and ph(v) != ph(ref[k]):
                problems.append(f'{c}.json: „{k}“ Platzhalter {ph(v)} statt {ph(ref[k])}')
    # jeder im Code benutzte Text-Schlüssel muss existieren
    used = set()
    for f in JS_FILES:
        code = re.sub(r'^\s*//.*$', '', read(f), flags=re.M)  # Kommentare nicht mitzählen
        used |= set(re.findall(r"\bt\('([a-z0-9_]+)'", code))
    for k in sorted(used - set(ref)):
        problems.append(f'Code benutzt Text „{k}“, der in de.json fehlt')
    return problems


# 4 ─ Eine Versionsnummer überall (sonst lädt Safari alte und neue Dateien gemischt)
@check('Versionsnummer ?v= einheitlich')
def versions():
    found = {}
    for f in [ROOT / 'index.html', *JS_FILES]:
        for m in re.finditer(r'''["'`]([^"'`]*?\.(?:js|css))\?v=([\w.]+)''', read(f)):
            if '/vendor/' in '/' + m.group(1):
                continue  # fremde Dateien tragen ihre eigene Version
            found.setdefault(m.group(2), []).append(f'{f.relative_to(ROOT)} → {m.group(1)}')
    if len(found) > 1:
        return [f'v={v}: {len(refs)}× z. B. {refs[0]}' for v, refs in found.items()]
    if not found:
        return ['keine Versionsnummer gefunden']
    SUMMARY['version'] = 'v=' + next(iter(found))
    return []


# 5 ─ Alle Verweise zeigen auf vorhandene Dateien
@check('Verweise auf Dateien (HTML, Imports, Manifest, vendor)')
def references():
    problems = []
    html = read(ROOT / 'index.html')
    for ref in re.findall(r'(?:src|href)="([^"#]+)"', html):
        if re.match(r'^[a-z]+:', ref):
            continue
        if not (ROOT / ref.split('?')[0]).exists():
            problems.append(f'index.html → {ref} fehlt')
    for f in JS_FILES + TEST_FILES:
        for ref in re.findall(r'''(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+)['"](\.{1,2}/[^'"]+)['"]''', read(f)):
            if not (f.parent / ref.split('?')[0]).resolve().exists():
                problems.append(f'{f.relative_to(ROOT)} → {ref} fehlt')
    man = json.loads(read(ROOT / 'manifest.webmanifest'))
    for icon in man.get('icons', []):
        if not (ROOT / icon['src']).exists():
            problems.append(f'manifest → {icon["src"]} fehlt')
    for p in ['vendor/mediapipe/vision_bundle.mjs', 'vendor/mediapipe/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
              'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
              'vendor/models/face_landmarker.task', 'vendor/fonts/fonts.css', 'vendor/chartjs/chart.umd.min.js']:
        if not (ROOT / p).exists() or (ROOT / p).stat().st_size == 0:
            problems.append(f'{p} fehlt oder ist leer')
    for ref in re.findall(r"url\('([^']+)'\)", read(ROOT / 'vendor/fonts/fonts.css')):
        if not (ROOT / 'vendor/fonts' / ref).exists():
            problems.append(f'fonts.css → {ref} fehlt')
    return problems


# 6 ─ Datenschutz: keine Verbindung zu fremden Servern
@check('Datenschutz: keine fremden Server (Google Fonts, CDNs)')
def privacy():
    problems = []
    for f in [ROOT / 'index.html', ROOT / 'manifest.webmanifest', *JS_FILES, *(ROOT / 'css').glob('*.css'), ROOT / 'vendor/fonts/fonts.css']:
        for m in re.finditer(r'(?:https?:)?//([a-z0-9.-]+\.[a-z]{2,})', read(f), re.I):
            problems.append(f'{f.relative_to(ROOT)}: Verbindung zu {m.group(1)}')
    cfg = json.loads(read(ROOT / 'config/editions.json'))
    if cfg.get('purchaseUrl') and not cfg['purchaseUrl'].startswith('https://'):
        problems.append('config/editions.json: purchaseUrl muss https:// sein')
    return problems


# 7 ─ Wortwahl nach dem Claims-Leitfaden (Wellness, kein Medizinprodukt)
FORBIDDEN = [r'nystagm', r'patient', r'diagnos', r'schnellcheck', r'quick check', r'therapie', r'krankheitserkennung']
ALLOWED_CONTEXT = [r'not intended to (detect|diagnose)', r'keine diagnose', r'nicht zur diagnose']


@check('Wortwahl (Claims-Leitfaden: nie „Nystagmus“, keine Medizin-Begriffe)')
def wording():
    problems = []
    files = [*(ROOT / 'lang').glob('*.json'), *(ROOT / 'docs').glob('guide_*.md'), ROOT / 'index.html', ROOT / 'manifest.webmanifest']
    for f in files:
        for n, line in enumerate(read(f).splitlines(), 1):
            low = line.lower()
            if any(re.search(a, low) for a in ALLOWED_CONTEXT):
                continue
            for w in FORBIDDEN:
                if re.search(w, low):
                    problems.append(f'{f.relative_to(ROOT)}:{n} enthält „{w}“')
    for f in (ROOT / 'lang').glob('*.json'):
        if f.name == 'languages.json':
            continue
        d = json.loads(read(f))
        if 'instruction' not in d:
            problems.append(f'{f.name}: feste Anweisung „instruction“ fehlt')
    return problems


# 8 ─ Freischaltung: nur Prüfsummen, keine Codes im Klartext
@check('Freischaltung (nur SHA-256-Prüfsummen, gültige Daten)')
def editions():
    problems = []
    cfg = json.loads(read(ROOT / 'config/editions.json'))
    for i, c in enumerate(cfg.get('codes', [])):
        if not re.fullmatch(r'[0-9a-f]{64}', c.get('hash', '')):
            problems.append(f'Eintrag {i + 1}: keine gültige SHA-256-Prüfsumme')
        if c.get('validUntil') and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', c['validUntil']):
            problems.append(f'Eintrag {i + 1}: validUntil muss JJJJ-MM-TT sein')
        if set(c) - {'label', 'hash', 'created', 'validUntil'}:
            problems.append(f'Eintrag {i + 1}: unbekannte Felder {sorted(set(c) - {"label", "hash", "created", "validUntil"})}')
    # Python-Werkzeug und App müssen gleich rechnen (Salz und Normierung)
    js, py = read(ROOT / 'js/edition.js'), read(ROOT / 'tools/new_code.py')
    salt_js = re.search(r"SALT = '([^']+)'", js)
    if not salt_js or salt_js.group(1) not in py:
        problems.append('Salz in js/edition.js und tools/new_code.py verschieden')
    return problems


# 9 ─ Anleitung: zu jeder Sprache .md und aktuelle .docx
@check('Anleitung (je Sprache .md und passende .docx)')
def docs():
    problems = []
    for l in json.loads(read(ROOT / 'lang/languages.json')):
        md, dx = ROOT / f'docs/guide_{l["code"]}.md', ROOT / f'docs/guide_{l["code"]}.docx'
        if not md.exists():
            problems.append(f'docs/guide_{l["code"]}.md fehlt')
            continue
        if not dx.exists():
            problems.append(f'docs/guide_{l["code"]}.docx fehlt')
            continue
        with zipfile.ZipFile(dx) as z:
            text = re.sub(r'<[^>]+>', '', z.read('word/document.xml').decode('utf-8'))
        clean = lambda s: re.sub(r'[\s‎‏ *`]+', '', s)
        doc = clean(text)
        for line in read(md).splitlines():
            if line.startswith('#'):
                h = clean(line.lstrip('#'))
                if h and h not in doc:
                    problems.append(f'guide_{l["code"]}.docx veraltet: Überschrift „{line.lstrip("# ")}“ fehlt (md2docx.py neu ausführen)')
        # Stichprobe Fließtext: jeder Absatz-Anfang muss in der docx stehen
        for line in read(md).splitlines():
            s = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', line.lstrip('-> 0123456789.|'))
            s = clean(s)[:40]
            if len(s) >= 25 and not line.startswith(('#', '|')) and s not in doc:
                problems.append(f'guide_{l["code"]}.docx veraltet: „{line.strip()[:60]}…“ fehlt (md2docx.py neu ausführen)')
                break
    return problems


# 10 ─ Lizenzen der fremden Dateien
@check('Lizenzen der fremden Dateien (vendor/)')
def licenses():
    need = ['vendor/README.md', 'vendor/fonts/OFL.txt', 'vendor/chartjs/LICENSE.md']
    return [f'{p} fehlt' for p in need if not (ROOT / p).exists()]


# 11 ─ Geheimnis-Wächter
@check('Geheimnis-Wächter (tools/secret_guard.py --all)')
def secrets():
    r = subprocess.run([sys.executable, 'tools/secret_guard.py', '--all'], cwd=ROOT, capture_output=True, text=True, timeout=120)
    return [] if r.returncode == 0 else (r.stdout + r.stderr).strip().splitlines()[:15] or ['Wächter meldet Fund']


def main():
    print('Eye Reflex Lab – Quality-Gate\n')
    for name, ok, problems, dt in results:
        key = 'unit' if name.startswith('Modultests') else 'version' if name.startswith('Versionsnummer') else ''
        fn_summary = f' ({SUMMARY[key]})' if key in SUMMARY else ''
        print(f'{"✓" if ok else "✗"} {name}{fn_summary}  [{dt:.1f} s]')
        for p in problems[:25]:
            print(f'    → {p}')
        if len(problems) > 25:
            print(f'    → … und {len(problems) - 25} weitere')
    failed = sum(not ok for _, ok, _, _ in results)
    print()
    if failed:
        print(f'ROT: {failed} von {len(results)} Prüfungen fehlgeschlagen. Nicht veröffentlichen.')
        return 1
    print(f'GRÜN: alle {len(results)} Prüfungen bestanden. Freigabe zur Veröffentlichung.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

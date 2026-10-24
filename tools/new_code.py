#!/usr/bin/env python3
"""Neuen Freischalt-Code für die Studien-Version von Eye Reflex Lab erzeugen.

Der Code wird nur hier im Terminal angezeigt und nirgends gespeichert. In config/editions.json kommt nur seine
SHA-256-Prüfsumme (mit Bezeichnung und optionalem Ablaufdatum). Danach die App wie üblich veröffentlichen
(Versionsnummer ?v= erhöhen, committen, pushen).

Aufruf:
  python3 tools/new_code.py "Kurs Tag 4, Herbst 2026"                  zufälliger Code, unbegrenzt gültig
  python3 tools/new_code.py "Kurs Tag 4, Herbst 2026" --bis 2027-03-31  gültig bis einschließlich 31.03.2027
  python3 tools/new_code.py "Testgerät" --code MEIN-CODE               eigenen Code verwenden

Code sperren: den Eintrag mit der Bezeichnung in config/editions.json löschen und veröffentlichen.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import secrets

SALT = 'eye-reflex-lab|'  # muss zu js/edition.js passen
APP_URL = 'https://twe-nlb.github.io/NLB-OKR/'
ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'  # ohne leicht verwechselbare Zeichen 0/O, 1/I/L
CONFIG = pathlib.Path(__file__).resolve().parent.parent / 'config' / 'editions.json'

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('bezeichnung', help='wofür der Code gilt, z. B. Kursname')
ap.add_argument('--bis', help='gültig bis einschließlich (JJJJ-MM-TT)')
ap.add_argument('--code', help='eigenen Code verwenden statt eines zufälligen')
a = ap.parse_args()

if a.bis:
    datetime.date.fromisoformat(a.bis)  # prüft das Format
code = a.code or 'ERL-' + '-'.join(''.join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(3))
norm = re.sub(r'[^A-Z0-9]', '', code.upper())
if len(norm) < 8:
    raise SystemExit('Der Code ist zu kurz (mindestens 8 Buchstaben oder Ziffern).')
digest = hashlib.sha256((SALT + norm).encode()).hexdigest()

cfg = json.loads(CONFIG.read_text()) if CONFIG.exists() else {'purchaseUrl': '', 'codes': []}
if any(c['hash'] == digest for c in cfg['codes']):
    raise SystemExit('Diesen Code gibt es schon.')
entry = {'label': a.bezeichnung, 'hash': digest, 'created': datetime.date.today().isoformat()}
if a.bis:
    entry['validUntil'] = a.bis
cfg['codes'].append(entry)
CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + '\n')

print(f'Neuer Code für „{a.bezeichnung}“' + (f' (gültig bis {a.bis})' if a.bis else ' (unbegrenzt gültig)'))
print(f'  Code:  {code}')
print(f'  Link:  {APP_URL}?code={code}')
print('Den Code nur an die Berechtigten weitergeben; er wird nirgends gespeichert.')
print('Wirksam, sobald die App mit der geänderten config/editions.json veröffentlicht ist.')

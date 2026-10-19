#!/usr/bin/env python3
"""Claude-Code-Hook (PreToolUse, Bash): verhindert, dass Claude den Geheimnis-Wächter umgeht.

Blockiert git-Befehle, die die Prüfung abschalten (--no-verify, -n bei commit, anderer core.hooksPath),
und Commits/Pushes, solange die Wächter-Hooks (.githooks) nicht eingeschaltet sind.
Exit 2 = Befehl blockiert, die Meldung auf stderr geht an Claude.
"""
import json
import re
import subprocess
import sys


def block(msg):
    print(f'Geheimnis-Wächter: {msg} (siehe CLAUDE.md, Abschnitt „Geheimnis-Wächter“)', file=sys.stderr)
    sys.exit(2)


data = json.load(sys.stdin)
cmd = (data.get('tool_input') or {}).get('command') or ''
if not re.search(r'\bgit\b', cmd):
    sys.exit(0)

# Einzelbefehle (getrennt durch ; && || | Zeilenumbruch) einzeln betrachten
for part in re.split(r'&&|\|\||[;|\n]', cmd):
    if not re.search(r'\bgit\b', part):
        continue
    if '--no-verify' in part:
        block('--no-verify ist verboten, die Prüfung auf Geheimnisse darf nicht übersprungen werden.')
    bare = re.sub(r'"[^"]*"|\'[^\']*\'', '""', part)  # Text in Anführungszeichen (z. B. Commit-Nachricht) ignorieren
    if re.search(r'\bcommit\b', bare) and re.search(r'(?:^|\s)-[a-zA-Z]*n[a-zA-Z]*(?=\s|$)', bare):
        block('„git commit -n“ überspringt die Prüfung und ist verboten.')
    # Lesen und Setzen auf .githooks ist erlaubt, alles andere (ändern, löschen, -c beim Aufruf) nicht
    if re.search(r'hooksPath', part, re.I) and not re.fullmatch(
            r'\s*git\s+config\s+(?:--local\s+)?(?:--get\s+core\.hooksPath|core\.hooksPath(?:\s+\.githooks)?)\s*', part):
        block('core.hooksPath darf nur auf .githooks gesetzt werden.')

if re.search(r'\bgit\b[^;&|\n]*\b(?:commit|push)\b', cmd):
    try:
        hooks = subprocess.run(['git', 'config', '--get', 'core.hooksPath'], cwd=data.get('cwd') or None,
                               capture_output=True, text=True).stdout.strip()
    except OSError:
        hooks = ''
    if hooks != '.githooks':
        block('Die Wächter-Hooks sind nicht aktiv. Zuerst ausführen: git config core.hooksPath .githooks')
sys.exit(0)

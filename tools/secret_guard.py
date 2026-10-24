#!/usr/bin/env python3
"""Geheimnis-Wächter: verhindert, dass Passwörter, Schlüssel, Tokens oder Messdaten ins Repo gelangen.

Aufruf (läuft automatisch über .githooks, siehe CLAUDE.md):
  secret_guard.py             prüft die zum Commit vorgemerkten Änderungen (pre-commit)
  secret_guard.py --push      prüft alle Commits, die gepusht werden sollen (pre-push, Zeilen von stdin)
  secret_guard.py --all       prüft alle Dateien im aktuellen Stand
  secret_guard.py --history   prüft jeden Commit der gesamten Versionsgeschichte

Harmlose Zeile, die fälschlich anschlägt: in derselben Zeile „secret-guard: allow“ vermerken.
Nur Standardbibliothek, läuft ab Python 3.8.
"""
import io
import re
import subprocess
import sys
import zipfile

ALLOW = 'secret-guard: allow'
EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

# Inhalte, die nie ins Repo dürfen
PATTERNS = [
    ('privater Schlüssel', re.compile(r'-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----')),
    ('AWS-Zugangsschlüssel', re.compile(r'\b(?:AKIA|ASIA)[0-9A-Z]{16}\b')),
    ('GitHub-Token', re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})')),
    ('Anthropic-API-Schlüssel', re.compile(r'\bsk-ant-[A-Za-z0-9_\-]{20,}')),
    ('OpenAI-API-Schlüssel', re.compile(r'\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_\-]{32,}')),
    ('Google-API-Schlüssel', re.compile(r'\bAIza[0-9A-Za-z_\-]{35}')),
    ('Slack-Token', re.compile(r'\bxox[abposr]-[A-Za-z0-9-]{10,}')),
    ('Stripe-Schlüssel', re.compile(r'\b[rs]k_live_[0-9A-Za-z]{20,}')),
    ('Freischalt-Code (Eye Reflex Lab)', re.compile(r'\bERL-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}\b')),
    ('JSON Web Token', re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}')),
    ('Zugangsdaten in einer Adresse', re.compile(r'\b[a-z][a-z0-9+.-]*://[^\s/:@"\']+:[^\s/@"\']{4,}@')),
    ('Passwort/Schlüssel im Klartext', re.compile(
        r'(?i)\b(?:password|passwd|passwort|kennwort|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|'
        r'client[_-]?secret|private[_-]?key)\b["\']?\s*[:=]\s*["\'][^"\'\s]{8,}["\']')),
]

# Dateien, die nie ins Repo dürfen (Pfad relativ zum Repo)
BLOCKED_FILES = [
    ('Umgebungsdatei mit Zugangsdaten', re.compile(r'(?:^|/)\.env(?:\.(?!example$|sample$|template$)[^/]*)?$')),
    ('Schlüssel- oder Zertifikatsdatei', re.compile(r'\.(?:pem|p12|pfx|jks|keystore|ppk|gpg)$', re.I)),
    ('privater SSH-Schlüssel', re.compile(r'(?:^|/)id_(?:rsa|dsa|ecdsa|ed25519)$')),
    ('Zugangsdaten-Datei', re.compile(r'(?:^|/)(?:\.netrc|\.npmrc|\.pypirc|credentials(?:\.[a-z]+)?|secrets?(?:\.[a-z]+)?)$', re.I)),
    ('Dienstkonto-Schlüssel', re.compile(r'(?:^|/)[^/]*service[-_]?account[^/]*\.json$', re.I)),
    ('Messdaten einer Person (Gesundheitsdaten)', re.compile(r'(?:^|/)OKR_[^/]*\.(?:json|csv)$')),
    ('persönliche Claude-Einstellungen', re.compile(r'(?:^|/)\.claude/settings\.local\.json$')),
]

OFFICE = re.compile(r'\.(?:docx|xlsx|pptx|odt|ods|odp)$', re.I)


def git(*args, data=None):
    return subprocess.run(['git', *args], input=data, capture_output=True, check=True).stdout


def mask(s):
    return s[:6] + '…' if len(s) > 6 else s


def scan_text(path, lines, findings):
    """lines: Liste (Zeilennummer, Text)."""
    for no, line in lines:
        if ALLOW in line:
            continue
        for name, rx in PATTERNS:
            m = rx.search(line)
            if m:
                where = f'{path}:{no}' if no else path
                findings.append(f'{where}: {name} ({mask(m.group(0))})')


def office_text(blob):
    try:
        z = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        return None
    parts = []
    for n in z.namelist():
        if n.endswith('.xml') or n.endswith('.rels'):
            xml = z.read(n).decode('utf-8', 'replace')
            parts.append(re.sub(r'<[^>]+>', ' ', xml))
    return '\n'.join(parts)


def check_name(path, findings):
    for name, rx in BLOCKED_FILES:
        if rx.search(path):
            findings.append(f'{path}: {name} – diese Datei darf nicht ins Repo')
            return True
    return False


def added_lines(diff_args, path):
    """Hinzugefügte Zeilen einer Datei mit Zeilennummern aus einem git-diff (-U0)."""
    out = git('diff', '-U0', '--no-color', '--no-ext-diff', *diff_args, '--', path).decode('utf-8', 'replace')
    lines, no = [], 0
    for line in out.splitlines():
        if line.startswith('@@'):
            m = re.search(r'\+(\d+)', line)
            no = int(m.group(1)) if m else 0
        elif line.startswith('+') and not line.startswith('+++'):
            lines.append((no, line[1:]))
            no += 1
    return lines


def scan_change(diff_args, blob_ref, label, findings):
    """Alle in einer Änderung hinzugekommenen oder geänderten Dateien prüfen."""
    names = git('diff', '--name-only', '-z', '--diff-filter=ACMR', '--no-renames', *diff_args).decode('utf-8', 'replace')
    for path in filter(None, names.split('\0')):
        shown = f'{label}{path}'
        if check_name(path, findings):
            continue
        if OFFICE.search(path):
            text = office_text(git('show', f'{blob_ref}:{path}'))
            if text is not None:
                scan_text(f'{shown} (Dokumenttext)', [(0, t) for t in text.splitlines()], findings)
            continue
        if b'\0' in git('show', f'{blob_ref}:{path}')[:8000]:
            continue  # Bild oder andere Binärdatei
        scan_text(shown, added_lines(diff_args, path), findings)


def scan_commit(sha, findings):
    parents = git('rev-list', '--parents', '-n', '1', sha).decode().split()[1:]
    base = parents[0] if parents else EMPTY_TREE
    scan_change([base, sha], sha, f'Commit {sha[:7]}: ', findings)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--staged'
    findings = []
    if mode == '--staged':
        scan_change(['--cached'], '', '', findings)
    elif mode == '--push':
        zero = '0' * 40
        for line in sys.stdin.read().splitlines():
            parts = line.split()
            if len(parts) < 4 or parts[1] == zero:
                continue  # Zweig wird gelöscht
            local, remote = parts[1], parts[3]
            rng = [local, '--not', '--remotes'] if remote == zero else [f'{remote}..{local}']
            for sha in git('rev-list', *rng).decode().split():
                scan_commit(sha, findings)
    elif mode == '--all':
        for path in filter(None, git('ls-files', '-z').decode('utf-8', 'replace').split('\0')):
            if check_name(path, findings):
                continue
            blob = git('show', f':{path}')
            if OFFICE.search(path):
                text = office_text(blob)
                if text is not None:
                    scan_text(f'{path} (Dokumenttext)', [(0, t) for t in text.splitlines()], findings)
            elif b'\0' not in blob[:8000]:
                scan_text(path, enumerate(blob.decode('utf-8', 'replace').splitlines(), 1), findings)
    elif mode == '--history':
        for sha in git('rev-list', '--all').decode().split():
            scan_commit(sha, findings)
    else:
        print(__doc__)
        return 2

    if findings:
        print('\n✋ Geheimnis-Wächter: Commit/Push gestoppt. Gefunden:', file=sys.stderr)
        for f in dict.fromkeys(findings):
            print('   ' + f, file=sys.stderr)
        print('\nBitte das Geheimnis entfernen (z. B. in eine nicht versionierte Datei auslagern) und neu vormerken.\n'
              'Fehlalarm in einer harmlosen Zeile: dort „secret-guard: allow“ vermerken.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

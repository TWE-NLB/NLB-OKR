# NLB-OKR – Hinweise für Claude

## Projekt

Demo-Web-App für einen OKR/OKN-Schnellcheck (optokinetischer Reflex) auf iPad/iPhone, Augen-Tracking über die Frontkamera.
Statische Seite ohne Build-Schritt, veröffentlicht über GitHub Pages: https://twe-nlb.github.io/NLB-OKR/

**Das Repo ist öffentlich.** Alles, was hier committet wird, ist für alle sichtbar und wird von automatischen Programmen kopiert. Ein einmal gepushtes Geheimnis gilt als verraten, auch wenn es später gelöscht wird.

## Arbeitsweise

- Mit dem Nutzer auf Deutsch kommunizieren, in einfacher, klarer Sprache.
- Commit und Push nur, wenn der Nutzer es ausdrücklich verlangt. Commit-Nachrichten auf Deutsch.
- Bedienung der App muss einfach und eindeutig bleiben; Änderungen in der Vorschau prüfen (`.claude/launch.json`, Server „okr“).

## Aufbau

| Pfad | Inhalt |
|------|--------|
| `index.html`, `css/app.css` | Seite und Layout (auch Rechts-nach-links für Hebräisch) |
| `js/app.js` | Ablauf: Personen, Setup-Check, Kalibrierung, Messung, Ergebnis, Export |
| `js/analysis.js` | Auswertung ohne DOM (Gain, Asymmetrie, Kalibrierung); Tests in `test/` |
| `js/stage.js`, `js/charts.js`, `js/tracker.js`, `js/store.js` | Muster/Figuren, Diagramme, Gesichtserkennung, Speicher |
| `js/i18n.js`, `lang/*.json` | Sprachen; alle Texte stehen in `lang/<code>.json`, nie im Code |
| `docs/` | Dokumentation (deutsches .docx, englisches PDF), Quellen aus PubMed |
| `tools/`, `.githooks/` | Geheimnis-Wächter (siehe unten) |

## Veröffentlichen

1. Tests: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/analysis.test.js`
2. Versionsnummer `?v=` in `index.html` und in allen `import`-Zeilen unter `js/` erhöhen (sonst lädt Safari alte Dateien gemischt). Die Sprachdateien übernehmen sie automatisch.
3. Neue Texte in **allen** Dateien unter `lang/` ergänzen. Die feste Anweisung (`instruction`) nie ohne Rückfrage ändern.

## Geheimnis-Wächter (verbindlich)

**Ins Repo dürfen niemals:** Passwörter, API-Schlüssel, Tokens, private Schlüssel und Zertifikate, Zugangsdaten in Adressen, `.env`-Dateien sowie Messdaten von Personen (Exporte `OKR_*.json` / `OKR_*.csv` = Gesundheitsdaten).

Durchgesetzt wird das technisch in drei Stufen:

1. **git-Hooks** (`.githooks/pre-commit`, `.githooks/pre-push` → `tools/secret_guard.py`): stoppen jeden Commit und jeden Push, der ein Geheimnis oder eine gesperrte Datei enthält, auch in Word-Dokumenten. Gilt für jeden, der in diesem Ordner committet.
2. **Claude-Code-Hook** (`.claude/settings.json` → `tools/claude_git_guard.py`): verhindert, dass Claude die Prüfung umgeht, und lässt Commits/Pushes erst zu, wenn die git-Hooks aktiv sind.
3. **GitHub** (Server): Secret Scanning mit Push-Schutz ist eingeschaltet; `main` ist gegen Löschen und Überschreiben der Versionsgeschichte geschützt.

**Nach jedem neuen Klonen einmal ausführen:** `git config core.hooksPath .githooks`

**Regeln für Claude:**

- Niemals `--no-verify`, `git commit -n`, einen anderen `core.hooksPath` oder sonstige Wege nutzen, die Prüfung zu umgehen.
- `.githooks/`, `tools/secret_guard.py`, `tools/claude_git_guard.py` und den Hook in `.claude/settings.json` nicht abschwächen oder entfernen, außer der Nutzer verlangt es ausdrücklich.
- Schlägt der Wächter an: das Geheimnis entfernen bzw. die Datei aus dem Commit nehmen, nicht die Prüfung umgehen. Dem Nutzer sagen, was gefunden wurde (ohne den Wert zu wiederholen).
- Ist doch ein Geheimnis veröffentlicht worden: den Nutzer sofort informieren. Das Geheimnis muss beim Anbieter gesperrt und ersetzt werden; Löschen aus dem Repo reicht nicht.
- Fehlalarm in einer harmlosen Zeile: nur nach Rückfrage beim Nutzer in derselben Zeile `secret-guard: allow` vermerken.
- Geheimnisse, die die App künftig braucht, gehören in nicht versionierte Dateien (`.env`, `.claude/settings.local.json`) oder in GitHub-Secrets, nie in den Code.
- Manuelle Prüfung: `python3 tools/secret_guard.py --all` (aktueller Stand) bzw. `--history` (gesamte Versionsgeschichte).

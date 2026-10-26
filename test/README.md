# Tests und Quality-Gate

**Regel:** Eine neue Version wird nur veröffentlicht, wenn **alle** Prüfungen grün sind.
Bei GitHub Pages ist jeder Push auf `main` eine Veröffentlichung. Deshalb läuft das Quality-Gate automatisch vor jedem `git push` (`.githooks/pre-push`) und stoppt den Push, sobald etwas rot ist. Überspringen (`--no-verify`) ist verboten und für Claude technisch gesperrt (`tools/claude_git_guard.py`).

## Ausführen

```bash
python3 tools/quality_gate.py
```

Ergebnis: `GRÜN: alle 11 Prüfungen bestanden` (Exit-Code 0) oder `ROT: …` mit dem Grund je Fehler (Exit-Code 1).
Nur die Modultests: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/run.js`

Voraussetzungen: macOS (JavaScriptCore ist eingebaut) und Python 3. Nichts muss installiert werden.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `test/engine.js` | Test-Engine ohne Abhängigkeiten: `suite`, `test`, `assert`, `run` |
| `test/run.js` | Startet alle Modultests; jede neue `*.test.js` hier eintragen (das Gate prüft das) |
| `test/*.test.js` | Modultests je Programmteil |
| `tools/quality_gate.py` | Quality-Gate: Modultests plus Prüfungen des ganzen Projekts |
| `.githooks/pre-push` | Ruft Geheimnis-Wächter und Quality-Gate vor jedem Push auf |

## Test-Engine

```js
import { suite, test, assert } from './engine.js';
import { median } from '../js/analysis.js';

suite('Statistik', () => {
  test('Median gerade Anzahl', () => assert.equal(median([4, 1, 3, 2]), 2.5));
});
```

| Prüfung | Bedeutung |
|---|---|
| `assert.ok(cond, text)` | Bedingung muss wahr sein |
| `assert.equal(a, b)` | genau gleich (`===`) |
| `assert.deepEqual(a, b)` | gleicher Inhalt (Listen, Objekte) |
| `assert.close(a, b, tol)` | Zahl `b ± tol` (für Messwerte mit Rauschen) |
| `assert.between(a, lo, hi)` | Zahl im Bereich |
| `assert.isNaN(a)` | kein gültiger Wert (z. B. zu wenige Daten) |
| `assert.throws(fn)` | Funktion muss einen Fehler auslösen |

Jeder Test läuft für sich: Ein Fehler oder Absturz in einem Test wird als ✗ mit Grund gemeldet, die übrigen laufen weiter. Am Ende steht `RESULT pass=… fail=…`; diese Zeile wertet das Gate aus.

Künstliche Messdaten (Sägezahn mit Rauschen, nachgebaute Gesichtspunkte) erzeugen die Tests selbst mit festem Zufalls-Startwert. Es werden nie echte Messdaten von Personen verwendet.

## Modultests (67)

| Datei | Programmteil | Was geprüft wird |
|---|---|---|
| `stats.test.js` | `js/analysis.js` Grundfunktionen | Median, Mittelwert, Streuung, Ausgleichsgerade, Richtungsunterschied; Randfälle: leere Listen, fehlende Werte, Division durch null; Richtungen |
| `analysis.test.js` | `js/analysis.js` Auswertung | Gain, Schlagfrequenz und Amplitude aus künstlichem Sägezahn; Qualität; Kalibrierung mit 9 und 5 Punkten, ohne Augenbewegung; Zusammenfassung, Bewertung „gering / deutlich / unklar“, ungültige Durchgänge |
| `eyetrace.test.js` | `js/eyetrace.js` Augenspur | Speichern/Laden der Gesichtspunkte; Irisdurchmesser, mm-Maßstab, Vorzeichen, vertauschte Iris-Punkte, Kopfneigung; Mitgleiten in °/s und mm/s, Rücksprünge, Breite der Reflexbewegung je Rücksprung und im Mittel mit Schwankung; Messschwankung; Glätten (Zittern kleiner, Rücksprünge scharf, Gerade bleibt Gerade) |

Nicht als Modultest abgedeckt sind Teile, die Kamera, Bildschirm oder Speicher des Browsers brauchen (`app.js`, `tracker.js`, `stage.js`, `store.js`, `eyeview.js`). Diese werden in der Vorschau (`.claude/launch.json`, Server „okr“) geprüft.

## Prüfungen des Quality-Gates (11)

| Nr. | Prüfung | Rot, wenn … |
|---|---|---|
| 1 | Modultests | ein Test fehlschlägt, keine Tests laufen oder eine `*.test.js` nicht in `run.js` steht |
| 2 | Syntax | eine Datei in `js/` oder `test/` einen Syntaxfehler hat |
| 3 | Sprachdateien | in einer Sprache ein Text fehlt oder zu viel ist, Platzhalter wie `{name}` abweichen, ein Text leer ist, der Code einen nicht vorhandenen Text benutzt oder `languages.json` unvollständig ist |
| 4 | Versionsnummer | `?v=` in `index.html` und den Imports unter `js/` nicht überall gleich ist (sonst mischt Safari alte und neue Dateien) |
| 5 | Verweise | eine Datei fehlt, auf die `index.html`, ein Import, das Manifest oder `fonts.css` zeigt; MediaPipe, Modell oder Chart.js fehlen |
| 6 | Datenschutz | Code, Seite oder Stil eine Adresse eines fremden Servers enthält (Google Fonts, CDNs) |
| 7 | Wortwahl | Texte oder Anleitung „Nystagmus“, „Patient“, „Diagnose“, „Therapie“ oder den alten Namen „Schnellcheck“ enthalten (Ausnahme: Hinweis „nicht zur Diagnose“); die feste Anweisung fehlt |
| 8 | Freischaltung | `config/editions.json` etwas anderes als SHA-256-Prüfsummen enthält oder App und `new_code.py` verschieden rechnen |
| 9 | Anleitung | zu einer Sprache `guide_*.md` oder `.docx` fehlt oder die `.docx` nicht zur `.md` passt (dann `md2docx.py` neu ausführen) |
| 10 | Lizenzen | Lizenztexte der fremden Dateien in `vendor/` fehlen |
| 11 | Geheimnis-Wächter | `tools/secret_guard.py --all` ein Geheimnis oder eine gesperrte Datei findet |

## Neue Tests hinzufügen

1. Neue Datei `test/<thema>.test.js` mit `suite` und `test` anlegen.
2. In `test/run.js` importieren.
3. `python3 tools/quality_gate.py` ausführen, alles muss grün sein.

Neue Funktion → neuer Test im selben Schritt. Ein gefundener Fehler → zuerst ein Test, der ihn zeigt (rot), dann die Korrektur (grün).

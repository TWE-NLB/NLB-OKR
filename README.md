# NLB-OKR

Demo: Messung des optokinetischen Reflexes (OKR/OKN) auf iPad oder iPhone. Ein schwarz-weißes Streifenband läuft über den Bildschirm. Die Frontkamera verfolgt dabei die Augen, und die App berechnet daraus den Gain und weitere Kennwerte.

**App öffnen:** https://twe-nlb.github.io/NLB-OKR/ (in Safari, Gerät quer halten)

**Sprachen:** Deutsch, Englisch, Hebräisch. Auswahl oben rechts in der App; die Wahl wird gespeichert. Direkte Links: `?lang=de`, `?lang=en`, `?lang=he` (z. B. https://twe-nlb.github.io/NLB-OKR/?lang=he). Der alte Link https://twe-nlb.github.io/NLB-OKR/EN/ öffnet die App auf Englisch. Alle Sprachen teilen sich auf einem Gerät dieselben Messungen.

## Ablauf (Schnellcheck)

1. **Gerät einmalig einrichten:** Abstand Auge–Bildschirm und Gerätetyp. Gemessen wird immer quer im Ständer.
2. **Person anlegen** (nur Pseudonyme). Pro Person werden die Messbedingungen gespeichert: Muster (Streifen oder Symbole: Stern, Mond, Sonne, Fisch, Hund, Hase, Elefant zufällig gemischt), Farbe (Schwarz, Rot, Blau auf Weiß), Breite (Standard 8°), zwei Geschwindigkeiten (Standard 8 und 12 °/s), optional senkrecht.
3. **Anweisung vorlesen** (steht wörtlich in der App) und „Messung starten“.
4. **Setup-Check:** Sobald Kamera, Gesicht, Augen, Licht, Position und Ruhe passen, startet die Kalibrierung automatisch (Hase als Blickziel).
5. **Messung:** ← → im Wechsel, je 3 Runden pro Geschwindigkeit (optional ↑ ↓ ebenso), 8 s je Runde. Ungültige Runden werden am Ende einmal automatisch wiederholt. Antippen pausiert.
6. **Ergebnis:** Asymmetrie rechts/links mit Messschwankung (95-%-Vertrauensbereich aus den Wiederholungen) und Bewertung, Asymmetrie oben/unten, Gain. Verglichen wird nur mit früheren Messungen derselben Person unter gleichen Bedingungen; die erste ist die Ausgangsmessung.

## Daten

- Die Messungen liegen im Browser-Speicher des Geräts. Es wird nichts an einen Server gesendet, und es wird kein Video gespeichert.
- **Exportieren** öffnet das Teilen-Menü: *In „Dateien“ sichern*, AirDrop oder die SeaFile-App.
- Jede Messung wird als `.json` (vollständig, wieder importierbar) und als `.csv` (für Excel, Zahlenformat passend zur Sprache) gespeichert.
- **Importieren** lädt `.json`-Dateien zurück, zum Beispiel auf einem anderen Gerät.
- Safari kann Website-Daten nach längerer Nichtnutzung löschen. Deshalb Messungen regelmäßig exportieren.
- Tipp: Über *Teilen → Zum Home-Bildschirm* läuft die App im Vollbild.

## Messprinzip

- **Augenposition:** Iris-Mittelpunkt relativ zur Linie zwischen den Augenwinkeln (MediaPipe Face Landmarker), normiert auf die Augenbreite. Die Kalibrierung rechnet diesen Wert in Grad um.
- **Asymmetrie:** je Runde (rechts − links) ÷ Mittelwert × 100 %, gemittelt über alle Wiederholungen; „deutlich“ ab 10 % und wenn der Vertrauensbereich die Null nicht einschließt (Festlegung der App).
- **Gain:** Median der Augengeschwindigkeit in der langsamen Phase geteilt durch die Streifengeschwindigkeit.
  - Schnelle Phasen (Rücksprünge) werden über eine Geschwindigkeitsschwelle erkannt.
  - Die Streifengeschwindigkeit in °/s wird über die Gesichtsgröße an den aktuellen Abstand angepasst.
- **Wackeln:** schnelle Gesichtsbewegung im Kamerabild. Betroffene Abschnitte fließen nicht in den Gain ein.
- **Grenzen:**
  - Etwa 30 Bilder/s: Die schnellen Phasen werden nur grob erfasst, die langsame Phase und damit der Gain gut.
  - Das ist kein Medizinprodukt.

## Dokumentation

[docs/NLB-OKR_Dokumentation.docx](docs/NLB-OKR_Dokumentation.docx) erklärt die App und alle Messwerte, mit Bezug zu Hirnbereichen und Augenmuskeln und 39 PubMed-Quellen. Neu erzeugen mit `python3 docs/make_doc.py docs/NLB-OKR_Dokumentation.docx` (benötigt `python-docx`).

## Sprachen hinzufügen

Alle Texte der App stehen in `lang/<code>.json` (ein Eintrag je Text, z. B. `"start_measurement": "Messung starten"`), die Liste der Sprachen in `lang/languages.json`. Eine neue Sprache braucht keine Programmänderung:

1. `lang/en.json` kopieren, z. B. nach `lang/fr.json`, und nur die Texte rechts vom Doppelpunkt übersetzen. Platzhalter in geschweiften Klammern wie `{n}` oder `{name}` unverändert lassen.
2. In `lang/languages.json` eintragen: `{ "code": "fr", "flag": "🇫🇷", "name": "Français", "locale": "fr-FR" }`. Die Flagge ist ein Emoji und erscheint in der Sprachauswahl vor dem Namen. Für Schrift von rechts nach links (Hebräisch, Arabisch) zusätzlich `"dir": "rtl"`.
3. Versionsnummer `?v=` erhöhen (siehe unten) und hochladen.

Fehlt in einer Sprache ein Text, zeigt die App die englische Fassung. Die feste Anweisung (`instruction`) muss in jeder Sprache sorgfältig übersetzt und danach nicht mehr verändert werden, sonst sind Messungen nicht vergleichbar.

## Entwicklung

Statische Seite ohne Build-Schritt (`index.html`, `css/`, `js/`). Auswertungstests:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/analysis.test.js
```

Lokal starten mit `python3 -m http.server 8765`. Bei jeder Veröffentlichung die Versionsnummer `?v=` in `index.html` und in allen `import`-Zeilen unter `js/` erhöhen (die Sprachdateien übernehmen sie automatisch), sonst lädt Safari teils alte Dateien. Für die Kamera auf iPad oder iPhone ist HTTPS nötig, also über GitHub Pages testen.

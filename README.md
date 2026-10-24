# Eye Reflex Lab

**Das Experiment zum optokinetischen Reflex.** Repository `NLB-OKR`.

Wellness- und Lehranwendung: Sie macht sichtbar, wie die Augen einem bewegten Muster folgen (optokinetischer Reflex, OKR/OKN). Ein Streifen- oder Symbolband läuft über den Bildschirm, die Frontkamera verfolgt dabei die Augen, und die App berechnet daraus den Gain und den Richtungsunterschied. Läuft auf iPad, iPhone und Android.

> **Eye Reflex Lab ist eine Wellness- und Lehranwendung, kein Medizinprodukt.** Sie dient nicht der Erkennung, Überwachung oder Behandlung von Krankheiten und ersetzt keine ärztliche Untersuchung.

**App öffnen:** https://twe-nlb.github.io/NLB-OKR/ (iPhone/iPad: Safari, Android: Chrome; Gerät quer im Ständer)

**Anleitung:** [Deutsch](docs/guide_de.md) · [English](docs/guide_en.md) · [עברית](docs/guide_he.md) (jeweils auch als Word-Datei in `docs/`)

**Sprachen:** Deutsch, Englisch, Hebräisch. Auswahl oben rechts in der App; die Wahl wird gespeichert. Direkte Links: `?lang=de`, `?lang=en`, `?lang=he` (z. B. https://twe-nlb.github.io/NLB-OKR/?lang=he). Der alte Link https://twe-nlb.github.io/NLB-OKR/EN/ öffnet die App auf Englisch. Alle Sprachen teilen sich auf einem Gerät dieselben Messungen.

## Zwei Versionen

| | Freemium | Studien („Study cases“) |
|---|---|---|
| Messen und Ergebnis ansehen | ✓ | ✓ |
| Versuchsbedingungen | nur für die laufende Sitzung | je Teilnehmende gespeichert |
| Teilnehmende und Messungen speichern, Messreihen vergleichen, Export/Import | – | ✓ |
| Augenspur (vergrößerte Augen, Striche, Kurve, Grad und mm) | Standbild eines Durchgangs | Abspielen in Zeitlupe, alle Durchgänge, gespeichert |

- **Freischaltung** der Studien-Version per Code: in der App unter „Version“ eingeben oder per Link `https://twe-nlb.github.io/NLB-OKR/?code=…` (z. B. als QR-Code auf einer Kursfolie). Die Freischaltung gilt je Gerät, optional mit Ablaufdatum.
- **Neuer Code:** `python3 tools/new_code.py "Kursname" --bis 2027-03-31`. Das Skript zeigt den Code und den Link einmalig an und trägt nur die SHA-256-Prüfsumme in `config/editions.json` ein. Danach veröffentlichen. Code sperren: Eintrag in `config/editions.json` löschen.
- **Schutz:** bewusst einfach. Die Codes selbst stehen nirgends im Repo; wer den Programmcode verändert, kann die Sperre aber umgehen.
- **Bezahlung (vorbereitet, nicht gebaut):** `purchaseUrl` in `config/editions.json` eintragen, dann zeigt die App „Freischalt-Code erhalten“ mit diesem Link (z. B. Kursbuchung oder Shop, der nach dem Kauf einen Code verschickt).

## Ablauf

1. **Gerät einmalig einrichten:** Abstand Auge–Bildschirm und Gerätetyp (iPad, iPhone) bzw. bei Android der Karten-Abgleich zur Ermittlung der Bildschirmauflösung: Eine Kundenkarte o. ä. in Kreditkartengröße wird an einen Rahmen auf dem Bildschirm gehalten, nur die Größe wird verglichen. Gemessen wird immer quer im Ständer.
2. **Teilnehmende anlegen** (Studien; nur Codes oder Pseudonyme). Pro Teilnehmenden werden die Versuchsbedingungen gespeichert: Reizmuster (Streifen oder Symbole: Stern, Mond, Sonne, Fisch, Hund, Hase, Elefant zufällig gemischt), Farbe (Schwarz, Rot, Blau auf Weiß), Breite (Standard 8°), zwei Geschwindigkeiten (Standard 8 und 12 °/s), optional senkrecht.
3. **Instruktion vorlesen** (steht wörtlich in der App) und „Messung starten“.
4. **Setup-Check:** Sobald Kamera, Gesicht, Augen, Licht, Position und Ruhe passen, startet die Kalibrierung automatisch (Hase als Blickziel).
5. **Messung:** ← → im Wechsel, je 3 Durchgänge pro Geschwindigkeit (optional ↑ ↓ ebenso), 8 s je Durchgang. Ungültige Durchgänge werden am Ende einmal automatisch wiederholt. Antippen pausiert.
6. **Ergebnis:** Richtungsunterschied rechts/links mit Messschwankung (95-%-Vertrauensbereich aus den Wiederholungen), Richtungsunterschied oben/unten, Gain. Die Werte sind eine Beobachtung, keine Bewertung. In der Studien-Version wird nur mit früheren Messungen derselben Teilnehmenden unter gleichen Versuchsbedingungen verglichen; Bezugspunkt ist die erste Messung.

## Daten

- Freemium speichert keine Teilnehmenden und Messungen. In der Studien-Version liegen sie im Browser-Speicher des Geräts. Es wird nichts an einen Server gesendet, und es wird kein Video gespeichert.
- **Exportieren** öffnet das Teilen-Menü, z. B. *In „Dateien“ sichern*, AirDrop oder eine Cloud-App.
- Jede Messung wird als `.json` (vollständig, wieder importierbar) und als `.csv` (für Excel, Zahlenformat passend zur Sprache) gespeichert.
- **Importieren** lädt `.json`-Dateien zurück, zum Beispiel auf einem anderen Gerät.
- Der Browser kann Website-Daten nach längerer Nichtnutzung löschen. Deshalb Messungen regelmäßig exportieren.
- Tipp: Als App auf dem Startbildschirm läuft sie im Vollbild (iPhone/iPad: Safari → *Teilen → Zum Home-Bildschirm*; Android: *App installieren*).

## Messprinzip

- **Augenposition:** Iris-Mittelpunkt relativ zur Linie zwischen den Augenwinkeln (MediaPipe Face Landmarker), normiert auf die Augenbreite. Die Kalibrierung rechnet diesen Wert in Grad um.
- **Richtungsunterschied (Asymmetrie):** je Durchgang (rechts − links) ÷ Mittelwert × 100 %, gemittelt über alle Wiederholungen; angezeigt ab 10 % und wenn der Vertrauensbereich die Null nicht einschließt (Festlegung der App).
- **Gain:** Median der Augengeschwindigkeit in der langsamen Phase geteilt durch die Streifengeschwindigkeit.
  - Schnelle Phasen (Rücksprünge) werden über eine Geschwindigkeitsschwelle erkannt.
  - Die Streifengeschwindigkeit in °/s wird über die Gesichtsgröße an den aktuellen Abstand angepasst.
- **Kopfbewegung:** schnelle Gesichtsbewegung im Kamerabild. Betroffene Abschnitte fließen nicht in den Gain ein.
- **Augenspur:** Je Kamerabild werden 17 Gesichtspunkte pro Auge gespeichert (Augenwinkel, Lidrand, Iris-Mitte und -Rand; keine Bilder, ca. 1 MB je Messung). Daraus zeichnet die App die Augen vergrößert nach. Position in Grad aus der Kalibrierung, in mm über den Irisdurchmesser (≈ 11,7 mm) als Maßstab; Mitgleiten und Rücksprung mit denselben Schwellen wie die Gain-Auswertung.
- **Grenzen:**
  - Etwa 30 Bilder/s: Die schnellen Phasen werden nur grob erfasst, die langsame Phase und damit der Gain gut.

## Dokumentation

Die öffentliche Anleitung in Wellness-Sprache gibt es in allen App-Sprachen: [docs/guide_de.md](docs/guide_de.md), [docs/guide_en.md](docs/guide_en.md), [docs/guide_he.md](docs/guide_he.md), jeweils auch als `.docx`. Alle Texte über die App folgen dem Claims-Leitfaden im (privaten) Marketing-Repo. Der wissenschaftliche Hintergrund liegt intern im Marketing-Repo und wird nicht mit der App veröffentlicht.

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
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/eyetrace.test.js
```

Lokal starten mit `python3 -m http.server 8765`. Bei jeder Veröffentlichung die Versionsnummer `?v=` in `index.html` und in allen `import`-Zeilen unter `js/` erhöhen (die Sprachdateien übernehmen sie automatisch), sonst lädt Safari teils alte Dateien. Für die Kamera auf dem Gerät ist HTTPS nötig, also über GitHub Pages testen.

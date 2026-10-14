# NLB-OKR

Demo: Messung des optokinetischen Reflexes (OKR/OKN) auf iPad oder iPhone. Ein schwarz-weißes Streifenband läuft über den Bildschirm. Die Frontkamera verfolgt dabei die Augen, und die App berechnet daraus den Gain und weitere Kennwerte.

**App öffnen:** https://twe-nlb.github.io/NLB-OKR/ (in Safari, Gerät quer halten)

## Ablauf

1. **Person anlegen.** Bitte nur Pseudonyme verwenden.
2. **Einstellungen prüfen:**
   - Haltung (Ständer oder in der Hand) und Abstand.
   - Gerät, also die Bildschirmdichte.
   - Richtungen ← → ↑ ↓ und Geschwindigkeiten (Standard 10/20/30 °/s, 10 s je Block).
3. **Setup-Check:** Kamera, Gesicht, Augen, Licht, Position und Ruhe müssen grün sein. Zusätzlich muss der gemessene Abstand bestätigt werden.
4. **Kalibrierung:**
   - Ein Punkt erscheint nacheinander Mitte → links → rechts → oben → unten.
   - Die Messung startet nur, wenn die Kalibrierung die Qualitätsprüfung besteht.
5. **Messung:**
   - Vor jedem Block erscheinen 3 s Fixierkreuz mit Richtungspfeil.
   - Antippen pausiert die Messung. Danach lässt sich fortsetzen, der letzte Block wiederholen, ein Block überspringen oder die Messung beenden.
   - Ist ein Block nicht auswertbar, schlägt die App vor, ihn zu wiederholen.
6. **Ergebnis:** Gain je Richtung und Geschwindigkeit, Schlagfrequenz, Amplitude, Asymmetrie und die Augenbewegung als Kurve.
7. **Vergleich:** Zwei oder mehr Messungen anhaken. Die App zeigt eine Tabelle mit den Abweichungen zur ältesten Messung, Gain-Diagramme je Richtung und ein Asymmetrie-Diagramm.

## Daten

- Die Messungen liegen im Browser-Speicher des Geräts. Es wird nichts an einen Server gesendet, und es wird kein Video gespeichert.
- **Exportieren** öffnet das Teilen-Menü: *In „Dateien“ sichern*, AirDrop oder die SeaFile-App.
- Jede Messung wird als `.json` (vollständig, wieder importierbar) und als `.csv` (für Excel, deutsches Format) gespeichert.
- **Importieren** lädt `.json`-Dateien zurück, zum Beispiel auf einem anderen Gerät.
- Safari kann Website-Daten nach längerer Nichtnutzung löschen. Deshalb Messungen regelmäßig exportieren.
- Tipp: Über *Teilen → Zum Home-Bildschirm* läuft die App im Vollbild.

## Messprinzip

- **Augenposition:** Iris-Mittelpunkt relativ zur Linie zwischen den Augenwinkeln (MediaPipe Face Landmarker), normiert auf die Augenbreite. Die Kalibrierung rechnet diesen Wert in Grad um.
- **Gain:** Median der Augengeschwindigkeit in der langsamen Phase geteilt durch die Streifengeschwindigkeit.
  - Schnelle Phasen (Rücksprünge) werden über eine Geschwindigkeitsschwelle erkannt.
  - Die Streifengeschwindigkeit in °/s wird über die Gesichtsgröße an den aktuellen Abstand angepasst.
- **Wackeln:** Gyroskop (Gerätedrehung über 20 °/s) oder schnelle Gesichtsbewegung im Kamerabild. Betroffene Abschnitte fließen nicht in den Gain ein.
- **Grenzen:**
  - Etwa 30 Bilder/s: Die schnellen Phasen werden nur grob erfasst, die langsame Phase und damit der Gain gut.
  - Das ist kein Medizinprodukt.

## Dokumentation

[docs/NLB-OKR_Dokumentation.docx](docs/NLB-OKR_Dokumentation.docx) erklärt die App und alle Messwerte, mit Bezug zu Hirnbereichen und Augenmuskeln und 39 PubMed-Quellen. Neu erzeugen mit `python3 docs/make_doc.py docs/NLB-OKR_Dokumentation.docx` (benötigt `python-docx`).

## Entwicklung

Statische Seite ohne Build-Schritt (`index.html`, `css/`, `js/`). Auswertungstests:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m test/analysis.test.js
```

Lokal starten mit `python3 -m http.server 8765`. Für die Kamera auf iPad oder iPhone ist HTTPS nötig, also über GitHub Pages testen.

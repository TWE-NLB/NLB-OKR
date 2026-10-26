# Fremde Dateien (lokal eingebunden)

Damit die App beim Start keine Verbindung zu Google Fonts, jsDelivr oder Google Storage aufbaut (Datenschutz, DSGVO), liegen alle fremden Dateien hier im Repo.

| Ordner | Inhalt | Version | Lizenz | Quelle |
|---|---|---|---|---|
| `fonts/` | IBM Plex Sans, Sans Hebrew, Mono (woff2) | Fontsource 5.0.8 | SIL Open Font License 1.1 (`fonts/OFL.txt`) | npm `@fontsource/ibm-plex-*` |
| `chartjs/` | Chart.js | 4.4.1 | MIT (`chartjs/LICENSE.md`) | npm `chart.js` |
| `mediapipe/` | MediaPipe Tasks Vision (Bundle + WebAssembly) | 0.10.14 | Apache 2.0 | npm `@mediapipe/tasks-vision` |
| `models/` | Face Landmarker Modell (float16) | 1 | Apache 2.0 | storage.googleapis.com/mediapipe-models |

Aktualisieren: Datei neu herunterladen, Versionsnummer hier und in `index.html` / `js/tracker.js` anpassen.

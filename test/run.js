// Alle Modultests ausführen: jsc -m test/run.js  (das Quality-Gate tools/quality_gate.py ruft das auf)
// Neue Testdatei: hier importieren.
import { run } from './engine.js';
import './stats.test.js';
import './analysis.test.js';
import './eyetrace.test.js';

await run();

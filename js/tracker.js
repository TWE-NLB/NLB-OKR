// Kamera, Gesichts-/Iris-Erkennung (MediaPipe Face Landmarker) und Bewegungssensor.
import { EYE_LANDMARKS, N_VALUES } from './eyetrace.js?v=2.4.1';

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Landmarken-Indizes des 478-Punkte-Modells
const R_OUT = 33, R_IN = 133, R_UP = 159, R_LO = 145;
const L_IN = 362, L_OUT = 263, L_UP = 386, L_LO = 374;
const IRIS_A = 468, IRIS_B = 473;

async function loadLandmarker() {
  const { FaceLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const common = { runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true };
  try {
    return await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' }, ...common });
  } catch (e) {
    console.warn('GPU nicht verfügbar, nutze CPU', e);
    return await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' }, ...common });
  }
}

const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

// Iris-Position relativ zur Linie zwischen den Augenwinkeln, normiert auf die Augenbreite.
// Dadurch weitgehend unabhängig von Kopf- und Geräteposition im Bild.
export function extractFeatures(lm, w, h) {
  const P = (i) => [lm[i].x * w, lm[i].y * h];
  const irisA = P(IRIS_A), irisB = P(IRIS_B);
  function eye(a, b, up, lo) {
    const A = P(a), B = P(b);
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    const n = [-u[1], u[0]];
    const I = d2(irisA, mid) < d2(irisB, mid) ? irisA : irisB;
    const d = [I[0] - mid[0], I[1] - mid[1]];
    const U = P(up), Lo = P(lo);
    return {
      fx: (d[0] * u[0] + d[1] * u[1]) / len,
      fy: (d[0] * n[0] + d[1] * n[1]) / len,
      open: Math.hypot(U[0] - Lo[0], U[1] - Lo[1]) / len,
      mid,
    };
  }
  const r = eye(R_OUT, R_IN, R_UP, R_LO);
  const l = eye(L_IN, L_OUT, L_UP, L_LO);
  return {
    fx: (r.fx + l.fx) / 2,
    fy: (r.fy + l.fy) / 2,
    open: Math.min(r.open, l.open),
    cx: (r.mid[0] + l.mid[0]) / 2,
    cy: (r.mid[1] + l.mid[1]) / 2,
    scale: Math.hypot(l.mid[0] - r.mid[0], l.mid[1] - r.mid[1]),
  };
}

export class Motion {
  constructor() { this.rate = 0; this.enabled = false; this.at = 0; }
  // Muss direkt im Klick-Handler aufgerufen werden (iOS-Erlaubnisdialog).
  request() {
    const DME = window.DeviceMotionEvent;
    if (!DME) return Promise.resolve(false);
    const p = typeof DME.requestPermission === 'function' ? DME.requestPermission() : Promise.resolve('granted');
    return p.then((state) => {
      if (state !== 'granted') return false;
      if (!this.enabled) {
        window.addEventListener('devicemotion', (e) => {
          const r = e.rotationRate;
          if (!r) return;
          this.rate = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
          this.at = performance.now();
        });
      }
      this.enabled = true;
      return true;
    }).catch(() => false);
  }
  current() { return this.enabled && performance.now() - this.at < 250 ? this.rate : null; }
}

export class Tracker {
  constructor(video, motion) {
    this.video = video;
    this.motion = motion;
    this.listeners = new Set();
    this.running = false;
    this.lastTs = 0;
    this.brightness = NaN;
    this.fps = 0;
    this._frames = [];
    this._canvas = document.createElement('canvas');
    this._canvas.width = 32; this._canvas.height = 18;
    this._lastBright = 0;
  }

  async start(onStatus = () => {}) {
    if (this.running) { onStatus(''); return; }
    onStatus('camera');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.setAttribute('playsinline', '');
    await this.video.play();
    if (!this.landmarker) {
      onStatus('model');
      this.landmarker = await loadLandmarker();
    }
    this.running = true;
    this._gen = (this._gen || 0) + 1;
    this._schedule(this._gen);
    onStatus('');
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // gen verhindert, dass nach Stopp/Neustart zwei Schleifen parallel laufen
  _schedule(gen) {
    if (!this.running || gen !== this._gen) return;
    if ('requestVideoFrameCallback' in this.video) this.video.requestVideoFrameCallback(() => this._tick(gen));
    else requestAnimationFrame(() => this._tick(gen));
  }

  _tick(gen) {
    if (gen !== this._gen) return;
    try { this._process(); } catch (e) { console.error(e); }
    this._schedule(gen);
  }

  _process() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    let now = performance.now();
    if (now <= this.lastTs) now = this.lastTs + 0.01;
    this.lastTs = now;

    this._frames.push(now);
    while (this._frames.length && now - this._frames[0] > 1000) this._frames.shift();
    this.fps = this._frames.length;

    if (now - this._lastBright > 500) {
      this._lastBright = now;
      const ctx = this._canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, 32, 18);
      const px = ctx.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      this.brightness = sum / (px.length / 4);
    }

    const res = this.landmarker.detectForVideo(v, now);
    const sample = { t: now / 1000, face: false, w: v.videoWidth, h: v.videoHeight, gyro: this.motion?.current() ?? null };
    const lm = res.faceLandmarks?.[0];
    if (lm && lm.length > IRIS_B) {
      Object.assign(sample, extractFeatures(lm, v.videoWidth, v.videoHeight), { face: true });
      // Gesichtspunkte der Augen für die Augenspur (normierte Koordinaten, keine Bilder)
      const eye = new Float32Array(N_VALUES);
      EYE_LANDMARKS.forEach((k, i) => { eye[2 * i] = lm[k].x; eye[2 * i + 1] = lm[k].y; });
      sample.eyeLm = eye;
      const m = res.facialTransformationMatrixes?.[0]?.data;
      sample.distCm = m ? Math.abs(m[14]) : NaN;
    }
    for (const fn of this.listeners) fn(sample);
  }
}

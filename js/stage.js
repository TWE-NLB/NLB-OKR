// Vollbild-Zeichenfläche: Kalibrierfigur, Pausenbild und bewegtes Muster (Streifen oder Figuren).
// Hintergrund immer weiß, Muster in Schwarz, Rot oder Blau.

export const COLORS = { black: '#000000', red: '#d0021b', blue: '#0047ab' };
export const PATTERNS = ['stripes', 'symbols'];
// Figuren für „Symbole“: zufällig gemischt, aber je Rasterplatz fest (kein Flackern)
export const SHAPES = ['star', 'moon', 'sun', 'fish', 'dog', 'rabbit', 'elephant'];

function shapeAt(col, row) {
  let h = (col * 73856093) ^ (row * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return SHAPES[Math.abs(h) % SHAPES.length];
}
const BG = '#ffffff';

// Figuren als Silhouetten im Einheitsquadrat [-0.5, 0.5], Blickrichtung nach rechts.
function ell(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
}
function circ(ctx, x, y, r) { ell(ctx, x, y, r, r); }
function rect(ctx, x, y, w, h) { ctx.fillRect(x, y, w, h); }

const DRAW = {
  star(ctx) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.2 : 0.5, a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
    ctx.closePath(); ctx.fill();
  },
  moon(ctx) {
    circ(ctx, 0, 0, 0.45);
    ctx.globalCompositeOperation = 'destination-out';
    circ(ctx, 0.2, -0.1, 0.38);
    ctx.globalCompositeOperation = 'source-over';
  },
  sun(ctx) {
    circ(ctx, 0, 0, 0.26);
    ctx.lineWidth = 0.07; ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      ctx.beginPath(); ctx.moveTo(0.33 * Math.cos(a), 0.33 * Math.sin(a)); ctx.lineTo(0.47 * Math.cos(a), 0.47 * Math.sin(a)); ctx.stroke();
    }
  },
  fish(ctx) {
    ell(ctx, 0.06, 0, 0.32, 0.2);
    ctx.beginPath(); ctx.moveTo(-0.22, 0); ctx.lineTo(-0.48, -0.2); ctx.lineTo(-0.48, 0.2); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    circ(ctx, 0.24, -0.05, 0.04);
    ctx.globalCompositeOperation = 'source-over';
  },
  dog(ctx) {
    ell(ctx, -0.02, 0.04, 0.28, 0.13);
    circ(ctx, 0.27, -0.13, 0.12);
    ell(ctx, 0.4, -0.09, 0.09, 0.055);
    ell(ctx, 0.22, -0.2, 0.045, 0.1, -0.4);
    for (const x of [-0.22, -0.1, 0.1, 0.2]) rect(ctx, x - 0.03, 0.08, 0.06, 0.24);
    ctx.lineWidth = 0.05; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.27, 0); ctx.lineTo(-0.42, -0.16); ctx.stroke();
  },
  rabbit(ctx) {
    // Sitzender Hase von der Seite: lange Ohren, runder Rücken, Puschelschwanz
    ell(ctx, -0.07, 0.14, 0.29, 0.2, -0.22);             // Körper, vorne höher
    circ(ctx, -0.15, 0.17, 0.19);                        // Hinterbein (Keule)
    ell(ctx, -0.06, 0.35, 0.21, 0.05);                   // Hinterpfote
    ell(ctx, 0.13, 0.05, 0.11, 0.17, 0.35);              // Hals/Brust
    ell(ctx, 0.17, 0.32, 0.075, 0.045);                  // Vorderpfote
    rect(ctx, 0.12, 0.12, 0.07, 0.2);                    // Vorderbein
    ell(ctx, 0.25, -0.07, 0.15, 0.12, 0.3);              // Kopf
    ell(ctx, 0.09, -0.3, 0.05, 0.18, -0.5);              // hinteres Ohr
    ell(ctx, 0.17, -0.31, 0.055, 0.19, -0.3);            // vorderes Ohr
    circ(ctx, -0.36, 0.05, 0.08);                        // Schwanz
    ctx.globalCompositeOperation = 'destination-out';
    circ(ctx, 0.29, -0.09, 0.025);                       // Auge
    ctx.globalCompositeOperation = 'source-over';
  },
  elephant(ctx) {
    ell(ctx, -0.04, 0.02, 0.32, 0.2);
    circ(ctx, 0.26, -0.08, 0.15);
    for (const x of [-0.26, -0.12, 0.06, 0.18]) rect(ctx, x - 0.045, 0.1, 0.09, 0.24);
    ctx.lineWidth = 0.08; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0.37, -0.04); ctx.quadraticCurveTo(0.48, 0.12, 0.42, 0.32); ctx.stroke();
    ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.moveTo(-0.35, 0); ctx.lineTo(-0.45, 0.12); ctx.stroke();
  },
};

export class Stage {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = new Map();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.c.getBoundingClientRect();
    this.w = r.width || window.innerWidth;
    this.h = r.height || window.innerHeight;
    this.dpr = dpr;
    this.c.width = Math.round(this.w * dpr);
    this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  fill(color = BG) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  // Figur einmal in eine eigene Zeichenfläche zeichnen und danach nur noch kopieren (schnell)
  sprite(kind, color, size, flip) {
    const px = Math.max(8, Math.round(size * this.dpr));
    const key = `${kind}|${color}|${px}|${flip}`;
    let s = this.sprites.get(key);
    if (!s) {
      s = document.createElement('canvas');
      s.width = s.height = px;
      const g = s.getContext('2d');
      g.translate(px / 2, px / 2); g.scale(flip ? -px : px, px);
      g.fillStyle = g.strokeStyle = COLORS[color] || COLORS.black;
      DRAW[kind](g);
      if (this.sprites.size > 60) this.sprites.clear();
      this.sprites.set(key, s);
    }
    return s;
  }

  drawShape(kind, color, x, y, size, flip = false) {
    this.ctx.drawImage(this.sprite(kind, color, size, flip), x - size / 2, y - size / 2, size, size);
  }

  // Bewegtes Muster. axis 'x': waagerechte Bewegung, 'y': senkrechte Bewegung.
  // Streifen: Paarbreite periodPx (halb farbig, halb weiß), über den ganzen Bildschirm.
  // Symbole: nur eine Reihe (waagerecht) bzw. eine Spalte (senkrecht) in der Bildschirmmitte,
  // Abstand periodPx, Größe ≈ Streifenbreite, Figur je Platz zufällig.
  pattern(kind, color, axis, offsetPx, periodPx, sign = 1) {
    const { ctx, w, h } = this;
    this.fill();
    const P = Math.max(8, periodPx);
    const start = (((offsetPx % P) + P) % P) - P;
    const along = axis === 'x' ? w : h;
    if (kind === 'stripes') {
      ctx.fillStyle = COLORS[color] || COLORS.black;
      for (let p = start; p < along; p += P) {
        if (axis === 'x') ctx.fillRect(p, 0, P / 2, h);
        else ctx.fillRect(0, p, w, P / 2);
      }
      return;
    }
    const size = P / 2;
    const flip = axis === 'x' && sign < 0; // Tiere schauen in Laufrichtung
    for (let a = start - P; a < along + P; a += P) {
      const n = Math.round((a - offsetPx) / P); // bleibt beim Wandern gleich
      const [x, y] = axis === 'x' ? [a, h / 2] : [w / 2, a];
      this.drawShape(kind === 'symbols' ? shapeAt(n, 0) : kind, color, x, y, size, flip);
    }
  }

  // Kalibrierziel: Figur (pulsierend kleiner werdend) mit Fixierpunkt in der Mitte
  target(x, y, progress, kind = 'rabbit', color = 'black') {
    const { ctx } = this;
    this.fill();
    const size = 70 - 30 * Math.min(1, progress);
    this.drawShape(kind === 'stripes' ? 'rabbit' : kind, color, x, y, size);
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#000000'; ctx.stroke();
  }

  // Pause vor jedem Block: Fixierkreuz, Richtungspfeil, Text und Fortschritt (Punkte)
  fixation(arrow, caption, countdown, progress) {
    const { ctx, w, h } = this;
    this.fill();
    const m = Math.min(w, h);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 12, h / 2); ctx.lineTo(w / 2 + 12, h / 2);
    ctx.moveTo(w / 2, h / 2 - 12); ctx.lineTo(w / 2, h / 2 + 12);
    ctx.stroke();
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (arrow) { ctx.font = `600 ${Math.round(m * 0.12)}px system-ui, sans-serif`; ctx.fillText(arrow, w / 2, h / 2 - m * 0.22); }
    if (caption) { ctx.font = `500 ${Math.round(m * 0.045)}px system-ui, sans-serif`; ctx.fillText(caption, w / 2, h / 2 + m * 0.16); }
    if (countdown) { ctx.font = `500 ${Math.round(m * 0.035)}px system-ui, sans-serif`; ctx.fillText(countdown, w / 2, h / 2 + m * 0.24); }
    if (progress && progress.total) {
      const r = Math.max(4, m * 0.012), gap = r * 3.2;
      const x0 = w / 2 - ((progress.total - 1) * gap) / 2, y = h / 2 + m * 0.32;
      for (let i = 0; i < progress.total; i++) {
        ctx.beginPath(); ctx.arc(x0 + i * gap, y, r, 0, Math.PI * 2);
        if (i < progress.done) { ctx.fillStyle = '#1e5a7a'; ctx.fill(); }
        else { ctx.strokeStyle = '#9aa6ae'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
    }
  }
}

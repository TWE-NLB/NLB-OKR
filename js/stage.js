// Vollbild-Zeichenfläche für Kalibrierpunkte, Fixierkreuz und Streifenband.
// Der Reiz ist immer schwarz/weiß, unabhängig vom hellen/dunklen Design der App.

export class Stage {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.c.getBoundingClientRect();
    this.w = r.width || window.innerWidth;
    this.h = r.height || window.innerHeight;
    this.c.width = Math.round(this.w * dpr);
    this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  fill(color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  // axis 'x': senkrechte Streifen, die sich waagerecht bewegen; 'y': waagerechte Streifen
  stripes(axis, offsetPx, periodPx) {
    const { ctx, w, h } = this;
    this.fill('#fff');
    ctx.fillStyle = '#000';
    const P = Math.max(4, periodPx);
    const start = (((offsetPx % P) + P) % P) - P;
    const len = axis === 'x' ? w : h;
    for (let p = start; p < len; p += P) {
      if (axis === 'x') ctx.fillRect(p, 0, P / 2, h);
      else ctx.fillRect(0, p, w, P / 2);
    }
  }

  // Kalibrierpunkt: schrumpfender Ring für Aufmerksamkeit, fester Kern
  target(x, y, progress) {
    const { ctx } = this;
    this.fill('#7f7f7f');
    const ring = 26 - 16 * Math.min(1, progress);
    ctx.beginPath(); ctx.arc(x, y, ring, 0, Math.PI * 2);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
  }

  fixation(arrow, caption, countdown) {
    const { ctx, w, h } = this;
    this.fill('#7f7f7f');
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 12, h / 2); ctx.lineTo(w / 2 + 12, h / 2);
    ctx.moveTo(w / 2, h / 2 - 12); ctx.lineTo(w / 2, h / 2 + 12);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (arrow) {
      ctx.font = `600 ${Math.round(Math.min(w, h) * 0.12)}px system-ui, sans-serif`;
      ctx.fillText(arrow, w / 2, h / 2 - Math.min(w, h) * 0.22);
    }
    if (caption) {
      ctx.font = `500 ${Math.round(Math.min(w, h) * 0.045)}px system-ui, sans-serif`;
      ctx.fillText(caption, w / 2, h / 2 + Math.min(w, h) * 0.16);
    }
    if (countdown != null) {
      ctx.font = `500 ${Math.round(Math.min(w, h) * 0.035)}px system-ui, sans-serif`;
      ctx.fillText(countdown, w / 2, h / 2 + Math.min(w, h) * 0.24);
    }
  }
}

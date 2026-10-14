// Diagramme mit Chart.js (globales `Chart` aus index.html). Farben kommen aus den CSS-Tokens.

const charts = new Map();

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function seriesColor(i) {
  return css(`--s${(i % 8) + 1}`);
}

function base() {
  const ink2 = css('--ink-2');
  const grid = css('--grid');
  Chart.defaults.font.family = css('--font-body');
  Chart.defaults.color = ink2;
  return {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { labels: { boxWidth: 12, boxHeight: 2, color: css('--ink') } },
      tooltip: {
        backgroundColor: css('--surface'),
        titleColor: css('--ink'),
        bodyColor: css('--ink'),
        borderColor: css('--line'),
        borderWidth: 1,
      },
    },
    scales: {
      x: { grid: { color: grid }, border: { color: css('--line') }, ticks: { color: ink2 } },
      y: { grid: { color: grid }, border: { color: css('--line') }, ticks: { color: ink2 } },
    },
  };
}

function make(canvas, config) {
  charts.get(canvas)?.destroy();
  const c = new Chart(canvas, config);
  charts.set(canvas, c);
  return c;
}

export function destroyAll() {
  for (const c of charts.values()) c.destroy();
  charts.clear();
}

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');

// Augenposition über die Zeit für einen Block (Sägezahn)
export function traceChart(canvas, points, axisLabel) {
  const o = base();
  o.plugins.legend.display = false;
  o.plugins.tooltip.callbacks = {
    title: (items) => `${fmt(items[0].parsed.x, 2)} s`,
    label: (item) => `Auge: ${fmt(item.parsed.y, 1)}°`,
  };
  o.scales.x.type = 'linear';
  o.scales.x.title = { display: true, text: 'Zeit im Block (s)' };
  o.scales.y.title = { display: true, text: axisLabel };
  return make(canvas, {
    type: 'line',
    data: {
      datasets: [{
        data: points,
        borderColor: seriesColor(0),
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 6,
        spanGaps: false,
      }],
    },
    options: o,
  });
}

// Gain über Geschwindigkeit, eine Linie pro Messung
export function gainChart(canvas, series, title) {
  const o = base();
  o.plugins.legend.display = false; // Legende steht einmal über allen vier Diagrammen
  o.plugins.title = { display: true, text: title, color: css('--ink'), align: 'start', font: { weight: '600' } };
  o.plugins.tooltip.callbacks = {
    title: (items) => `${items[0].parsed.x} °/s`,
    label: (item) => `${item.dataset.label}: Gain ${fmt(item.parsed.y)}`,
  };
  o.scales.x.type = 'linear';
  o.scales.x.title = { display: true, text: 'Streifen (°/s)' };
  const speeds = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  o.scales.x.afterBuildTicks = (axis) => { axis.ticks = speeds.map((value) => ({ value })); };
  if (speeds.length) { o.scales.x.min = speeds[0] - 2; o.scales.x.max = speeds[speeds.length - 1] + 2; }
  o.scales.y.title = { display: true, text: 'Gain' };
  o.scales.y.suggestedMin = 0;
  o.scales.y.suggestedMax = 1.1;
  return make(canvas, {
    type: 'line',
    data: {
      datasets: series.map((s) => ({
        label: s.label,
        data: s.points,
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBorderColor: css('--surface'),
        pointBorderWidth: 2,
      })),
    },
    options: o,
  });
}

// Asymmetrie horizontal/vertikal je Messung
export function asymChart(canvas, series) {
  const o = base();
  o.plugins.legend.display = false;
  o.plugins.tooltip.callbacks = {
    label: (item) => `${item.dataset.label}: ${fmt(item.parsed.y, 0)} %`,
  };
  o.scales.x.grid = { display: false };
  o.scales.y.title = { display: true, text: 'Asymmetrie (%)' };
  return make(canvas, {
    type: 'bar',
    data: {
      labels: ['Horizontal (rechts vs. links)', 'Vertikal (oben vs. unten)'],
      datasets: series.map((s) => ({
        label: s.label,
        data: [s.asymH, s.asymV].map((v) => (Number.isFinite(v) ? v : null)),
        backgroundColor: s.color,
        borderRadius: 4,
        borderSkipped: 'start',
        borderColor: css('--surface'),
        borderWidth: { left: 1, right: 1 },
        maxBarThickness: 36,
      })),
    },
    options: o,
  });
}

// Diagramme mit Chart.js (globales `Chart` aus index.html). Farben kommen aus den CSS-Tokens.
// Achsen laufen auch bei Schrift von rechts nach links von links nach rechts (Zeit, + = rechts).
import { t, LOCALE, RTL } from './i18n.js?v=2.1.1';

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
  Chart.defaults.locale = LOCALE;
  Chart.defaults.color = ink2;
  return {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { labels: { boxWidth: 12, boxHeight: 2, color: css('--ink') } },
      tooltip: {
        rtl: RTL,
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

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');

// Augenposition über die Zeit für einen Block (Sägezahn)
export function traceChart(canvas, points, axisLabel) {
  const o = base();
  o.plugins.legend.display = false;
  o.plugins.tooltip.callbacks = {
    title: (items) => `${fmt(items[0].parsed.x, 2)} s`,
    label: (item) => `${t('eye')}: ${fmt(item.parsed.y, 1)}°`,
  };
  o.scales.x.type = 'linear';
  o.scales.x.title = { display: true, text: t('time_in_block_s') };
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
  o.plugins.title = { display: true, text: title, color: css('--ink'), align: RTL ? 'end' : 'start', font: { weight: '600' } };
  o.plugins.tooltip.callbacks = {
    title: (items) => `${items[0].parsed.x} °/s`,
    label: (item) => `${item.dataset.label}: ${t('gain')} ${fmt(item.parsed.y)}`,
  };
  o.scales.x.type = 'linear';
  o.scales.x.title = { display: true, text: t('stripes_s') };
  const speeds = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  o.scales.x.afterBuildTicks = (axis) => { axis.ticks = speeds.map((value) => ({ value })); };
  if (speeds.length) { o.scales.x.min = speeds[0] - 2; o.scales.x.max = speeds[speeds.length - 1] + 2; }
  o.scales.y.title = { display: true, text: t('gain') };
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
  o.scales.y.title = { display: true, text: t('chart_asym') };
  return make(canvas, {
    type: 'bar',
    data: {
      labels: [t('horizontal_right_vs_left'), t('vertical_up_vs_down')],
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

// Verlauf einer Person: ein Wert je Messung (z. B. Asymmetrie oder Gain), optional mit Schwankung (±)
export function timelineChart(canvas, labels, values, opts = {}) {
  const o = base();
  o.plugins.legend.display = false;
  o.plugins.title = { display: !!opts.title, text: opts.title, color: css('--ink'), align: RTL ? 'end' : 'start', font: { weight: '600' } };
  o.plugins.tooltip.callbacks = {
    label: (item) => {
      const ci = opts.ci?.[item.dataIndex];
      return `${fmt(item.parsed.y, opts.digits ?? 0)}${opts.unit ?? ''}${Number.isFinite(ci) ? ` (± ${fmt(ci, opts.digits ?? 0)}${opts.unit ?? ''})` : ''}`;
    },
  };
  o.plugins.tooltip.filter = (item) => item.datasetIndex === 0;
  o.scales.x.grid = { display: false };
  if (opts.title2) o.scales.y.title = { display: true, text: opts.title2 };
  const ds = [{
    data: values.map((v) => (Number.isFinite(v) ? v : null)),
    borderColor: seriesColor(0), backgroundColor: seriesColor(0),
    borderWidth: 2, pointRadius: 5, pointHoverRadius: 7,
    pointBorderColor: css('--surface'), pointBorderWidth: 2, spanGaps: true,
  }];
  if (opts.zero) {
    ds.push({ data: labels.map(() => 0), borderColor: css('--line'), borderWidth: 1, borderDash: [4, 4], pointRadius: 0, pointHitRadius: 0 });
  }
  return make(canvas, { type: 'line', data: { labels, datasets: ds }, options: o });
}

// Agregação de tendências (Fase 4) — puro, sem DOM/fetch/Date.now() implícito, para poder
// ser testado com node:test. O desenho dos gráficos (SVG) fica em app.js, que só consome
// os números daqui.
import { DAY, HOUR, MIN, dayKey, midnight, overlap, fmtDur } from "./time.js";
import { classifySleep, isPauseAtNight } from "./sleep.js";

/* ---------- baldes de dia ---------- */
export function dayBuckets(now, days) {
  const t0 = midnight(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = t0 - i * DAY;
    out.push({ key: dayKey(start), start, end: start + DAY });
  }
  return out;
}

function emptyDay(bucket) {
  return {
    key: bucket.key, start: bucket.start,
    sleepDayMin: 0, sleepNightMin: 0, napCount: 0, longestNightMin: 0, wakenings: 0,
    bedtime: null, wake: null,
    feedCount: 0, feedMin: 0, feedMl: 0, feedBySide: { "peito-e": 0, "peito-d": 0 }, feedByMilk: {},
    diaper: { xixi: 0, coco: 0, ambos: 0 },
    hours: new Array(24).fill(0),
  };
}

function heatmapForDay(dayStart, sleepEvents) {
  const hours = new Array(24).fill(0);
  for (const e of sleepEvents || []) {
    if (e.end == null) continue;
    for (let h = 0; h < 24; h++) {
      const hs = dayStart + h * HOUR, he = hs + HOUR;
      const ov = overlap(e.start, e.end, hs, he);
      if (ov > 0) hours[h] = Math.min(1, hours[h] + ov / HOUR);
    }
  }
  return hours;
}

// Agrega sono/mamadas/fraldas em `days` baldes diários (calendário local, mais antigo primeiro).
// Sono é agrupado pelo dia em que COMEÇA (mesma convenção usada no resto do app — Registros,
// motor de previsão), não pelo relógio: um sono noturno que cruza a meia-noite pertence à noite
// que começou, não se divide entre dois dias (só o mapa de calor por hora faz esse split).
export function buildTrend({ sleepEvents, feedEvents, diaperEvents, now, days, nightWindow }) {
  const buckets = dayBuckets(now, days);
  const byKey = {};
  for (const b of buckets) byKey[b.key] = emptyDay(b);
  const [nightStart, nightEnd] = nightWindow;

  for (const e of sleepEvents || []) {
    if (e.end == null) continue;
    const k = dayKey(e.start);
    const row = byKey[k];
    const isNight = classifySleep(e.start, e.end, e.isNight, nightStart, nightEnd) === "night";
    const durMin = (e.end - e.start) / MIN;
    if (row) {
      if (isNight) {
        row.sleepNightMin += durMin;
        row.longestNightMin = Math.max(row.longestNightMin, durMin);
        row.wakenings += (e.data && Array.isArray(e.data.pauses) ? e.data.pauses : [])
          .filter(p => isPauseAtNight(p.start, nightStart, nightEnd)).length;
        row.bedtime = e.start;
      } else {
        row.sleepDayMin += durMin;
        row.napCount += 1;
      }
    }
    if (isNight) { const wk = dayKey(e.end); if (byKey[wk]) byKey[wk].wake = e.end; }
  }

  for (const f of feedEvents || []) {
    const row = byKey[dayKey(f.start)]; if (!row) continue;
    row.feedCount += 1;
    if (f.end != null) row.feedMin += (f.end - f.start) / MIN;
    if (f.ml != null) row.feedMl += f.ml;
    if (f.kind === "peito-e" || f.kind === "peito-d") row.feedBySide[f.kind] = (row.feedBySide[f.kind] || 0) + 1;
    const milk = f.data && f.data.milkType;
    if (milk) row.feedByMilk[milk] = (row.feedByMilk[milk] || 0) + 1;
  }

  for (const d of diaperEvents || []) {
    const row = byKey[dayKey(d.start)]; if (!row) continue;
    const kind = d.kind === "coco" ? "coco" : d.kind === "ambos" ? "ambos" : "xixi";
    row.diaper[kind] += 1;
  }

  for (const b of buckets) byKey[b.key].hours = heatmapForDay(b.start, sleepEvents);

  return buckets.map(b => byKey[b.key]);
}

/* ---------- insights em linguagem simples ---------- */
export function computeInsights(trendDays) {
  const valid = trendDays.filter(d => d.sleepDayMin + d.sleepNightMin > 0);
  if (valid.length < 3) return ["Ainda faltam dias completos de registro para mostrar tendências confiáveis."];
  const insights = [];
  const half = Math.floor(valid.length / 2);
  const firstHalf = valid.slice(0, half), secondHalf = valid.slice(half);
  const avgTotal = arr => arr.reduce((s, d) => s + d.sleepDayMin + d.sleepNightMin, 0) / arr.length;
  if (firstHalf.length && secondHalf.length) {
    const a = avgTotal(firstHalf), b = avgTotal(secondHalf);
    if (Math.abs(b - a) >= 30) insights.push(`O sono total por dia está ${b > a ? "maior" : "menor"} na segunda metade do período (${fmtDur(b)} vs ${fmtDur(a)}).`);
    else insights.push("O total de sono por dia está estável no período.");
  }
  const avgLongest = valid.reduce((s, d) => s + d.longestNightMin, 0) / valid.length;
  if (avgLongest) insights.push(`O maior trecho contínuo de sono à noite tem ficado em torno de ${fmtDur(avgLongest)}, em média.`);
  const avgWakenings = valid.reduce((s, d) => s + d.wakenings, 0) / valid.length;
  insights.push(`Média de ${avgWakenings.toFixed(1)} despertar(es) noturno(s) por noite.`);
  const avgNaps = valid.reduce((s, d) => s + d.napCount, 0) / valid.length;
  insights.push(`Média de ${avgNaps.toFixed(1)} soneca(s) por dia.`);
  const avgFeeds = valid.reduce((s, d) => s + d.feedCount, 0) / valid.length;
  if (avgFeeds) insights.push(`Média de ${avgFeeds.toFixed(1)} mamada(s)/refeição(ões) registradas por dia.`);
  return insights;
}

/* ---------- curva de crescimento OMS (método LMS) ----------
   Fonte dos parâmetros L/M/S: WHO Child Growth Standards (0–24 meses), republicados pelo
   CDC/NCHS em formato tabular — https://www.cdc.gov/growthcharts/who-data-files.htm
   z = ((valor/M)^L - 1) / (L·S), ou ln(valor/M)/S quando L≈0 (método padrão OMS/CDC). */
const AVG_DAYS_PER_MONTH = 30.4375;

export function ageMonthsExact(birthMs, atMs) {
  return Math.max(0, (atMs - birthMs) / DAY / AVG_DAYS_PER_MONTH);
}

// `table` é um array de linhas [month, L, M, S] ordenado por mês (0..24), como em who-growth-lms.json.
export function lmsAt(table, ageMonths) {
  const clamped = Math.min(24, Math.max(0, ageMonths));
  const idx = Math.min(Math.floor(clamped), table.length - 2 < 0 ? 0 : table.length - 2);
  const lo = table[idx], hi = table[Math.min(idx + 1, table.length - 1)];
  const span = hi[0] - lo[0];
  const frac = span > 0 ? (clamped - lo[0]) / span : 0;
  const lerp = (a, b) => a + (b - a) * frac;
  return { L: lerp(lo[1], hi[1]), M: lerp(lo[2], hi[2]), S: lerp(lo[3], hi[3]) };
}

export function zScoreForValue(value, lms) {
  const { L, M, S } = lms;
  return Math.abs(L) < 1e-9 ? Math.log(value / M) / S : (Math.pow(value / M, L) - 1) / (L * S);
}
export function valueForZ(lms, z) {
  const { L, M, S } = lms;
  return Math.abs(L) < 1e-9 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
}
function erf(x) {
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}
export function percentileFromZ(z) {
  return 100 * 0.5 * (1 + erf(z / Math.SQRT2));
}
export function growthPoint(table, ageMonths, value) {
  const lms = lmsAt(table, ageMonths);
  const z = zScoreForValue(value, lms);
  return { ageMonths, z, percentile: percentileFromZ(z) };
}
// Linhas de referência clássicas do gráfico da OMS (P3/P15/P50/P85/P97).
export const WHO_PERCENTILE_LINES = [
  { p: 3, z: -1.8808 }, { p: 15, z: -1.0364 }, { p: 50, z: 0 }, { p: 85, z: 1.0364 }, { p: 97, z: 1.8808 },
];
export function percentileCurve(table, zTarget, stepMonths = 1) {
  const pts = [];
  for (let m = 0; m <= 24; m += stepMonths) pts.push({ ageMonths: m, value: valueForZ(lmsAt(table, m), zTarget) });
  return pts;
}

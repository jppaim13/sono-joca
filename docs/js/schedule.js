// Motor de previsão de sono — puro, sem DOM/localStorage/Date.now() implícito, para poder
// ser reaproveitado tanto pelo app (docs/js/app.js) quanto pela Edge Function da Fase 3 (Deno).
// Tudo recebe `now` explícito, nada de estado escondido.
import { midnight, dayKey, HOUR, MIN } from "./time.js";
import { classifySleep } from "./sleep.js";

// Janela de vigília típica por idade — referência clínica (não evidência forte por RCT),
// tratada como ponto de partida ajustável (ver Guia no app).
export const AGE_WINDOW_TABLE = [
  { maxWeeks: 4, range: [35, 60] },
  { maxWeeks: 12, range: [60, 90] },
  { maxWeeks: 17, range: [75, 120] },
  { maxWeeks: 30, range: [120, 180] },
  { maxWeeks: 43, range: [150, 210] },
  { maxWeeks: 60, range: [180, 240] },
  { maxWeeks: 104, range: [240, 360] },
];
export function ageWakeWindowRef(ageWeeks) {
  if (ageWeeks == null) return AGE_WINDOW_TABLE[0].range;
  for (const row of AGE_WINDOW_TABLE) if (ageWeeks < row.maxWeeks) return row.range;
  return AGE_WINDOW_TABLE[AGE_WINDOW_TABLE.length - 1].range;
}
// Sono total em 24h (NSF/AASM/AAP) — mesma referência usada no resumo da tela Hoje.
export function dailySleepRefHours(ageWeeks) {
  if (ageWeeks == null || ageWeeks < 17) return { min: 14, max: 17, src: "National Sleep Foundation, 0–3 meses" };
  if (ageWeeks < 52) return { min: 12, max: 16, src: "AASM/AAP, 4–12 meses (inclui sonecas)" };
  if (ageWeeks < 104) return { min: 11, max: 14, src: "AASM/AAP, 1–2 anos (inclui sonecas)" };
  return { min: 10, max: 13, src: "AASM/AAP, 3–5 anos" };
}

/* ---------- estatística leve ---------- */
export function recencyWeight(daysAgo, halfLifeDays = 5) {
  return Math.pow(0.5, Math.max(0, daysAgo) / halfLifeDays);
}
export function trimOutliers(values) {
  if (values.length < 5) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)], q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1, lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  return values.filter(v => v >= lo && v <= hi);
}
export function weightedMedian(items) {
  const filtered = items.filter(it => it.weight > 0);
  if (!filtered.length) return null;
  const sorted = [...filtered].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, it) => s + it.weight, 0);
  let acc = 0;
  for (const it of sorted) { acc += it.weight; if (acc >= total / 2) return it.value; }
  return sorted[sorted.length - 1].value;
}

/* ---------- posição da soneca no dia ---------- */
export function napPosition(index, total) {
  if (total <= 1) return "first";
  if (index === 0) return "first";
  if (index === total - 1) return "last";
  return "middle";
}
function attemptWeight(sleepEvent) {
  const attempt = sleepEvent.data && sleepEvent.data.attempt;
  if (attempt === "failed") return 0.3;
  if (attempt === "moving") return 0.5;
  return 1;
}

/* ---------- histórico: janelas de vigília antes de cada soneca, por posição ---------- */
export function collectWakeGapsByPosition(sleepEvents, nightWindow, sinceMs, now, excludeDayKeys = []) {
  const sorted = [...sleepEvents].filter(e => e.end != null && e.start <= now).sort((a, b) => a.start - b.start);
  const buckets = { first: [], middle: [], last: [] };
  let dayNaps = [];
  const flushDay = () => {
    dayNaps.forEach((n, i) => { const pos = napPosition(i, dayNaps.length); buckets[pos].push(n); });
    dayNaps = [];
  };
  let lastWakeEnd = null;
  for (const e of sorted) {
    const isNight = classifySleep(e.start, e.end, e.isNight, nightWindow[0], nightWindow[1]) === "night";
    if (isNight) { flushDay(); lastWakeEnd = e.end; continue; }
    if (e.start >= sinceMs && lastWakeEnd != null && !excludeDayKeys.includes(dayKey(e.start))) {
      const gapMin = (e.start - lastWakeEnd) / MIN;
      const weight = attemptWeight(e);
      if (gapMin >= 5 && gapMin <= 8 * 60 && weight > 0) {
        const daysAgo = (now - e.start) / (24 * HOUR);
        dayNaps.push({ value: gapMin, weight: weight * recencyWeight(daysAgo) });
      }
    }
    lastWakeEnd = e.end;
  }
  flushDay();
  return buckets;
}
export function personalWindowForPosition(bucketItems, ageRange) {
  if (!bucketItems.length) return { source: "reference", value: (ageRange[0] + ageRange[1]) / 2, sampleCount: 0 };
  const trimmedValues = trimOutliers(bucketItems.map(it => it.value));
  const kept = bucketItems.filter(it => trimmedValues.includes(it.value));
  if (kept.length < 3) return { source: "reference", value: (ageRange[0] + ageRange[1]) / 2, sampleCount: kept.length };
  const med = weightedMedian(kept);
  const clamped = Math.min(Math.max(med, ageRange[0]), ageRange[1]);
  return { source: "personal", value: clamped, sampleCount: kept.length };
}

/* ---------- calibração ---------- */
export function calibration(completeDayCount) {
  const needed = 3;
  if (completeDayCount >= needed) {
    const confidence = completeDayCount >= 7 ? "high" : completeDayCount >= 5 ? "medium" : "low";
    return { ready: true, daysNeeded: 0, confidence };
  }
  return { ready: false, daysNeeded: needed - completeDayCount, confidence: "low" };
}
export function countCompleteDays(sleepEvents, sinceMs, now, nightWindow, excludeDayKeys = []) {
  const sorted = [...sleepEvents].filter(e => e.end != null && e.start >= sinceMs && e.start <= now).sort((a, b) => a.start - b.start);
  let count = 0, sawNightBefore = false, napsSince = 0;
  for (const e of sorted) {
    const isNight = classifySleep(e.start, e.end, e.isNight, nightWindow[0], nightWindow[1]) === "night";
    if (isNight) {
      if (sawNightBefore && napsSince > 0 && !excludeDayKeys.includes(dayKey(e.start))) count++;
      sawNightBefore = true; napsSince = 0;
    } else napsSince++;
  }
  return count;
}
export function isNewbornMode(ageWeeks, calib) {
  return ageWeeks == null || ageWeeks < 8 || !calib.ready;
}

/* ---------- hoje: quantas sonecas já rolaram, e qual a próxima posição ---------- */
export function countTodayNaps(sleepEvents, now, nightWindow) {
  const sorted = [...sleepEvents].filter(e => e.end != null && e.start <= now).sort((a, b) => a.start - b.start);
  let dayStart = null;
  for (const e of sorted) {
    if (classifySleep(e.start, e.end, e.isNight, nightWindow[0], nightWindow[1]) === "night") dayStart = e.end;
  }
  if (dayStart == null) dayStart = midnight(now);
  return sorted.filter(e => e.start >= dayStart && e.start < now &&
    classifySleep(e.start, e.end, e.isNight, nightWindow[0], nightWindow[1]) !== "night").length;
}
function napPositionForNext(todayNaps, fixedNaps) {
  if (fixedNaps && todayNaps >= fixedNaps - 1) return "last";
  if (todayNaps === 0) return "first";
  return "middle";
}
function shortenForLastNap(lastSleep) {
  let shorten = 0;
  if (lastSleep.end) {
    const durMin = (lastSleep.end - lastSleep.start) / MIN;
    if (durMin < 45) shorten += 15;
  }
  const attempt = lastSleep.data && lastSleep.data.attempt;
  if (attempt === "moving" || attempt === "failed") shorten += 10;
  return shorten;
}
function isIncompleteNight(lastSleep, settings, nightWindow) {
  const wasNight = classifySleep(lastSleep.start, lastSleep.end, lastSleep.isNight, nightWindow[0], nightWindow[1]) === "night";
  if (!wasNight || settings.minWakeHour == null) return false;
  const d = new Date(lastSleep.end);
  const wokeHour = d.getHours() + d.getMinutes() / 60;
  return wokeHour < settings.minWakeHour;
}

/* ---------- sugestão de transição de número de sonecas (nunca aplicada sozinha) ---------- */
export function suggestNapTransition(sleepEvents, now, nightWindow) {
  const days = 5;
  let flagged = 0;
  for (let i = 0; i < days; i++) {
    const dayStart = midnight(now) - i * 24 * HOUR, dayEnd = dayStart + 24 * HOUR;
    const dayNaps = sleepEvents.filter(e => e.end != null && e.start >= dayStart && e.start < dayEnd &&
      classifySleep(e.start, e.end, e.isNight, nightWindow[0], nightWindow[1]) !== "night");
    if (!dayNaps.length) continue;
    const lastNap = [...dayNaps].sort((a, b) => a.start - b.start).slice(-1)[0];
    const attempt = lastNap.data && lastNap.data.attempt;
    const lateHour = new Date(lastNap.start).getHours();
    if (attempt === "failed" || lateHour >= 18) flagged++;
  }
  return flagged >= 3
    ? { type: "reduce_naps", detail: `Nos últimos 5 dias, ${flagged} tiveram sinais de que a última soneca não está encaixando bem — pode ser hora de reduzir o número de sonecas. É só uma sugestão, não é aplicada sozinha.` }
    : null;
}

function buildExplain(position, windowInfo, shorten) {
  const posLabel = position === "first" ? "1ª janela do dia" : position === "last" ? "última janela antes da noite" : "janela do meio do dia";
  let text = windowInfo.source === "personal"
    ? `${posLabel}: mediana dos últimos dias (${Math.round(windowInfo.value)} min, ${windowInfo.sampleCount} registros).`
    : `${posLabel}: ainda sem dados suficientes — usando a faixa típica da idade.`;
  if (shorten > 0) text += ` Encurtada em ${shorten} min porque a soneca anterior foi curta ou atípica.`;
  return text;
}

/* ---------- orquestrador ---------- */
export function computeSchedule({ sleepEvents, ageWeeks, settings, now, atypicalDayKeys }) {
  settings = settings || {};
  atypicalDayKeys = atypicalDayKeys || [];
  const nightWindow = [Number.isFinite(settings.nightStart) ? settings.nightStart : 19, Number.isFinite(settings.nightEnd) ? settings.nightEnd : 7];
  const ageRange = ageWakeWindowRef(ageWeeks);
  const sinceMs = now - 14 * 24 * HOUR;

  const buckets = collectWakeGapsByPosition(sleepEvents, nightWindow, sinceMs, now, atypicalDayKeys);
  const windows = {
    first: personalWindowForPosition(buckets.first, ageRange),
    middle: personalWindowForPosition(buckets.middle, ageRange),
    last: personalWindowForPosition(buckets.last, ageRange),
  };
  const completeDays = countCompleteDays(sleepEvents, sinceMs, now, nightWindow, atypicalDayKeys);
  const calib = calibration(completeDays);
  const newborn = isNewbornMode(ageWeeks, calib);
  const todayNaps = countTodayNaps(sleepEvents, now, nightWindow);
  const suggestion = suggestNapTransition(sleepEvents, now, nightWindow);
  const base = { mode: newborn ? "newborn" : "windows", calibration: calib, wakeWindowRef: ageRange, windows, todayNaps, suggestion };

  const lastSleep = [...sleepEvents].filter(e => e.end != null && e.end <= now).sort((a, b) => b.end - a.end)[0];
  if (!lastSleep) return { ...base, nextNap: null, explain: "Registre alguns sonos para as previsões aparecerem." };

  const position = napPositionForNext(todayNaps, settings.fixedNaps);
  const fixedForPos = settings.fixedWindows && settings.fixedWindows[position];
  let windowMin = fixedForPos != null ? fixedForPos : windows[position].value;
  const shorten = shortenForLastNap(lastSleep);
  if (fixedForPos == null) windowMin = Math.max(ageRange[0] * 0.6, windowMin - shorten);
  if (fixedForPos == null && isIncompleteNight(lastSleep, settings, nightWindow)) windowMin = Math.max(ageRange[0] * 0.6, windowMin - 15);
  // última janela do dia nunca passa do máximo da faixa etária, mesmo com dado pessoal maior
  if (position === "last") windowMin = Math.min(windowMin, ageRange[1]);

  const awakeMin = (now - lastSleep.end) / MIN;
  const from = lastSleep.end + (windowMin - 10) * MIN, to = lastSleep.end + (windowMin + 10) * MIN;
  const status = awakeMin < windowMin - 10 ? "early" : awakeMin <= windowMin + 15 ? "good" : "late";
  const explain = fixedForPos != null ? `Janela fixa definida em Configurações (${Math.round(fixedForPos)} min).` : buildExplain(position, windows[position], shorten);

  return { ...base, nextNap: { from, to, awakeMin, targetMin: windowMin, position, status, confidence: calib.confidence }, explain };
}

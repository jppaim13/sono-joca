import test from "node:test";
import assert from "node:assert/strict";
import { DAY, HOUR, MIN, midnight } from "../docs/js/time.js";
import {
  dayBuckets, buildTrend, computeInsights,
  ageMonthsExact, lmsAt, zScoreForValue, valueForZ, percentileFromZ, growthPoint, percentileCurve,
  nightShiftCounts,
} from "../docs/js/trends.js";
import whoData from "../docs/data/who-growth-lms.json" with { type: "json" };

const NIGHT = [19, 7];

test("dayBuckets gera N dias em ordem crescente terminando hoje", () => {
  const now = Date.parse("2026-03-10T15:00:00");
  const buckets = dayBuckets(now, 3);
  assert.equal(buckets.length, 3);
  assert.equal(buckets[2].key, "2026-03-10");
  assert.equal(buckets[0].key, "2026-03-08");
  assert.equal(buckets[1].start, midnight(now) - DAY);
});

test("buildTrend soma sono noturno e soneca em dias separados, e calcula bedtime/wake cruzando a meia-noite", () => {
  const now = Date.parse("2026-03-10T12:00:00");
  const t0 = midnight(now); // início de 10/03 (dia mais recente do balde de 2 dias)
  const prevNightStart = t0 - DAY + 20 * HOUR; // 20h de 09/03
  const prevNightEnd = t0 + 6 * HOUR; // 06h de 10/03
  const nap = { start: t0 + 9 * HOUR, end: t0 + 10 * HOUR, data: {} }; // soneca das 9h-10h de 10/03
  const sleepEvents = [
    { start: prevNightStart, end: prevNightEnd, data: {} },
    nap,
  ];
  const trend = buildTrend({ sleepEvents, feedEvents: [], diaperEvents: [], now, days: 2, nightWindow: NIGHT });
  const [day1, day2] = trend; // day1 = 09/03, day2 = 10/03
  assert.equal(day1.sleepNightMin, 10 * 60); // 20h-06h = 10h, contado no dia em que começou (09/03)
  assert.equal(day1.bedtime, prevNightStart);
  assert.equal(day2.wake, prevNightEnd); // o despertar aparece no dia em que o sono TERMINOU
  assert.equal(day2.sleepDayMin, 60);
  assert.equal(day2.napCount, 1);
});

test("buildTrend conta despertares noturnos a partir das pausas dentro da janela noturna", () => {
  const now = Date.parse("2026-03-10T12:00:00");
  const t0 = midnight(now);
  const start = t0 + 20 * HOUR, end = t0 + DAY + 6 * HOUR;
  const pauses = [{ start: t0 + 23 * HOUR, end: t0 + 23 * HOUR + 10 * MIN }, { start: t0 + DAY + 2 * HOUR, end: t0 + DAY + 2 * HOUR + 5 * MIN }];
  const trend = buildTrend({ sleepEvents: [{ start, end, data: { pauses } }], feedEvents: [], diaperEvents: [], now: now + DAY, days: 2, nightWindow: NIGHT });
  assert.equal(trend[0].wakenings, 2);
});

test("buildTrend agrega mamadas por lado/tipo de leite e fraldas por tipo", () => {
  const now = Date.parse("2026-03-10T12:00:00");
  const t0 = midnight(now);
  const feedEvents = [
    { start: t0 + 1 * HOUR, end: t0 + 1 * HOUR + 15 * MIN, kind: "peito-e", data: {} },
    { start: t0 + 4 * HOUR, ml: 90, kind: "mamadeira", data: { milkType: "formula" } },
  ];
  const diaperEvents = [{ start: t0 + 2 * HOUR, kind: "xixi" }, { start: t0 + 3 * HOUR, kind: "coco" }];
  const trend = buildTrend({ sleepEvents: [], feedEvents, diaperEvents, now, days: 1, nightWindow: NIGHT });
  const d = trend[0];
  assert.equal(d.feedCount, 2);
  assert.equal(d.feedMin, 15);
  assert.equal(d.feedMl, 90);
  assert.equal(d.feedBySide["peito-e"], 1);
  assert.equal(d.feedByMilk.formula, 1);
  assert.equal(d.diaper.xixi, 1);
  assert.equal(d.diaper.coco, 1);
});

test("buildTrend monta o mapa de calor 24h com a fração de cada hora dormindo", () => {
  const now = Date.parse("2026-03-10T12:00:00");
  const t0 = midnight(now);
  const sleepEvents = [{ start: t0 + 1 * HOUR + 30 * MIN, end: t0 + 2 * HOUR, data: {} }]; // 1h30-2h
  const trend = buildTrend({ sleepEvents, feedEvents: [], diaperEvents: [], now, days: 1, nightWindow: NIGHT });
  const hours = trend[0].hours;
  assert.equal(hours[1], 0.5);
  assert.equal(hours[2], 0);
  assert.equal(hours[0], 0);
});

test("computeInsights pede mais dias quando há menos de 3 dias com sono", () => {
  const trend = [{ sleepDayMin: 0, sleepNightMin: 0 }, { sleepDayMin: 60, sleepNightMin: 0 }];
  const insights = computeInsights(trend);
  assert.equal(insights.length, 1);
  assert.match(insights[0], /faltam dias/);
});

test("computeInsights produz frases quando há dados suficientes, sem lançar erro", () => {
  const trend = [
    { sleepDayMin: 180, sleepNightMin: 400, longestNightMin: 240, wakenings: 2, napCount: 3, feedCount: 8 },
    { sleepDayMin: 150, sleepNightMin: 420, longestNightMin: 260, wakenings: 1, napCount: 3, feedCount: 7 },
    { sleepDayMin: 160, sleepNightMin: 500, longestNightMin: 300, wakenings: 1, napCount: 2, feedCount: 6 },
  ];
  const insights = computeInsights(trend);
  assert.ok(insights.length >= 3);
  for (const s of insights) assert.equal(typeof s, "string");
});

test("ageMonthsExact converte dias em meses médios (30.4375 dias/mês)", () => {
  const birth = Date.parse("2026-01-01T00:00:00");
  const at = birth + 30.4375 * DAY;
  assert.ok(Math.abs(ageMonthsExact(birth, at) - 1) < 1e-9);
});

test("lmsAt interpola linearmente entre dois meses da tabela", () => {
  const table = [[0, 0.3, 3, 0.1], [1, 0.2, 4, 0.13]];
  const mid = lmsAt(table, 0.5);
  assert.ok(Math.abs(mid.M - 3.5) < 1e-9);
  assert.ok(Math.abs(mid.L - 0.25) < 1e-9);
});

test("growthPoint no valor M da tabela real da OMS dá z≈0 e percentil≈50", () => {
  const row0 = whoData.weight.boy[0]; // [0, L, M, S] no nascimento
  const pt = growthPoint(whoData.weight.boy, 0, row0[2]);
  assert.ok(Math.abs(pt.z) < 1e-6);
  assert.ok(Math.abs(pt.percentile - 50) < 1e-4);
});

test("valueForZ é a inversa de zScoreForValue", () => {
  const lms = { L: 0.15, M: 5, S: 0.12 };
  const z = zScoreForValue(6, lms);
  const back = valueForZ(lms, z);
  assert.ok(Math.abs(back - 6) < 1e-9);
});

test("percentileFromZ bate com valores conhecidos da normal padrão", () => {
  assert.ok(Math.abs(percentileFromZ(0) - 50) < 1e-6);
  assert.ok(Math.abs(percentileFromZ(1.96) - 97.5) < 0.05);
  assert.ok(Math.abs(percentileFromZ(-1.96) - 2.5) < 0.05);
});

test("percentileCurve devolve 25 pontos (0 a 24 meses) crescentes para peso", () => {
  const curve = percentileCurve(whoData.weight.boy, 0);
  assert.equal(curve.length, 25);
  assert.equal(curve[0].ageMonths, 0);
  assert.equal(curve[24].ageMonths, 24);
  assert.ok(curve[24].value > curve[0].value);
});

test("dados da OMS: 25 linhas (0-24 meses) para peso, altura e perímetro cefálico, meninos e meninas", () => {
  for (const measure of ["weight", "length", "head"]) {
    for (const sex of ["boy", "girl"]) {
      assert.equal(whoData[measure][sex].length, 25, `${measure}/${sex}`);
      assert.equal(whoData[measure][sex][0][0], 0);
      assert.equal(whoData[measure][sex][24][0], 24);
    }
  }
});

test("nightShiftCounts conta sonos noturnos por aparelho dentro do período, ignorando sonecas e dias fora da janela", () => {
  const now = Date.parse("2026-03-10T12:00:00");
  const t0 = midnight(now);
  const sleepEvents = [
    { start: t0 + 20 * HOUR, end: t0 + DAY + 6 * HOUR, deviceName: "iPhone do Papai", data: {} }, // noite 09→10
    { start: t0 - DAY + 20 * HOUR, end: t0 + 6 * HOUR, deviceName: "iPhone da Mamãe", data: {} }, // noite 08→09
    { start: t0 + 13 * HOUR, end: t0 + 14 * HOUR, deviceName: "iPhone do Papai", data: {} }, // soneca, não conta
    { start: t0 - 10 * DAY, end: t0 - 10 * DAY + 8 * HOUR, deviceName: "iPhone do Papai", data: { pauses: [] } }, // fora do período
  ];
  const counts = nightShiftCounts({ sleepEvents, now, days: 3, nightWindow: NIGHT });
  assert.equal(counts["iPhone do Papai"], 1);
  assert.equal(counts["iPhone da Mamãe"], 1);
});

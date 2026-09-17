import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUR, MIN, midnight, dayKey } from "../docs/js/time.js";
import {
  AGE_WINDOW_TABLE, ageWakeWindowRef, dailySleepRefHours, recencyWeight, trimOutliers, weightedMedian,
  napPosition, collectWakeGapsByPosition, personalWindowForPosition, calibration, countCompleteDays,
  isNewbornMode, countTodayNaps, suggestNapTransition, computeSchedule,
} from "../docs/js/schedule.js";

/* ---------- tabela de idade ---------- */
test("ageWakeWindowRef segue a tabela por faixa etária", () => {
  assert.deepEqual(ageWakeWindowRef(2), [35, 60]);
  assert.deepEqual(ageWakeWindowRef(10), [60, 90]);
  assert.deepEqual(ageWakeWindowRef(15), [75, 120]);
  assert.deepEqual(ageWakeWindowRef(20), [120, 180]);
  assert.deepEqual(ageWakeWindowRef(200), AGE_WINDOW_TABLE[AGE_WINDOW_TABLE.length - 1].range);
});
test("ageWakeWindowRef sem idade cai na faixa de recém-nascido", () => {
  assert.deepEqual(ageWakeWindowRef(null), [35, 60]);
});
test("dailySleepRefHours segue as referências por idade", () => {
  assert.deepEqual(dailySleepRefHours(2), { min: 14, max: 17, src: dailySleepRefHours(2).src });
  assert.equal(dailySleepRefHours(30).min, 12);
  assert.equal(dailySleepRefHours(200).min, 10);
});

/* ---------- estatística ---------- */
test("recencyWeight decai pela metade a cada meia-vida", () => {
  assert.ok(Math.abs(recencyWeight(5, 5) - 0.5) < 1e-9);
  assert.ok(Math.abs(recencyWeight(0, 5) - 1) < 1e-9);
});
test("trimOutliers não mexe em amostras pequenas", () => {
  assert.deepEqual(trimOutliers([10, 20, 30]), [10, 20, 30]);
});
test("trimOutliers remove valor muito fora do padrão em amostra maior", () => {
  const values = [50, 52, 55, 53, 51, 400];
  const trimmed = trimOutliers(values);
  assert.ok(!trimmed.includes(400));
  assert.equal(trimmed.length, 5);
});
test("weightedMedian ignora itens de peso zero", () => {
  const v = weightedMedian([{ value: 10, weight: 1 }, { value: 1000, weight: 0 }]);
  assert.equal(v, 10);
});
test("weightedMedian retorna null para lista vazia", () => {
  assert.equal(weightedMedian([]), null);
});

/* ---------- posição da soneca ---------- */
test("napPosition classifica primeira, meio e última", () => {
  assert.equal(napPosition(0, 3), "first");
  assert.equal(napPosition(1, 3), "middle");
  assert.equal(napPosition(2, 3), "last");
});
test("napPosition com uma soneca só é 'first'", () => {
  assert.equal(napPosition(0, 1), "first");
});

/* ---------- helpers de teste: gera sonos sintéticos ---------- */
function sleepEv(id, start, end, extra) { return { id, type: "sleep", start, end, ...extra }; }
function nightSleep(id, start, end) { return sleepEv(id, start, end, { isNight: true }); }

test("collectWakeGapsByPosition agrupa por posição dentro do dia", () => {
  const now = midnight(Date.now()) + 20 * HOUR;
  const d0 = midnight(now);
  const events = [
    nightSleep("n0", d0 - 10 * HOUR, d0 + 0), // noite terminando à meia-noite (posição zero do dia)
    sleepEv("nap1", d0 + 1 * HOUR, d0 + 1.5 * HOUR), // gap 60min
    sleepEv("nap2", d0 + 4 * HOUR, d0 + 5 * HOUR), // gap 150min
    nightSleep("n1", d0 + 12 * HOUR, d0 + 20 * HOUR),
  ];
  const buckets = collectWakeGapsByPosition(events, [19, 7], d0 - 24 * HOUR, now, []);
  assert.equal(buckets.first.length, 1);
  assert.equal(buckets.first[0].value, 60);
  assert.equal(buckets.last.length, 1);
  assert.equal(buckets.last[0].value, 150);
});

test("collectWakeGapsByPosition ignora dias marcados como atípicos", () => {
  const now = midnight(Date.now()) + 20 * HOUR;
  const d0 = midnight(now);
  const events = [
    nightSleep("n0", d0 - 10 * HOUR, d0),
    sleepEv("nap1", d0 + 1 * HOUR, d0 + 1.5 * HOUR),
  ];
  const key = dayKey(d0 + 1 * HOUR);
  const buckets = collectWakeGapsByPosition(events, [19, 7], d0 - 24 * HOUR, now, [key]);
  assert.equal(buckets.first.length, 0);
});

test("personalWindowForPosition usa referência da idade sem amostra suficiente", () => {
  const r = personalWindowForPosition([], [60, 90]);
  assert.equal(r.source, "reference");
  assert.equal(r.value, 75);
});
test("personalWindowForPosition usa mediana pessoal com amostra suficiente", () => {
  const items = [{ value: 70, weight: 1 }, { value: 72, weight: 1 }, { value: 68, weight: 1 }, { value: 71, weight: 1 }];
  const r = personalWindowForPosition(items, [60, 90]);
  assert.equal(r.source, "personal");
  assert.ok(r.value >= 60 && r.value <= 90);
});
test("personalWindowForPosition limita (clamp) à faixa da idade mesmo com dado pessoal fora dela", () => {
  const items = [{ value: 200, weight: 1 }, { value: 210, weight: 1 }, { value: 205, weight: 1 }, { value: 198, weight: 1 }];
  const r = personalWindowForPosition(items, [60, 90]);
  assert.equal(r.value, 90);
});

/* ---------- calibração ---------- */
test("calibration não está pronta com menos de 3 dias completos", () => {
  const c = calibration(1);
  assert.equal(c.ready, false);
  assert.equal(c.daysNeeded, 2);
});
test("calibration fica pronta a partir de 3 dias, confiança sobe com mais dias", () => {
  assert.equal(calibration(3).confidence, "low");
  assert.equal(calibration(5).confidence, "medium");
  assert.equal(calibration(7).confidence, "high");
});
test("isNewbornMode: sem idade, idade baixa ou sem calibração", () => {
  assert.equal(isNewbornMode(null, calibration(10)), true);
  assert.equal(isNewbornMode(5, calibration(10)), true);
  assert.equal(isNewbornMode(20, calibration(1)), true);
  assert.equal(isNewbornMode(20, calibration(5)), false);
});

/* ---------- hoje ---------- */
test("countTodayNaps conta só sonecas depois da última noite", () => {
  const now = midnight(Date.now()) + 15 * HOUR;
  const d0 = midnight(now);
  const events = [
    nightSleep("n0", d0 - 9 * HOUR, d0),
    sleepEv("nap1", d0 + 2 * HOUR, d0 + 3 * HOUR),
    sleepEv("nap2", d0 + 6 * HOUR, d0 + 7 * HOUR),
  ];
  assert.equal(countTodayNaps(events, now, [19, 7]), 2);
});

/* ---------- sugestão de transição ---------- */
test("suggestNapTransition não sugere nada sem sinais suficientes", () => {
  const now = Date.now();
  assert.equal(suggestNapTransition([], now, [19, 7]), null);
});
test("suggestNapTransition sugere reduzir após 3 de 5 dias com sinais", () => {
  const now = midnight(Date.now()) + 20 * HOUR;
  const events = [];
  for (let i = 0; i < 3; i++) {
    const d0 = midnight(now) - i * 24 * HOUR;
    events.push(sleepEv(`fail${i}`, d0 + 19 * HOUR, d0 + 19.2 * HOUR, { data: { attempt: "failed" } }));
  }
  const s = suggestNapTransition(events, now, [19, 7]);
  assert.ok(s && s.type === "reduce_naps");
});

/* ---------- orquestrador computeSchedule ---------- */
test("computeSchedule sem nenhum sono retorna explicação de 'registre mais'", () => {
  const r = computeSchedule({ sleepEvents: [], ageWeeks: 6, settings: {}, now: Date.now() });
  assert.equal(r.nextNap, null);
  assert.match(r.explain, /Registre/);
});
test("computeSchedule em modo recém-nascido sem calibração usa faixa da idade", () => {
  const d0 = midnight(Date.now());
  const now = d0 + 3 * HOUR;
  // sono termina antes da meia-noite (noite anterior) — nenhuma soneca "hoje" ainda, então a
  // próxima prevista é a 1ª do dia.
  const lastSleep = nightSleep("n0", d0 - 9 * HOUR, d0 - HOUR);
  const r = computeSchedule({ sleepEvents: [lastSleep], ageWeeks: 4, settings: {}, now });
  assert.equal(r.mode, "newborn");
  assert.ok(r.nextNap);
  assert.equal(r.nextNap.position, "first");
});
test("computeSchedule encurta a janela depois de uma soneca curta", () => {
  const now = midnight(Date.now()) + 15 * HOUR;
  const shortNap = sleepEv("short", now - 90 * MIN, now - 60 * MIN); // 30 min de duração
  const r = computeSchedule({ sleepEvents: [shortNap], ageWeeks: 10, settings: {}, now });
  const refMid = (60 + 90) / 2;
  assert.ok(r.nextNap.targetMin < refMid);
});
test("computeSchedule marca 'noite incompleta' quando acorda antes da hora mínima", () => {
  const d0 = midnight(Date.now());
  const now = d0 + 8 * HOUR;
  const nightEndsEarly = nightSleep("n", d0 - 10 * HOUR, d0 + 5 * HOUR); // acordou às 5h
  const r = computeSchedule({ sleepEvents: [nightEndsEarly], ageWeeks: 20, settings: { minWakeHour: 6 }, now });
  const refMid = (120 + 180) / 2;
  assert.ok(r.nextNap.targetMin < refMid);
});
test("computeSchedule respeita janela fixa quando configurada", () => {
  const d0 = midnight(Date.now());
  const now = d0 + 3 * HOUR;
  const lastSleep = nightSleep("n0", d0 - 9 * HOUR, d0 - HOUR);
  const r = computeSchedule({ sleepEvents: [lastSleep], ageWeeks: 10, settings: { fixedWindows: { first: 45 } }, now });
  assert.equal(r.nextNap.targetMin, 45);
  assert.match(r.explain, /fixa/);
});
test("computeSchedule nunca deixa a última janela do dia passar do máximo da idade", () => {
  const now = midnight(Date.now()) + 20 * HOUR;
  const d0 = midnight(now);
  const events = [];
  // várias últimas janelas históricas bem longas (acima do máximo etário) para forçar mediana pessoal alta
  for (let i = 1; i <= 5; i++) {
    const day = d0 - i * 24 * HOUR;
    events.push(nightSleep(`n${i}a`, day - HOUR, day + 8 * HOUR));
    events.push(sleepEv(`nap${i}`, day + 8 * HOUR + 400 * MIN, day + 9 * HOUR + 400 * MIN)); // gap de 400min = 6h40, acima da faixa
    events.push(nightSleep(`n${i}b`, day + 20 * HOUR, day + 28 * HOUR));
  }
  events.push(sleepEv("lastToday", d0 + 8 * HOUR, d0 + 8.5 * HOUR));
  const r = computeSchedule({ sleepEvents: events, ageWeeks: 10, settings: {}, now });
  assert.ok(r.nextNap.targetMin <= ageWakeWindowRefMax(10));
});
function ageWakeWindowRefMax(ageWeeks) { return ageWakeWindowRef(ageWeeks)[1]; }

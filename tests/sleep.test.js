import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUR, MIN } from "../docs/js/time.js";
import { netSleepDuration, isPauseAtNight, countNightWakenings, classifySleep, findSleepOverlap } from "../docs/js/sleep.js";

test("netSleepDuration desconta pausas fechadas", () => {
  const start = 0, end = 2 * HOUR;
  const pauses = [{ start: 30 * MIN, end: 45 * MIN }];
  assert.equal(netSleepDuration(start, end, pauses), 2 * HOUR - 15 * MIN);
});

test("netSleepDuration trata pausa ainda aberta até o fim do sono", () => {
  const start = 0, end = HOUR;
  const pauses = [{ start: 50 * MIN }]; // sem end: ainda em pausa quando o sono foi encerrado
  assert.equal(netSleepDuration(start, end, pauses), 50 * MIN);
});

test("netSleepDuration sem pausas é a duração cheia", () => {
  assert.equal(netSleepDuration(0, HOUR, []), HOUR);
  assert.equal(netSleepDuration(0, HOUR, null), HOUR);
});

test("isPauseAtNight identifica pausa dentro da janela 19h-7h", () => {
  const d = new Date(); d.setHours(23, 0, 0, 0);
  assert.equal(isPauseAtNight(d.getTime(), 19, 7), true);
  d.setHours(12, 0, 0, 0);
  assert.equal(isPauseAtNight(d.getTime(), 19, 7), false);
});

test("countNightWakenings conta só as pausas noturnas", () => {
  const night = new Date(); night.setHours(2, 0, 0, 0);
  const day = new Date(); day.setHours(15, 0, 0, 0);
  const pauses = [{ start: night.getTime() }, { start: day.getTime() }, { start: night.getTime() + HOUR }];
  assert.equal(countNightWakenings(pauses, 19, 7), 2);
});

test("classifySleep: dentro da janela noturna e >=2h vira 'night'", () => {
  const start = new Date(); start.setHours(21, 0, 0, 0);
  const end = start.getTime() + 8 * HOUR;
  assert.equal(classifySleep(start.getTime(), end, null, 19, 7), "night");
});

test("classifySleep: soneca de fim de tarde curta dentro da janela continua 'nap'", () => {
  const start = new Date(); start.setHours(19, 30, 0, 0);
  const end = start.getTime() + 40 * MIN;
  assert.equal(classifySleep(start.getTime(), end, null, 19, 7), "nap");
});

test("classifySleep: fora da janela é sempre 'nap'", () => {
  const start = new Date(); start.setHours(10, 0, 0, 0);
  const end = start.getTime() + 3 * HOUR;
  assert.equal(classifySleep(start.getTime(), end, null, 19, 7), "nap");
});

test("classifySleep: override manual sempre vence a classificação automática", () => {
  const start = new Date(); start.setHours(10, 0, 0, 0);
  const end = start.getTime() + 3 * HOUR;
  assert.equal(classifySleep(start.getTime(), end, true, 19, 7), "night");
  const start2 = new Date(); start2.setHours(21, 0, 0, 0);
  assert.equal(classifySleep(start2.getTime(), start2.getTime() + 8 * HOUR, false, 19, 7), "nap");
});

test("findSleepOverlap detecta sono existente que se sobrepõe", () => {
  const events = [{ id: "a", type: "sleep", start: 0, end: 2 * HOUR }];
  const hit = findSleepOverlap(events, HOUR, 3 * HOUR, null);
  assert.equal(hit.id, "a");
});

test("findSleepOverlap ignora o próprio registro ao editar", () => {
  const events = [{ id: "a", type: "sleep", start: 0, end: 2 * HOUR }];
  assert.equal(findSleepOverlap(events, HOUR, 3 * HOUR, "a"), null);
});

test("findSleepOverlap retorna null sem sobreposição", () => {
  const events = [{ id: "a", type: "sleep", start: 0, end: HOUR }];
  assert.equal(findSleepOverlap(events, 2 * HOUR, 3 * HOUR, null), null);
});

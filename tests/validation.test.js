import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUR } from "../docs/js/time.js";
import { checkSleepDuration, isSleepForgotten } from "../docs/js/validation.js";

test("duração até 12h é aceita sem confirmação", () => {
  const r = checkSleepDuration(10 * HOUR);
  assert.equal(r.ok, true);
  assert.equal(r.needsConfirm, false);
});

test("duração entre 12h e 16h pede confirmação", () => {
  const r = checkSleepDuration(14 * HOUR);
  assert.equal(r.ok, true);
  assert.equal(r.needsConfirm, true);
});

test("duração acima de 16h é rejeitada", () => {
  const r = checkSleepDuration(17 * HOUR);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too-long");
});

test("cronômetro esquecido de dia: limiar de 5h", () => {
  const start = new Date(); start.setHours(10, 0, 0, 0);
  const now = start.getTime() + 6 * HOUR;
  const r = isSleepForgotten(start.getTime(), now);
  assert.equal(r.forgotten, true);
});

test("cronômetro não esquecido de dia dentro do limiar", () => {
  const start = new Date(); start.setHours(10, 0, 0, 0);
  const now = start.getTime() + 2 * HOUR;
  const r = isSleepForgotten(start.getTime(), now);
  assert.equal(r.forgotten, false);
});

test("cronômetro esquecido de noite: limiar de 14h", () => {
  const start = new Date(); start.setHours(22, 0, 0, 0);
  const now = start.getTime() + 15 * HOUR;
  const r = isSleepForgotten(start.getTime(), now);
  assert.equal(r.forgotten, true);
});

test("sono noturno longo dentro do limiar de 14h não dispara alerta", () => {
  const start = new Date(); start.setHours(22, 0, 0, 0);
  const now = start.getTime() + 10 * HOUR;
  const r = isSleepForgotten(start.getTime(), now);
  assert.equal(r.forgotten, false);
});

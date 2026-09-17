import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN, HOUR, midnight } from "../docs/js/time.js";
import { parseDigitsToTime, offsetFromNow } from "../docs/js/timeinput.js";

test("parseDigitsToTime interpreta HHMM de 4 dígitos no mesmo dia", () => {
  const ref = midnight(Date.now()) + 20 * HOUR; // hoje às 20h
  const t = parseDigitsToTime("1432", ref);
  const d = new Date(t);
  assert.equal(d.getHours(), 14);
  assert.equal(d.getMinutes(), 32);
});

test("parseDigitsToTime interpreta 3 dígitos (ex.: 932 = 09:32)", () => {
  const ref = midnight(Date.now()) + 20 * HOUR;
  const t = parseDigitsToTime("932", ref);
  const d = new Date(t);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 32);
});

test("parseDigitsToTime joga para o dia anterior se ficar muito no futuro", () => {
  const ref = midnight(Date.now()) + 1 * HOUR; // hoje 01:00
  const t = parseDigitsToTime("2330", ref); // 23:30 seria +22h no futuro
  assert.ok(t < ref);
  const d = new Date(t);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 30);
});

test("parseDigitsToTime rejeita hora ou minuto inválido", () => {
  assert.equal(parseDigitsToTime("2561", Date.now()), null);
  assert.equal(parseDigitsToTime("12", Date.now()), null);
  assert.equal(parseDigitsToTime("abcde", Date.now()), null);
});

test("offsetFromNow desloca minutos para trás", () => {
  const now = Date.now();
  assert.equal(offsetFromNow(now, 10), now - 10 * MIN);
});

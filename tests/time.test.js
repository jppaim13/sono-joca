import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN, HOUR, DAY, midnight, overlap, splitByDay, fmtDur, fmtClock, dayKey } from "../docs/js/time.js";

test("splitByDay divide sono que cruza a meia-noite em dois pedaços corretos", () => {
  const today = midnight(Date.now());
  const start = today - 1 * HOUR; // 23:00 do dia anterior
  const end = today + 1.5 * HOUR; // 01:30 de hoje
  const pieces = splitByDay(start, end);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].day, today - DAY);
  assert.equal(pieces[0].start, start);
  assert.equal(pieces[0].end, today);
  assert.equal(pieces[1].day, today);
  assert.equal(pieces[1].start, today);
  assert.equal(pieces[1].end, end);
});

test("splitByDay não divide sono dentro do mesmo dia", () => {
  const today = midnight(Date.now());
  const start = today + 9 * HOUR, end = today + 10 * HOUR;
  const pieces = splitByDay(start, end);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].day, today);
});

test("overlap calcula interseção entre dois intervalos", () => {
  assert.equal(overlap(0, 10, 5, 15), 5);
  assert.equal(overlap(0, 10, 20, 30), 0);
  assert.equal(overlap(0, 10, 0, 10), 10);
});

test("fmtDur formata minutos e horas", () => {
  assert.equal(fmtDur(45), "45 min");
  assert.equal(fmtDur(60), "1h");
  assert.equal(fmtDur(125), "2h05");
});

test("fmtClock formata cronômetro", () => {
  assert.equal(fmtClock(65000), "01:05");
  assert.equal(fmtClock(3665000), "1:01:05");
});

test("dayKey formata AAAA-MM-DD estável", () => {
  const k = dayKey(midnight(Date.now()) + 3 * HOUR);
  assert.match(k, /^\d{4}-\d{2}-\d{2}$/);
});

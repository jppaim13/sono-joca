import test from "node:test";
import assert from "node:assert/strict";
import { VACCINE_CATALOG, addMonths, generateVaccineSchedule } from "../docs/js/vaccines.js";

test("addMonths soma meses de calendário sem vazar pro mês seguinte em finais de mês", () => {
  const birth = Date.parse("2026-01-31T00:00:00");
  const oneMonth = new Date(addMonths(birth, 1));
  assert.equal(oneMonth.getMonth(), 1); // fevereiro (0-indexed)
  assert.equal(oneMonth.getDate(), 28); // 2026 não é bissexto
});

test("addMonths preserva o dia do mês em casos normais", () => {
  const birth = Date.parse("2026-08-06T00:00:00");
  const twoMonths = new Date(addMonths(birth, 2));
  assert.equal(twoMonths.getFullYear(), 2026);
  assert.equal(twoMonths.getMonth(), 9); // outubro
  assert.equal(twoMonths.getDate(), 6);
});

test("generateVaccineSchedule gera uma entrada por item do catálogo, com dueAt e catalogId", () => {
  const birth = Date.parse("2026-08-06T00:00:00");
  const schedule = generateVaccineSchedule(birth);
  assert.equal(schedule.length, VACCINE_CATALOG.length);
  for (const item of schedule) {
    assert.ok(item.catalogId.length > 0);
    assert.ok(Number.isFinite(item.dueAt));
    assert.ok(["sus", "particular"].includes(item.category));
  }
});

test("generateVaccineSchedule produz catalogId únicos (sem duplicar linhas ao regenerar)", () => {
  const schedule = generateVaccineSchedule(Date.now());
  const ids = schedule.map(s => s.catalogId);
  assert.equal(new Set(ids).size, ids.length);
});

test("generateVaccineSchedule é determinístico: mesma data de nascimento gera os mesmos catalogId", () => {
  const birth = Date.parse("2026-08-06T00:00:00");
  const a = generateVaccineSchedule(birth).map(s => s.catalogId);
  const b = generateVaccineSchedule(birth).map(s => s.catalogId);
  assert.deepEqual(a, b);
});

test("primeira dose (BCG/Hepatite B) tem dueAt igual à data de nascimento", () => {
  const birth = Date.parse("2026-08-06T00:00:00");
  const schedule = generateVaccineSchedule(birth);
  const bcg = schedule.find(s => s.vaccine === "BCG");
  assert.equal(bcg.dueAt, birth);
});

test("Meningocócica ACWY protege contra os sorogrupos corretos (A, C, W e Y), não só B", () => {
  for (const item of VACCINE_CATALOG) {
    if (item.vaccine === "Meningocócica ACWY") assert.match(item.protects, /A, C, W e Y/);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleDelete, cancelDelete, isPending, isExpired, UNDO_WINDOW_MS } from "../docs/js/undo.js";

test("apagar agenda a exclusão sem efetivar na hora", () => {
  let pending = {};
  pending = scheduleDelete(pending, "ev1", 1000);
  assert.equal(isPending(pending, "ev1"), true);
  assert.equal(isExpired(pending, "ev1", 1000, UNDO_WINDOW_MS), false);
});

test("desfazer dentro da janela remove do pendente, nada é enviado", () => {
  let pending = {};
  pending = scheduleDelete(pending, "ev1", 1000);
  pending = cancelDelete(pending, "ev1");
  assert.equal(isPending(pending, "ev1"), false);
});

test("sem desfazer, expira após a janela de 10s e deve efetivar o soft-delete", () => {
  let pending = {};
  pending = scheduleDelete(pending, "ev1", 1000);
  assert.equal(isExpired(pending, "ev1", 1000 + UNDO_WINDOW_MS, UNDO_WINDOW_MS), true);
});

test("checar item que nunca foi agendado não é pendente nem expira", () => {
  const pending = {};
  assert.equal(isPending(pending, "nada"), false);
  assert.equal(isExpired(pending, "nada", 999999, UNDO_WINDOW_MS), false);
});

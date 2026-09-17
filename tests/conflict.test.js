import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWrite, resolveEditorName } from "../docs/js/conflict.js";

test("escrita com version atual (linha retornada) é aceita", () => {
  const r = resolveWrite([{ id: "1", version: 3 }]);
  assert.equal(r.ok, true);
  assert.equal(r.row.version, 3);
});

test("escrita com version desatualizada (nenhuma linha retornada) é conflito", () => {
  const r = resolveWrite([]);
  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
});

test("resposta nula também é tratada como conflito", () => {
  const r = resolveWrite(null);
  assert.equal(r.ok, false);
});

test("resolveEditorName prioriza device_name mesmo com last_edited_by/by_user_id presentes", () => {
  const users = { "u1": "Conta única" };
  const row = { device_name: "iPhone João", last_edited_by: "u1", by_user_id: "u1" };
  assert.equal(resolveEditorName(row, users), "iPhone João");
});

test("resolveEditorName trata device_name vazio como ausente e cai para o fallback", () => {
  const users = { "u1": "Papai" };
  const row = { device_name: "", last_edited_by: "u1", by_user_id: "u1" };
  assert.equal(resolveEditorName(row, users), "Papai");
});

test("resolveEditorName usa last_edited_by quando não há device_name (linha antes da conta única)", () => {
  const users = { "u1": "Papai", "u2": "Mamãe" };
  const row = { last_edited_by: "u2", by_user_id: "u1" };
  assert.equal(resolveEditorName(row, users), "Mamãe");
});

test("resolveEditorName cai para by_user_id quando last_edited_by é nulo (linha bem antiga)", () => {
  const users = { "u1": "Papai" };
  const row = { last_edited_by: null, by_user_id: "u1" };
  assert.equal(resolveEditorName(row, users), "Papai");
});

test("resolveEditorName retorna 'Alguém' quando o id não está no mapa de usuários", () => {
  const row = { last_edited_by: "u9", by_user_id: "u1" };
  assert.equal(resolveEditorName(row, { "u1": "Papai" }), "Alguém");
});

test("resolveEditorName retorna 'Alguém' para linha nula", () => {
  assert.equal(resolveEditorName(null, { "u1": "Papai" }), "Alguém");
});

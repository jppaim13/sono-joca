import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueue, dequeueFirst, opKey } from "../docs/js/outbox.js";

test("enfileirar duas mudanças no mesmo item mantém só a última", () => {
  let queue = [];
  queue = enqueue(queue, { kind: "upsert", table: "events", row: { id: "abc123", start: 1 } });
  queue = enqueue(queue, { kind: "upsert", table: "events", row: { id: "abc123", start: 2 } });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].row.start, 2);
});

test("ops de itens diferentes convivem na fila", () => {
  let queue = [];
  queue = enqueue(queue, { kind: "upsert", table: "events", row: { id: "a" } });
  queue = enqueue(queue, { kind: "upsert", table: "events", row: { id: "b" } });
  assert.equal(queue.length, 2);
});

test("dequeueFirst remove só o primeiro item", () => {
  let queue = [{ table: "t", id: "1" }, { table: "t", id: "2" }];
  queue = dequeueFirst(queue);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, "2");
});

test("fila sobrevive a serialização/deserialização (simula reload do app)", () => {
  let queue = [];
  queue = enqueue(queue, { kind: "update", table: "events", id: "x", patch: { deleted: true } });
  const reloaded = JSON.parse(JSON.stringify(queue));
  assert.deepEqual(reloaded, queue);
  assert.equal(opKey(reloaded[0]), "events:x");
});

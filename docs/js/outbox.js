// Reducer puro da fila de envio (outbox). Sem storage concreto — testável isoladamente.
// Cada op: {kind:"upsert", table, row:{id,...}} | {kind:"update", table, id, patch}
export function opKey(op) {
  return op.table + ":" + (op.row ? op.row.id : op.id);
}

// A última alteração do mesmo item vale — substitui qualquer op anterior para a mesma chave.
export function enqueue(queue, op) {
  const key = opKey(op);
  return [...queue.filter(q => opKey(q) !== key), op];
}

export function dequeueFirst(queue) {
  return queue.slice(1);
}

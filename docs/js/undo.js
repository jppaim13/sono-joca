// Estado puro da janela de "desfazer" ao apagar um registro. Sem setTimeout aqui —
// quem chama decide quando checar `isExpired` (permite testar sem esperar de verdade).
export const UNDO_WINDOW_MS = 10000;

export function scheduleDelete(pending, id, now) {
  return { ...pending, [id]: { at: now } };
}

export function cancelDelete(pending, id) {
  const rest = { ...pending };
  delete rest[id];
  return rest;
}

export function isPending(pending, id) {
  return Object.prototype.hasOwnProperty.call(pending, id);
}

export function isExpired(pending, id, now, windowMs = UNDO_WINDOW_MS) {
  const p = pending[id];
  if (!p) return false;
  return now - p.at >= windowMs;
}

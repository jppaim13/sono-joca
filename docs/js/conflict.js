// Resolução de conflito otimista por versão. `matchedRows` é o retorno de
// `.eq('version', expectedVersion).select()` — vazio significa que outro
// aparelho já mudou a linha entre a leitura e a escrita.
export function resolveWrite(matchedRows) {
  if (matchedRows && matchedRows.length > 0) {
    return { ok: true, row: matchedRows[0] };
  }
  return { ok: false, conflict: true };
}

// Nome de quem editou por último uma linha, para o aviso de conflito. `last_edited_by`
// é preenchido pelo app a partir da Fase 0; linhas antigas (de antes da migração) caem
// no fallback `by_user_id` (quem criou o registro).
export function resolveEditorName(row, usersById) {
  const id = row && (row.last_edited_by || row.by_user_id);
  return (id && usersById && usersById[id]) || "Alguém";
}

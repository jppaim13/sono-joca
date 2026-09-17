// Resolução de conflito otimista por versão. `matchedRows` é o retorno de
// `.eq('version', expectedVersion).select()` — vazio significa que outro
// aparelho já mudou a linha entre a leitura e a escrita.
export function resolveWrite(matchedRows) {
  if (matchedRows && matchedRows.length > 0) {
    return { ok: true, row: matchedRows[0] };
  }
  return { ok: false, conflict: true };
}

// Nome de quem editou por último uma linha, para o aviso de conflito e "registrado por".
// Conta única compartilhada entre os aparelhos: `last_edited_by`/`by_user_id` são sempre
// o mesmo usuário, então `device_name` (nome do aparelho, definido em Configurações) é
// quem realmente distingue "quem fez o quê". Cai para o UUID só em linhas antigas, de
// antes do aparelho ter nome definido.
export function resolveEditorName(row, usersById) {
  if (row && row.device_name) return row.device_name;
  const id = row && (row.last_edited_by || row.by_user_id);
  return (id && usersById && usersById[id]) || "Alguém";
}

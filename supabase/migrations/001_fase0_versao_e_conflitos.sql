-- Fase 0: coluna de versão para escrita condicional (conflitos entre os dois aparelhos),
-- quem fez a última alteração (pro aviso de conflito dizer o nome certo), e índice para a
-- consulta da Lixeira. Idempotente — só mexe em events/live_state deste projeto.
alter table public.events
  add column if not exists version integer not null default 1;
alter table public.events
  add column if not exists last_edited_by uuid references auth.users(id);

alter table public.live_state
  add column if not exists version integer not null default 1;
alter table public.live_state
  add column if not exists last_edited_by uuid references auth.users(id);

create index if not exists events_deleted_updated_idx
  on public.events (updated_at) where deleted = true;

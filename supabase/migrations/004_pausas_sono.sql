-- Fase 1: pausar/retomar um sono em andamento precisa ficar sincronizado entre os dois
-- iPhones enquanto o cronômetro está rodando (não só depois de salvo em events.data).
-- Idempotente, sem drop, só live_state.
alter table public.live_state
  add column if not exists pauses jsonb not null default '[]'::jsonb;

-- Conta única compartilhada entre os dois iPhones: como last_edited_by/by_user_id
-- passam a ser sempre o mesmo usuário, quem fez o quê é identificado pelo nome do
-- aparelho (definido em Configurações), não mais pela conta. Idempotente — só mexe
-- em events/live_state deste projeto.
alter table public.events
  add column if not exists device_name text;
alter table public.live_state
  add column if not exists device_name text;

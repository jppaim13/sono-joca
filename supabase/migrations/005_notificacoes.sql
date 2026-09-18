-- Fase 3: intervalo de aviso de fralda (mesmo padrão de feed_after_hours) e um gatilho que
-- avisa a Edge Function assim que um sono começa, sem esperar o próximo ciclo do agendador
-- (a cada 5 min). Idempotente, sem drop — só live_state e sono_notification_prefs.
alter table public.sono_notification_prefs
  add column if not exists diaper_after_hours numeric(3,1) not null default 3;

-- security definer + search_path fixo: função pequena, só dispara uma chamada HTTP,
-- não lê/escreve nada além do gatilho em si.
create or replace function public.sono_notify_sleep_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sleep_start is not null and (old.sleep_start is null or old.sleep_start is distinct from new.sleep_start) then
    perform net.http_post(
      url := 'https://lozveygdolwouekvxwkz.supabase.co/functions/v1/sono-scheduler',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('reason', 'sleep_start')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sono_live_state_sleep_start on public.live_state;
create trigger sono_live_state_sleep_start
  after update on public.live_state
  for each row execute function public.sono_notify_sleep_start();

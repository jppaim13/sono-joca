-- Fase 3: agenda a chamada periódica do sono-scheduler a cada 5 min. cron.schedule com o
-- mesmo nome de job atualiza em vez de duplicar — idempotente por natureza, sem precisar
-- de unschedule antes.
select cron.schedule(
  'sono_scheduler_5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://lozveygdolwouekvxwkz.supabase.co/functions/v1/sono-scheduler',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('reason', 'cron')
  );
  $$
);

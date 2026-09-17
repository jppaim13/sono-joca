-- Fases 1–6: schema completo de uma vez (registro rico, previsão, push/atalhos, tendências,
-- agenda, humor). Idempotente, sem DROP de tabela/coluna/dado — só alarga o schema existente
-- e cria tabelas novas (prefixo sono_). Só mexe nas tabelas deste projeto.
--
-- Duas exceções pontuais ao "sem drop", ambas sem perda de dado, explicadas inline:
--  1) events.type/events.kind: para ampliar o CHECK é preciso trocar a constraint (senão a
--     antiga, mais restritiva, continua valendo em conjunto com a nova). Uso
--     DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT — não toca nenhuma linha, só a regra de validação.
--  2) políticas de RLS e a publicação do Realtime não têm "CREATE ... IF NOT EXISTS" no Postgres;
--     uso blocos DO com "EXCEPTION WHEN duplicate_object" em vez de qualquer DROP.

-- ========== events: novos tipos + campos flexíveis ==========
alter table public.events
  add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.events
  add column if not exists is_night boolean;

alter table public.events drop constraint if exists events_type_check;
alter table public.events add constraint events_type_check
  check (type in ('sleep','feed','pump','diaper','medicine','bath','activity'));

alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check
  check (kind is null or kind in ('peito-e','peito-d','mamadeira','solido','xixi','coco','ambos'));

-- ========== baby: configurações (janela noturna, sonecas fixas, atalhos, fuso) ==========
alter table public.baby
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- ========== sono_growth: peso, altura, perímetro cefálico ==========
create table if not exists public.sono_growth (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  measured_at bigint not null,
  weight_g integer check (weight_g is null or weight_g between 0 and 30000),
  height_cm numeric(5,1) check (height_cm is null or height_cm between 0 and 150),
  head_cm numeric(4,1) check (head_cm is null or head_cm between 0 and 60),
  note varchar(200),
  by_user_id uuid references auth.users(id),
  last_edited_by uuid references auth.users(id),
  device_name text,
  deleted boolean not null default false,
  updated_at bigint not null,
  version integer not null default 1
);
create index if not exists sono_growth_measured_idx on public.sono_growth (measured_at);

-- ========== sono_agenda: atividades planejadas, consultas, vacinas ==========
create table if not exists public.sono_agenda (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  kind text not null check (kind in ('banho','passeio','consulta','vacina','outro')),
  title text not null,
  scheduled_at bigint not null,
  duration_min integer check (duration_min is null or duration_min between 0 and 1440),
  note varchar(200),
  completed boolean not null default false,
  by_user_id uuid references auth.users(id),
  last_edited_by uuid references auth.users(id),
  device_name text,
  deleted boolean not null default false,
  updated_at bigint not null,
  version integer not null default 1
);
create index if not exists sono_agenda_scheduled_idx on public.sono_agenda (scheduled_at);

-- ========== sono_journal: humor dos pais ("aba Vocês") ==========
create table if not exists public.sono_journal (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  at bigint not null,
  mood smallint not null check (mood between 1 and 5),
  note varchar(500),
  by_user_id uuid references auth.users(id),
  last_edited_by uuid references auth.users(id),
  device_name text,
  deleted boolean not null default false,
  updated_at bigint not null,
  version integer not null default 1
);
create index if not exists sono_journal_at_idx on public.sono_journal (at);

-- ========== sono_push_subscriptions: inscrição Web Push por aparelho ==========
create table if not exists public.sono_push_subscriptions (
  id bigint generated always as identity primary key,
  device_name text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  by_user_id uuid references auth.users(id),
  created_at bigint not null
);

-- ========== sono_notification_prefs: o que cada aparelho quer receber ==========
create table if not exists public.sono_notification_prefs (
  device_name text primary key,
  nap_enabled boolean not null default true,
  nap_lead_min integer not null default 30,
  feed_enabled boolean not null default true,
  feed_after_hours numeric(3,1) not null default 3,
  diaper_enabled boolean not null default false,
  medicine_enabled boolean not null default true,
  agenda_enabled boolean not null default true,
  sleep_start_notify_enabled boolean not null default true,
  updated_at bigint not null,
  version integer not null default 1
);

-- ========== sono_notification_log: o que já foi enviado (evita duplicar aviso) ==========
create table if not exists public.sono_notification_log (
  id bigint generated always as identity primary key,
  kind text not null,
  device_name text not null,
  sent_at bigint not null,
  payload jsonb not null default '{}'::jsonb,
  delivered boolean not null default true
);
create index if not exists sono_notification_log_sent_idx on public.sono_notification_log (sent_at);
create index if not exists sono_notification_log_kind_device_idx on public.sono_notification_log (kind, device_name);

-- ========== sono_quick_tokens: token de ação rápida (Atalhos/Siri/Watch) ==========
-- Só o hash fica aqui; o token em si é mostrado uma vez no app e nunca gravado no banco.
create table if not exists public.sono_quick_tokens (
  id bigint generated always as identity primary key,
  device_name text not null,
  token_hash text not null unique,
  by_user_id uuid references auth.users(id),
  created_at bigint not null,
  revoked_at bigint
);
create index if not exists sono_quick_tokens_device_idx on public.sono_quick_tokens (device_name);

-- ========== RLS: mesma política de sempre (conta única, acesso total autenticado) ==========
alter table public.sono_growth enable row level security;
alter table public.sono_agenda enable row level security;
alter table public.sono_journal enable row level security;
alter table public.sono_push_subscriptions enable row level security;
alter table public.sono_notification_prefs enable row level security;
alter table public.sono_notification_log enable row level security;
alter table public.sono_quick_tokens enable row level security;

do $$ begin
  create policy "authenticated full access" on public.sono_growth for all
    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on public.sono_agenda for all
    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on public.sono_journal for all
    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on public.sono_push_subscriptions for all
    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on public.sono_notification_prefs for all
    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on public.sono_notification_log for all
    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on public.sono_quick_tokens for all
    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- ========== Realtime: sincroniza entre os dois iPhones sem esperar polling ==========
do $$ begin
  alter publication supabase_realtime add table public.sono_growth, public.sono_agenda, public.sono_journal;
exception when duplicate_object then null; end $$;

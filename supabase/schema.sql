-- Sono do Joaquim — schema Supabase
-- Rode este arquivo inteiro no SQL Editor do painel do Supabase (projeto novo, vazio).
-- É a foto completa e atual do schema (mudanças incrementais ficam em migrations/).

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null
);

create table public.baby (
  id smallint primary key default 1 check (id = 1),
  name text not null default 'Joaquim',
  birth date,
  updated_at bigint not null,
  settings jsonb not null default '{}'::jsonb
);

create table public.live_state (
  id smallint primary key default 1 check (id = 1),
  sleep_start bigint,
  sleep_by uuid references auth.users(id),
  feed_start bigint,
  feed_kind text check (feed_kind is null or feed_kind in ('peito-e','peito-d','mamadeira','solido')),
  feed_by uuid references auth.users(id),
  updated_at bigint not null,
  version integer not null default 1,
  last_edited_by uuid references auth.users(id),
  device_name text,
  pauses jsonb not null default '[]'::jsonb
);

create table public.events (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  type text not null check (type in ('sleep','feed','pump','diaper','medicine','bath','activity')),
  kind text check (kind is null or kind in ('peito-e','peito-d','mamadeira','solido','xixi','coco','ambos')),
  start bigint not null,
  "end" bigint check ("end" is null or "end" > start),
  ml integer check (ml is null or (ml between 0 and 1000)),
  note varchar(200),
  by_user_id uuid references auth.users(id),
  deleted boolean not null default false,
  updated_at bigint not null,
  version integer not null default 1,
  last_edited_by uuid references auth.users(id),
  device_name text,
  data jsonb not null default '{}'::jsonb,
  is_night boolean
);
create index events_start_idx on public.events (start);
create index events_updated_at_idx on public.events (updated_at);
create index events_deleted_updated_idx on public.events (updated_at) where deleted = true;

create table public.sono_growth (
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
create index sono_growth_measured_idx on public.sono_growth (measured_at);

create table public.sono_agenda (
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
create index sono_agenda_scheduled_idx on public.sono_agenda (scheduled_at);

create table public.sono_journal (
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
create index sono_journal_at_idx on public.sono_journal (at);

create table public.sono_push_subscriptions (
  id bigint generated always as identity primary key,
  device_name text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  by_user_id uuid references auth.users(id),
  created_at bigint not null
);

create table public.sono_notification_prefs (
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

create table public.sono_notification_log (
  id bigint generated always as identity primary key,
  kind text not null,
  device_name text not null,
  sent_at bigint not null,
  payload jsonb not null default '{}'::jsonb,
  delivered boolean not null default true
);
create index sono_notification_log_sent_idx on public.sono_notification_log (sent_at);
create index sono_notification_log_kind_device_idx on public.sono_notification_log (kind, device_name);

-- Só o hash do token de ação rápida fica aqui; o token em si é mostrado uma vez no app
-- e nunca gravado no banco.
create table public.sono_quick_tokens (
  id bigint generated always as identity primary key,
  device_name text not null,
  token_hash text not null unique,
  by_user_id uuid references auth.users(id),
  created_at bigint not null,
  revoked_at bigint
);
create index sono_quick_tokens_device_idx on public.sono_quick_tokens (device_name);

-- Linha única (singleton) para bebê e cronômetros compartilhados.
insert into public.baby (id, updated_at) values (1, 0);
insert into public.live_state (id, updated_at) values (1, 0);

-- RLS: só as pessoas autenticadas (conta única, compartilhada entre os dois aparelhos) têm
-- acesso, e todas têm acesso total aos dados — é um diário compartilhado, não por usuário.
alter table public.profiles enable row level security;
alter table public.baby enable row level security;
alter table public.live_state enable row level security;
alter table public.events enable row level security;
alter table public.sono_growth enable row level security;
alter table public.sono_agenda enable row level security;
alter table public.sono_journal enable row level security;
alter table public.sono_push_subscriptions enable row level security;
alter table public.sono_notification_prefs enable row level security;
alter table public.sono_notification_log enable row level security;
alter table public.sono_quick_tokens enable row level security;

create policy "authenticated full access" on public.profiles for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.baby for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.live_state for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.events for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.sono_growth for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.sono_agenda for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.sono_journal for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.sono_push_subscriptions for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.sono_notification_prefs for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.sono_notification_log for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.sono_quick_tokens for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Realtime: sonos/mamadas/cronômetro/crescimento/agenda/humor atualizam quase na hora
-- entre os dois celulares. Tabelas de sistema (push, tokens, prefs, log) ficam fora.
alter publication supabase_realtime add table
  public.events, public.live_state, public.sono_growth, public.sono_agenda, public.sono_journal;

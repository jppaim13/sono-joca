-- Sono do Joaquim — schema Supabase
-- Rode este arquivo inteiro no SQL Editor do painel do Supabase (projeto novo, vazio).

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null
);

create table public.baby (
  id smallint primary key default 1 check (id = 1),
  name text not null default 'Joaquim',
  birth date,
  updated_at bigint not null
);

create table public.live_state (
  id smallint primary key default 1 check (id = 1),
  sleep_start bigint,
  sleep_by uuid references auth.users(id),
  feed_start bigint,
  feed_kind text check (feed_kind is null or feed_kind in ('peito-e','peito-d','mamadeira','solido')),
  feed_by uuid references auth.users(id),
  updated_at bigint not null
);

create table public.events (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  type text not null check (type in ('sleep','feed')),
  kind text check (kind is null or kind in ('peito-e','peito-d','mamadeira','solido')),
  start bigint not null,
  "end" bigint check ("end" is null or "end" > start),
  ml integer check (ml is null or (ml between 0 and 1000)),
  note varchar(200),
  by_user_id uuid references auth.users(id),
  deleted boolean not null default false,
  updated_at bigint not null
);
create index events_start_idx on public.events (start);
create index events_updated_at_idx on public.events (updated_at);

-- Linha única (singleton) para bebê e cronômetros compartilhados.
insert into public.baby (id, updated_at) values (1, 0);
insert into public.live_state (id, updated_at) values (1, 0);

-- RLS: só as pessoas autenticadas (os 2 pais, cadastrados manualmente) têm acesso,
-- e todas têm acesso total aos dados — é um diário compartilhado, não por usuário.
alter table public.profiles enable row level security;
alter table public.baby enable row level security;
alter table public.live_state enable row level security;
alter table public.events enable row level security;

create policy "authenticated full access" on public.profiles for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.baby for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.live_state for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on public.events for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Realtime: cronômetro e sonos/mamadas atualizam quase na hora entre os dois celulares.
alter publication supabase_realtime add table public.events, public.live_state;

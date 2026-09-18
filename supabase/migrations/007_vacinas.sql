-- Cartão de vacinas (checklist), pedido pelo usuário depois da Fase 6. Idempotente e aditiva:
-- só cria a tabela nova (sono_vaccines) e a habilita no Realtime; nada em events/live_state/baby.
create table if not exists public.sono_vaccines (
  id text primary key check (id ~ '^[a-z0-9]{6,40}$'),
  catalog_id text not null unique, -- chave estável (idade+vacina+dose) pra gerar o calendário sem duplicar
  age_label text not null,         -- "Ao nascer", "2 meses", "4 anos"...
  due_at bigint not null,          -- calculado a partir de baby.birth quando o calendário é gerado
  vaccine text not null,
  dose_label text,
  category text not null check (category in ('sus', 'particular')),
  protects text,
  applied boolean not null default false,
  applied_at bigint,
  note varchar(200),
  by_user_id uuid references auth.users(id),
  last_edited_by uuid references auth.users(id),
  device_name text,
  deleted boolean not null default false,
  updated_at bigint not null,
  version integer not null default 1
);
create index if not exists sono_vaccines_due_idx on public.sono_vaccines (due_at);

alter table public.sono_vaccines enable row level security;
do $$ begin
  create policy "authenticated full access" on public.sono_vaccines for all
    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.sono_vaccines;
exception when duplicate_object then null; end $$;

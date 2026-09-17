-- Rode DEPOIS de criar os 2 usuários em Authentication → Users no painel do Supabase.
-- Troque os UUIDs (copie de cada usuário em Authentication → Users) e os nomes.

insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-000000000000', 'Nome da pessoa 1'),
  ('11111111-1111-1111-1111-111111111111', 'Nome da pessoa 2');

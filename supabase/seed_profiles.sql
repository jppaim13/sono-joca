-- Roda uma vez para cada pessoa, depois de criar o usuário dela em Authentication → Users.
-- Troque o UUID (copie da lista de usuários) e o nome.

insert into public.profiles (id, name) values
  ('6eca7259-d3d5-462c-81bc-a7385dc179e4', 'Papai');

-- Quando criar o segundo usuário (Mamãe), rode:
-- insert into public.profiles (id, name) values ('UUID-DA-MAMAE-AQUI', 'Mamãe');

-- Conta única, compartilhada entre os dois iPhones (ver README, seção Autenticação) — só uma
-- linha aqui, não uma por pessoa. Serve de fallback para "registrado por" e os avisos de
-- conflito em linhas antigas, de antes do nome do aparelho existir; o nome de verdade que
-- aparece no dia a dia é o definido em Configurações → "Nome deste aparelho" (device_name).
-- No projeto já em produção essa linha já existe (com o nome "Papai") — não precisa rodar de
-- novo; isto aqui é só o modelo para uma instalação nova do zero.

insert into public.profiles (id, name) values
  ('6eca7259-d3d5-462c-81bc-a7385dc179e4', 'Papai e Mamãe');

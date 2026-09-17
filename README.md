# Sono do Joaquim

App pessoal para registrar sono e mamadas do bebê, compartilhado entre os pais.
Frontend estático (PWA) + Supabase (banco, autenticação e sincronização em tempo real),
hospedado de graça no GitHub Pages.

**No ar em:** https://jppaim13.github.io/sono-joca/
**Repositório:** https://github.com/jppaim13/sono-joca (público — necessário porque GitHub Pages não
funciona em repositório privado no plano GitHub Free; não há segredo no código, a anon key do Supabase é
pública por design e a segurança real vem das políticas de RLS)

## Estrutura

```
docs/           app do celular (index.html, PWA, ícones) — é o que o GitHub Pages publica
supabase/       schema.sql (tabelas + políticas) e seed_profiles.sql (nomes dos usuários)
```

## Status atual (atualizado em 2026-09-17)

Feito:
- Schema aplicado no Supabase, RLS ativo, Realtime habilitado em `events`/`live_state`.
- GitHub Pages publicando `docs/` em produção (link acima).
- Login por magic link testado e funcionando.
- Perfil "Papai" cadastrado em `profiles` (UUID `6eca7259-d3d5-462c-81bc-a7385dc179e4`).

Pendente:
- Criar o segundo usuário (Mamãe) em Authentication → Users e cadastrar o perfil dela
  (ver comentário em `supabase/seed_profiles.sql`).
- Testar o fluxo completo em produção nos dois celulares: registrar sono/mamada, conferir
  Semana/Registros, confirmar que o cronômetro compartilhado sincroniza quase na hora entre os
  dois aparelhos (via Realtime).
- Adicionar o app à tela inicial dos dois celulares (PWA).

**Detalhe importante para quem for mexer no banco:** o projeto Supabase usado
(`lozveygdolwouekvxwkz`, região sa-east-1) é **compartilhado** com outro app do dono do repositório
("Realeza Representações"). As tabelas desse app de negócio (`ajustes_resultado`, `config`, `convites`,
`lancamentos`, `pedidos`, `representantes`) convivem no mesmo banco com as tabelas deste projeto
(`profiles`, `baby`, `live_state`, `events`). Nunca rodar comandos destrutivos amplos (`drop schema`,
`truncate` sem filtro, alterar `auth.users` em massa etc.) sem checar que não afetam essas tabelas.
`auth.users` também é compartilhado — um e-mail que já tem conta no outro app pode ser reaproveitado aqui.

## Configurar um projeto novo do zero (ou entender como este foi montado)

1. Crie um projeto no [supabase.com](https://supabase.com) (ou use um existente — cuidado se for
   compartilhado com outro app, ver aviso acima).
2. No **SQL Editor** do projeto, rode o conteúdo de `supabase/schema.sql`.
3. Em **Authentication → Users**, crie um usuário para cada pessoa (e-mail + "Auto Confirm User"
   ligado; senha pode ser qualquer coisa, nunca vai ser usada — o login é só por link mágico).
4. Copie o UUID de cada usuário criado e rode um `insert into public.profiles` para cada um
   (modelo em `supabase/seed_profiles.sql`).
5. Em **Authentication → URL Configuration**, troque a **Site URL** para a URL final do app
   (ex.: `https://SEU-USUARIO.github.io/sono-joca/`) e adicione a mesma URL em **Redirect URLs**.
6. No GitHub, vá em **Settings → Pages** e configure **Deploy from branch**: `main` / pasta `/docs`
   (exige repositório público no plano Free).
7. Abra a URL publicada — na primeira vez ela pede a **Project URL** e a **anon public key**
   (Project Settings → API no Supabase). Cole os dois; ficam salvos só no `localStorage` daquele
   aparelho (não vão para o código/repositório). Para trocar depois, tem um link "Trocar
   configuração do Supabase" na tela de login.
8. Faça login com o e-mail cadastrado e adicione o app à tela inicial do celular.

## Rodar localmente antes de publicar

```bash
cd docs
python -m http.server 8000
```

Abra `http://localhost:8000` — pede a mesma configuração inicial (Project URL + anon key) e fala
direto com o Supabase configurado; não precisa de backend rodando.

## Alterar o banco

Edite `supabase/schema.sql` (ou crie um novo arquivo `.sql` com só a mudança) e rode no SQL Editor do Supabase.
Não existe mais migração automática de um framework — o `schema.sql` é a fonte da verdade do schema atual;
mantenha-o atualizado a cada mudança para poder recriar o banco do zero se precisar. Atenção ao aviso acima
sobre o banco ser compartilhado com outro app.

## Autenticação

Login por **magic link**: a pessoa digita o e-mail, recebe um link por e-mail e entra ao abrir esse link.
Não existe cadastro público — só os e-mails criados manualmente em Authentication → Users conseguem entrar.
A segurança dos dados vem das políticas de RLS no banco (`supabase/schema.sql`), não do sigilo da anon key.

Se o link mágico voltar com erro `otp_expired`: o link só funciona uma vez (apps de e-mail às vezes
"abrem" o link sozinhos por segurança, invalidando antes do clique real) — peça um novo e clique direto
nele. Se voltar redirecionando para `localhost:3000`, é a Site URL do Supabase que ainda não foi trocada
(passo 5 acima).

# Sono do Joaquim

App pessoal para registrar sono e mamadas do bebê, compartilhado entre os pais.
Frontend estático (PWA) + Supabase (banco, autenticação e sincronização em tempo real),
hospedado de graça no GitHub Pages.

## Estrutura

```
docs/           app do celular (index.html, PWA, ícones) — é o que o GitHub Pages publica
supabase/       schema.sql (tabelas + políticas) e seed_profiles.sql (nomes dos 2 usuários)
```

## Configurar um projeto novo do zero

1. Crie um projeto no [supabase.com](https://supabase.com) (ou use um existente).
2. No **SQL Editor** do projeto, rode o conteúdo de `supabase/schema.sql`.
3. Em **Authentication → Users**, crie um usuário para cada pessoa (só o e-mail, sem senha — o login é por link mágico).
4. Copie o UUID de cada usuário criado e edite `supabase/seed_profiles.sql` com os UUIDs e nomes reais, depois rode esse arquivo no SQL Editor.
5. Em **Authentication → URL Configuration**, adicione a URL do GitHub Pages (ex.: `https://SEU-USUARIO.github.io/sono-joca/`) em Redirect URLs.
6. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**, e cole nas constantes `SUPABASE_URL`/`SUPABASE_ANON_KEY` no topo do `<script>` em `docs/index.html`.
7. No GitHub, vá em **Settings → Pages** do repositório e configure **Deploy from branch**: `main` / pasta `/docs`.
8. Abra a URL publicada no celular, faça login e adicione à tela inicial.

## Rodar localmente antes de publicar

```bash
cd docs
python -m http.server 8000
```

Abra `http://localhost:8000` — fala direto com o projeto Supabase configurado no `index.html` (não precisa de backend rodando).

## Alterar o banco

Edite `supabase/schema.sql` (ou crie um novo arquivo `.sql` com só a mudança) e rode no SQL Editor do Supabase.
Não existe mais migração automática de um framework — o `schema.sql` é a fonte da verdade do schema atual;
mantenha-o atualizado a cada mudança para poder recriar o banco do zero se precisar.

## Autenticação

Login por **magic link**: a pessoa digita o e-mail, recebe um link por e-mail e entra ao abrir esse link.
Não existe cadastro público — só os e-mails criados manualmente em Authentication → Users conseguem entrar.
A segurança dos dados vem das políticas de RLS no banco (`supabase/schema.sql`), não do sigilo da anon key
(ela é pública por design do Supabase).

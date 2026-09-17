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
docs/               app do celular — é o que o GitHub Pages publica
  index.html         casca HTML/CSS, carrega js/app.js como módulo
  js/                lógica: app.js (render + Supabase) e módulos puros/testáveis
                      (time.js, validation.js, outbox.js, conflict.js, undo.js, store.js,
                      timeinput.js, sleep.js)
  sw.js               service worker (cache do app shell + aviso de nova versão)
supabase/
  schema.sql          foto atual completa do schema (tabelas + RLS + índices)
  migrations/         mudanças incrementais, uma por arquivo, idempotentes
  seed_profiles.sql   fallback do nome de conta (conta única — ver Autenticação)
tests/               testes automatizados (Node, node:test) dos módulos puros de docs/js/
```

## Status atual (atualizado em 2026-09-17)

Feito:
- Schema aplicado no Supabase, RLS ativo, Realtime habilitado em `events`/`live_state`.
- GitHub Pages publicando `docs/` em produção (link acima).
- Login testado e funcionando — trocado de código por e-mail para **e-mail + senha** (ver seção
  Autenticação); o Supabase free não permite customizar o template de e-mail sem SMTP próprio.
- Perfil "Papai" cadastrado em `profiles` (UUID `6eca7259-d3d5-462c-81bc-a7385dc179e4`).
- **Fase 0 (confiabilidade)** implementada — ver diagnóstico e detalhes na seção
  [Fase 0 — confiabilidade](#fase-0--confiabilidade-diagnóstico-e-o-que-mudou) abaixo.
- **Migração `supabase/migrations/001_fase0_versao_e_conflitos.sql` aplicada e verificada** —
  `version`/`last_edited_by` já existem em `events` e `live_state`.
- **"Allow new users to sign up" desligado** em Authentication → Sign In / Providers.
- **Senha definida para o usuário Papai** em Authentication → Users.
- Validado no `localhost`: login, registro offline, persistência após reload, lixeira (checklist
  completo, 7 passos).
- **Decisão: conta única, compartilhada entre os dois iPhones** (em vez de um usuário por pessoa) —
  ver seção Autenticação. Cada aparelho tem seu próprio nome (Configurações → "Nome deste aparelho"),
  usado em "registrado por" e nos avisos de conflito; não é mais necessário criar um segundo usuário.
- **Migração `supabase/migrations/002_device_name.sql` aplicada e verificada** — `device_name`
  já existe em `events` e `live_state`.

- **Fase 1 (registro rápido e completo)** implementada — ver
  [Fase 1 — registro rápido e completo](#fase-1--registro-rápido-e-completo) abaixo.
- **Migrações `003_fases_1_a_6.sql` e `004_pausas_sono.sql` aplicadas e verificadas** — novos tipos
  de evento, `data`/`is_night` em `events`, `settings` em `baby`, `pauses` em `live_state`, e as
  tabelas `sono_growth`/`sono_agenda`/`sono_journal`/`sono_push_subscriptions`/
  `sono_notification_prefs`/`sono_notification_log`/`sono_quick_tokens` com RLS.

Pendente:
- Testar o fluxo completo em produção nos dois celulares (roteiros na seção Testes abaixo), incluindo
  definir o nome de cada aparelho na primeira abertura.
- Adicionar o app à tela inicial dos dois celulares (PWA).
- Fases 2–6 (previsão, push/atalhos, tendências, sons, agenda/conteúdo) — ainda não iniciadas.

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
3. Em **Authentication → Users**, crie **um usuário só** (é uma conta única, usada nos dois
   aparelhos — ver seção Autenticação): e-mail + uma senha de verdade (mínimo 10 caracteres — é a
   senha real de login, dá pra trocar depois em Configurações → Trocar senha) + "Auto Confirm User"
   ligado.
4. Copie o UUID do usuário criado e rode o `insert into public.profiles` (modelo em
   `supabase/seed_profiles.sql`) — é só um fallback para quando o nome do aparelho ainda não foi
   definido, não precisa de uma linha por pessoa.
5. Em **Authentication → Sign In / Providers**, desligue **"Allow new users to sign up"** (ver aviso
   acima sobre por quê).
6. No GitHub, vá em **Settings → Pages** e configure **Deploy from branch**: `main` / pasta `/docs`
   (exige repositório público no plano Free).
7. Abra a URL publicada — na primeira vez ela pede a **Project URL** e a **anon public key**
   (Project Settings → API no Supabase). Cole os dois; ficam salvos só no `localStorage` daquele
   aparelho (não vão para o código/repositório). Para trocar depois, tem um link "Trocar
   configuração do Supabase" na tela de login.
8. No iPhone: abra a URL no Safari, toque em Compartilhar → **Adicionar à Tela de Início** — o app
   só funciona instalado assim (fora do Safari), o próprio app orienta isso se detectar que ainda
   não foi instalado. Depois, abra pelo ícone criado e faça login com e-mail e senha (o iOS oferece
   salvar nas Chaves do iCloud / entrar com Face ID nas próximas vezes).

## Rodar localmente antes de publicar

```bash
cd docs
python -m http.server 8000
```

Abra `http://localhost:8000` — pede a mesma configuração inicial (Project URL + anon key) e fala
direto com o Supabase configurado; não precisa de backend rodando. Em `localhost` o app não é iPhone,
então a tela de "instale o app" não aparece — dá pra testar tudo num Chrome normal.

**Checklist antes do push** (depois de rodar a migração, desligar o cadastro público e definir senha
para os usuários):

1. Abra `http://localhost:8000`, cole a Project URL e a anon key (Project Settings → API no Supabase).
2. Faça login com e-mail e senha.
3. Registre um sono (toque em "Dormiu", espere alguns segundos, toque em "Acordou"). Deve aparecer em
   Registros com ✓.
4. Abra o DevTools (F12) → aba **Network** → marque **Offline**. Registre outra mamada (Mamadeira,
   qualquer ml) → deve aparecer com ⟳ (pendente) e o banner "Sem conexão" no topo.
5. Recarregue a página (F5) ainda offline → o registro pendente continua lá com ⟳ (prova que a fila
   sobreviveu ao reload via IndexedDB).
6. Desmarque **Offline** no DevTools → o ⟳ deve virar ✓ sozinho em poucos segundos.
7. Apague um registro → toque em "Desfazer" no toast dentro de 10s → volta. Apague de novo e não
   desfaça → some da lista → abra "Lixeira (30 dias)" no fim de Registros → "Restaurar" → volta.

## Testes automatizados

```bash
npm test
```

Roda os testes de `tests/*.test.js` (Node nativo, sem dependências) sobre os módulos puros em `docs/js/`
— duração de sono, detecção de conflito e do nome exibido no aviso, fila de envio, desfazer, corte de
sono pela meia-noite. Rode antes de cada commit; nada deveria ir para produção com testes quebrados.

## Alterar o banco

Toda mudança de schema vira um arquivo novo em `supabase/migrations/NNN_descricao.sql`, **idempotente**
(`add column if not exists`, `create index if not exists` etc.), revisado antes de rodar no SQL Editor do
Supabase. Depois de aplicar, atualize `supabase/schema.sql` para continuar sendo a foto completa e atual
do schema (permite recriar o banco do zero se precisar). Atenção ao aviso acima sobre o banco ser
compartilhado com outro app — migrações só devem tocar `profiles`, `baby`, `live_state`, `events`.

## Autenticação

Login por **e-mail e senha** (`signInWithPassword`) — não por link mágico nem código por e-mail.
Dois motivos: o Supabase free não deixa customizar o template de e-mail sem SMTP próprio configurado,
e mesmo customizado o link mágico não funciona de volta no PWA instalado no iPhone (abre no Safari
normal, que tem armazenamento separado do app na Tela de Início). Com e-mail e senha não existe esse
problema — não depende de e-mail nenhum na hora de entrar, e o iOS ainda oferece preencher e salvar a
senha nas Chaves do iCloud e entrar com Face ID nas próximas vezes (`autocomplete="username"` /
`autocomplete="current-password"` nos campos).

O app **nunca chama `signUp`** — só `signInWithPassword` (não cria conta) e, em Configurações →
Trocar senha, `updateUser({password})` (só troca a senha de quem já está logado). Ainda assim, é
importante manter "Allow new users to sign up" desligado no Supabase (ver Pendências acima), porque a
anon key é pública e alguém poderia chamar a API de cadastro diretamente, sem passar pelo app.

Não existe cadastro público — só o e-mail criado manualmente em Authentication → Users consegue
entrar, com a senha definida lá (ou trocada depois em Configurações → Trocar senha — é a mesma conta
usada no outro app, então a senha muda nos dois). A segurança dos dados vem das políticas de RLS no
banco (`supabase/schema.sql`), não do sigilo da anon key. A sessão persiste entre aberturas do app e o
token renova sozinho — login só é pedido de novo se a sessão expirar de verdade; como o iPhone não roda
nada em segundo plano, o app força uma resincronização e reconecta o Realtime toda vez que volta ao
primeiro plano (`visibilitychange`, `pageshow`, `focus`, `online`).

**Conta única, dois aparelhos.** As duas pessoas entram com o mesmo e-mail e senha — não há um usuário
por pessoa. Isso simplifica o Supabase (um só cadastro, uma só senha para lembrar), mas significa que
`by_user_id`/`last_edited_by` (o UUID de quem escreveu) deixam de servir para diferenciar quem fez o
quê, já que é sempre a mesma conta. Por isso cada aparelho tem seu próprio nome, guardado só localmente
(Configurações → "Nome deste aparelho", ex.: "iPhone do Papai") e enviado em toda escrita numa coluna
`device_name` (`events`/`live_state` — migração `002_device_name.sql`). É esse nome que aparece em
"registrado por" e nos avisos de conflito; a busca por `last_edited_by`/`by_user_id` só entra como
fallback para linhas de antes dessa mudança. O app pede o nome do aparelho automaticamente na primeira
vez que abre logado, se ainda não estiver definido.

**Sair só deste aparelho:** o botão "Sair desta conta" usa `signOut({ scope: 'local' })` — encerra a
sessão só no aparelho em que foi tocado, sem derrubar o login do outro iPhone (o padrão do Supabase,
sem esse `scope`, invalidaria a sessão nos dois ao mesmo tempo).

## Plataforma-alvo: só iPhone (PWA instalado)

O app é feito para ser instalado na Tela de Início via Safari (iOS 17+) e usado só assim — se detectar
que está rodando num iPhone/iPad fora do modo instalado (`display-mode: standalone`), mostra uma tela
pedindo para instalar em vez de deixar usar pelo Safari. Em outros navegadores/desktop (usado para
desenvolvimento e nos testes automatizados) esse bloqueio não se aplica.

## Fase 0 — confiabilidade: diagnóstico e o que mudou

O app foi inspirado no Napper, mas as avaliações negativas dele giram em torno de perda de registros,
sincronização lenta/conflitante entre cuidadores e travamentos. Antes da Fase 0, o app daqui tinha os
mesmos riscos: cache e fila de envio em `localStorage` (síncrono, mais frágil que IndexedDB), nenhum
status visível por registro (um erro de envio era descartado sem deixar rastro), nenhum controle de
conflito (dois toques quase simultâneos em "Dormiu"/"Acordou" em aparelhos diferentes — o último a
sincronizar apagava a ação do outro em silêncio), Realtime sem fallback observado (só um polling fixo de
30s, saudável ou não), nenhuma proteção contra cronômetro esquecido aberto por horas, exclusão sem
desfazer nem lixeira, nenhuma exportação de backup, nenhum jeito de diagnosticar um problema de sync, e
zero teste automatizado.

O que a Fase 0 resolveu, na prática: armazenamento local-first em IndexedDB (`docs/js/store.js`, migra
sozinho o que estava em `localStorage`); status ✓/⟳/⚠ por registro em Registros; conflito otimista por
coluna `version` em `events`/`live_state`, com escrita condicional (`.eq('version', ...)`) — nunca mais
sobrescreve silenciosamente, mostra quem alterou o quê e oferece "Reaplicar" quando sua edição não entrou;
Realtime com status observado e polling adaptativo (30s saudável / 15s em problema, com reconexão);
aviso de cronômetro esquecido; duração de sono até 16h com confirmação acima de 12h; desfazer (10s) +
lixeira (30 dias); exportar backup; tela de Diagnóstico com log e "copiar relatório"; aviso de nova
versão do PWA sem trocar sozinho no meio de um registro; 28 testes automatizados (`npm test`).

## Roteiro de testes manuais (Fase 0 — confiabilidade, no iPhone real)

Com dois iPhones instalados (iOS 17+), logados com a **mesma conta** (e-mail e senha únicos):

1. Abrir pelo Safari sem instalar → aparece a tela pedindo para instalar. Instalar e abrir pelo ícone.
2. Login com e-mail e senha (aceitar a sugestão das Chaves do iCloud/Face ID se o iOS oferecer) →
   entra. Configurações abre sozinha pedindo o nome do aparelho (ex.: "iPhone do Papai" num,
   "iPhone da Mamãe" no outro) — preencher e salvar. Sessão continua depois de fechar e reabrir o app.
3. Modo avião → registrar um sono → o item aparece com ⟳ em Registros → voltar a rede → vira ✓. Em
   Registros, "por" deve mostrar o nome do aparelho, não "por você"/UUID.
4. Os dois tocam "Dormiu"/"Acordou" quase juntos → quem perder a corrida vê um toast com o **nome do
   aparelho** que já registrou (não "Alguém"), sem apagar o dado do outro.
5. Deixar o cronômetro de sono aberto além do limiar (ajuste a hora do sistema para simular) → aparece
   o aviso "Esqueceu de parar?" na tela Hoje.
6. Apagar um registro → "Desfazer" no toast dentro de 10s recupera; apagar de novo e não desfazer →
   some da lista e aparece em Registros → "Lixeira (30 dias)" → "Restaurar" traz de volta.
7. Em Configurações → "Exportar backup" abre a folha de compartilhamento do iOS com o `.json`.
8. Em Configurações → "Diagnóstico" mostra o log de sincronização e permite copiar o relatório.
9. Deixar o app em segundo plano por alguns minutos (trocar de app), voltar → resincroniza e o
   Realtime reconecta sozinho (testar registrando algo no outro iPhone enquanto o primeiro estava em
   segundo plano).
10. Fechar o app com alterações pendentes offline, reabrir → a fila continua e envia quando a rede volta.
11. "Sair desta conta" num dos iPhones → o outro continua logado (sessão só cai no aparelho que saiu).
12. Depois de publicar uma atualização (novo `sono-shell-vN` em `docs/sw.js`), reabrir o app já instalado
    → aparece o toast "Nova versão disponível" sem recarregar sozinho no meio de um registro.

## Fase 1 — registro rápido e completo

Tudo passa pelo mesmo outbox/conflito da Fase 0 (fila local, `version`, `last_edited_by`, `device_name`)
— nenhuma escrita nova criou um caminho paralelo. Resumo do que entrou:

- **Novos tipos de evento**, na mesma tabela `events` (coluna `type` ampliada, campos variáveis em
  `data` jsonb): Extração de leite (`pump`, com lado e ml), Fralda (`diaper`, xixi/cocô/ambos), Remédio
  (`medicine`, nome/dose/intervalo), Banho (`bath`), Atividade (`activity`). Mamadeira ganhou tipo de
  leite (fórmula/materno ordenhado/misto).
- **Sono**: pausar/retomar durante o cronômetro (sincronizado ao vivo entre os dois aparelhos via
  `live_state.pauses`) — a duração mostrada no toast final já desconta as pausas; local do sono
  (berço/colo/carrinho/carro/sling); "tentei e não dormiu"/"cochilou em movimento"; classificação
  soneca × sono noturno automática pela janela configurada (padrão 19h–7h), com opção de marcar
  manualmente (`is_night`).
- **Crescimento** (`sono_growth`) e **Agenda** (`sono_agenda`, consultas/vacinas/passeios/banho) —
  tabelas próprias, mesmo padrão de conflito. A última pesagem aparece na tela Hoje; os próximos 3
  compromissos futuros também.
- **Colisão de sono**: salvar um sono que se sobrepõe a outro já registrado oferece Cancelar, Editar o
  existente ou Substituir (apaga o antigo e salva o novo).
- **Relógio interativo**: tocar num arco de sono ou ponto de mamada abre aquele registro para editar;
  tocar num espaço vazio do relógio abre "novo registro" já com aquele horário.
- **Entrada de horário**: botões "Agora"/"−5"/"−10"/"−15" no início do registro, além do seletor de
  data/hora nativo (para escolher outro dia).
- **"Acordado há X"** sempre visível no topo da tela Hoje quando não está dormindo; barra "Acordou
  HH:MM · Ajustar" / "Terminou HH:MM · Ajustar" por 5s depois de parar um cronômetro.
- **Atalhos configuráveis**: Configurações → "Atalhos da tela Hoje" — mostrar/esconder e reordenar
  (↑/↓) os botões secundários (Peito E/D/Mamadeira continuam sempre fixos na barra principal).
- **Onboarding de 3 telas** (como registrar, previsão × plano, calibração), mostrado uma vez após
  definir o nome do aparelho pela primeira vez; pulável.

**Simplificações assumidas** (documentadas para retomar depois, se quiser mais):
- Sem histórico completo de crescimento ainda — só a última medida aparece e é editável na tela Hoje;
  a lista completa e o gráfico ficam para a Fase 4 (curva de crescimento OMS).
- Sem lixeira/desfazer para Crescimento e Agenda (só `events` tem isso por enquanto) — apagar é direto.
- Atividade e Banho não têm um sub-tipo próprio além da Observação livre.
- A cor do ponto/traço no relógio e em Registros continua só sono (roxo) × todo o resto (laranja) — sem
  uma cor por tipo novo.
- Reordenar atalhos é por botões ↑/↓, não arrastar.

## Checklist local (Fase 1, Chrome/`localhost`)

Além do checklist da Fase 0 acima, depois de rodar as migrações `003`/`004`:

1. Criar um sono com pausa: "Dormiu" → "Pausar (acordou um pouco)" → esperar → "Retomar sono" →
   "Acordou". O toast final deve indicar duração líquida descontando a pausa.
2. Tocar num atalho (ex. Fralda) → salvar → aparece em Registros com o texto certo (ex. "Fralda · Xixi").
3. Criar Crescimento (peso/altura) pelo atalho → aparece a última pesagem na tela Hoje → tocar nela →
   edita.
4. Criar um compromisso de Agenda para as próximas horas → aparece em "Próximos compromissos" na tela
   Hoje → tocar → edita.
5. Criar um sono que se sobrepõe a outro já existente → aparece a tela de colisão → testar "Substituir".
6. Tocar num arco do relógio → abre esse sono para editar. Tocar num espaço vazio do relógio → abre
   "novo registro" com aquele horário preenchido.
7. Em Configurações → "Atalhos da tela Hoje", esconder um atalho e mover outro para cima → salvar →
   a tela Hoje reflete a nova ordem/visibilidade.

## Roteiro de testes manuais (Fase 1, no iPhone real)

1. Login com uma conta que ainda não tem nome de aparelho definido → Configurações abre sozinha →
   depois de salvar, aparece o onboarding de 3 telas → "Pular" ou percorrer até "Entendi".
2. Testar pausar/retomar um sono com o app em segundo plano no meio (trocar de app e voltar) — o estado
   de pausa deve estar certo ao voltar.
3. Testar os atalhos configuráveis: abrir Configurações, esconder "Banho", tocar em Hoje → não deve mais
   aparecer; reabrir Configurações e marcar de novo.
4. Tocar num arco do relógio de sono com o dedo (não com mouse) — confirmar que abre o registro certo
   mesmo num alvo pequeno; se for difícil de acertar, é um ponto para revisar a área de toque depois.
5. Testar o fluxo de colisão de sono nos dois aparelhos ao mesmo tempo (um cria um sono enquanto o outro
   edita um horário que colide) — não deve haver perda de dado, só o aviso de colisão.

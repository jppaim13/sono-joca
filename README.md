# Sono do Joaquim

App pessoal para registrar sono e mamadas do bebê, compartilhado entre os pais.
Flask + PostgreSQL, hospedado no Render, instalável no celular (PWA).

## Estrutura

```
app/            backend Flask (API, modelos, comandos)
static/         app do celular (index.html, PWA, ícones)
migrations/     versões do banco (Flask-Migrate)
render.yaml     Blueprint do Render (banco + serviço web)
```

## Rodar no computador

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export FLASK_APP=app                                  # Windows: set FLASK_APP=app
flask db upgrade
flask create-user
flask run
```

Abra http://127.0.0.1:5000

## Deploy no Render

1. Suba este repositório (privado) no GitHub.
2. Render → New → Blueprint → conecte o GitHub e escolha o repositório → Apply.
3. Depois do primeiro deploy, no serviço `sono-joaquim` → Shell:
   `flask create-user` (uma vez para cada pessoa).
4. Abra a URL `https://sono-joaquim-xxxx.onrender.com` no celular e adicione à tela inicial.

Cada `git push` na branch `main` publica uma nova versão. As mudanças no banco
rodam sozinhas antes de cada deploy (`flask db upgrade`).

## Alterar o banco

Depois de mudar `app/models.py`:

```bash
flask db migrate -m "descrição da mudança"
flask db upgrade
git add migrations && git commit -m "..." && git push
```

## Comandos úteis

- `flask create-user` cria usuário ou troca senha
- `flask list-users` lista usuários

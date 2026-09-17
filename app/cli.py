import click
from werkzeug.security import generate_password_hash

from .extensions import db
from .models import User


def register_cli(app):
    @app.cli.command("create-user")
    @click.option("--email", prompt="E-mail")
    @click.option("--name", prompt="Nome")
    @click.password_option("--password", prompt="Senha", confirmation_prompt="Repita a senha")
    def create_user(email, name, password):
        """Cria um usuário ou troca a senha de um existente."""
        email = email.strip().lower()
        if len(password) < 8:
            raise click.ClickException("Use uma senha com pelo menos 8 caracteres.")
        user = User.query.filter_by(email=email).first()
        if user:
            user.name = name.strip()
            user.password_hash = generate_password_hash(password)
            msg = "Usuário atualizado"
        else:
            db.session.add(User(email=email, name=name.strip(), password_hash=generate_password_hash(password)))
            msg = "Usuário criado"
        db.session.commit()
        click.echo(f"{msg}: {email}")

    @app.cli.command("list-users")
    def list_users():
        """Lista os usuários cadastrados."""
        for u in User.query.order_by(User.id).all():
            click.echo(f"{u.id}\t{u.email}\t{u.name}")

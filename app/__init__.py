import os
from datetime import timedelta

from flask import Flask, request, send_from_directory

from .extensions import db, migrate

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "sqlite:///dev.db")
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def create_app() -> Flask:
    app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
    on_render = bool(os.environ.get("RENDER"))

    secret = os.environ.get("SECRET_KEY")
    if not secret:
        if on_render:
            raise RuntimeError("SECRET_KEY não definida")
        secret = "dev-only-secret"

    app.config.update(
        SECRET_KEY=secret,
        SQLALCHEMY_DATABASE_URI=_database_url(),
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True, "pool_recycle": 280},
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=on_render,
        PERMANENT_SESSION_LIFETIME=timedelta(days=180),
        MAX_CONTENT_LENGTH=64 * 1024,
    )

    db.init_app(app)
    migrate.init_app(app, db)

    from . import models  # noqa: F401  (registra as tabelas)
    from .api import bp as api_bp
    from .cli import register_cli

    app.register_blueprint(api_bp)
    register_cli(app)

    @app.get("/")
    def index():
        return send_from_directory(STATIC_DIR, "index.html")

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.after_request
    def headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["X-Frame-Options"] = "DENY"
        if request.path in ("/", "/index.html", "/sw.js", "/manifest.webmanifest") or request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-cache"
        return resp

    return app

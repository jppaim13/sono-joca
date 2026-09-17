import re
import time
from functools import wraps

from flask import Blueprint, g, jsonify, request, session
from werkzeug.security import check_password_hash

from .extensions import db
from .models import Baby, Event, LiveState, User, now_ms

bp = Blueprint("api", __name__, url_prefix="/api")

TYPES = {"sleep", "feed"}
KINDS = {"peito-e", "peito-d", "mamadeira", "solido"}
ID_RE = re.compile(r"^[a-z0-9]{6,40}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DAY_MS = 24 * 3600 * 1000
HISTORY_DAYS = 60
_failed_logins: dict = {}


def err(msg, status=400):
    return jsonify(error=msg), status


@bp.before_request
def require_app_header():
    # Proteção contra CSRF: só o próprio app envia este cabeçalho.
    if request.method in ("POST", "PUT", "DELETE") and request.headers.get("X-Requested-With") != "sono":
        return err("forbidden", 403)


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        uid = session.get("uid")
        user = db.session.get(User, uid) if uid else None
        if not user:
            return err("auth", 401)
        g.user = user
        return fn(*args, **kwargs)
    return wrapper


def _int_or_none(v, lo=0, hi=None):
    if v is None or v == "":
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError
    v = int(v)
    if v < lo or (hi is not None and v > hi):
        raise ValueError
    return v


@bp.post("/login")
def login():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
    recent = [t for t in _failed_logins.get(ip, []) if t > time.time() - 900]
    if len(recent) >= 10:
        return err("Muitas tentativas. Aguarde 15 minutos.", 429)

    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, str(data.get("password", ""))):
        recent.append(time.time())
        _failed_logins[ip] = recent
        time.sleep(0.8)
        return err("E-mail ou senha incorretos.", 401)

    _failed_logins.pop(ip, None)
    session.clear()
    session.permanent = True
    session["uid"] = user.id
    return jsonify(ok=True, name=user.name)


@bp.post("/logout")
def logout():
    session.clear()
    return "", 204


@bp.get("/sync")
@login_required
def sync():
    try:
        since = int(request.args.get("since", 0) or 0)
    except ValueError:
        since = 0
    now = now_ms()
    events = (
        Event.query.filter(Event.updated_at > since, Event.start > now - HISTORY_DAYS * DAY_MS)
        .order_by(Event.start)
        .all()
    )
    baby = db.session.get(Baby, 1)
    live = db.session.get(LiveState, 1)
    return jsonify(
        now=now,
        me=g.user.id,
        users={str(u.id): u.name for u in User.query.all()},
        baby=baby.to_dict() if baby else None,
        live=live.to_dict() if live else {},
        events=[e.to_dict() for e in events],
    )


@bp.put("/events/<eid>")
@login_required
def put_event(eid):
    if not ID_RE.match(eid):
        return err("id inválido")
    d = request.get_json(silent=True) or {}
    try:
        etype = d.get("type")
        if etype not in TYPES:
            raise ValueError
        start = _int_or_none(d.get("start"), lo=1)
        end = _int_or_none(d.get("end"), lo=1)
        ml = _int_or_none(d.get("ml"), lo=0, hi=1000)
        if start is None or start > now_ms() + 10 * 60 * 1000:
            raise ValueError
        if end is not None and (end <= start or end - start > 16 * 3600 * 1000):
            raise ValueError
        if etype == "sleep" and end is None:
            raise ValueError
        kind = d.get("kind") if etype == "feed" else None
        if etype == "feed" and kind not in KINDS:
            raise ValueError
        note = str(d.get("note") or "").strip()[:200] or None
    except (ValueError, TypeError):
        return err("dados inválidos")

    ev = db.session.get(Event, eid)
    if ev is None:
        ev = Event(id=eid, by_user_id=g.user.id)
        db.session.add(ev)
    ev.type, ev.kind, ev.start, ev.end = etype, kind, start, end
    ev.ml = ml if kind == "mamadeira" else None
    ev.note, ev.deleted, ev.updated_at = note, False, now_ms()
    db.session.commit()
    return jsonify(ev.to_dict())


@bp.delete("/events/<eid>")
@login_required
def delete_event(eid):
    ev = db.session.get(Event, eid)
    if ev and not ev.deleted:
        ev.deleted = True
        ev.updated_at = now_ms()
        db.session.commit()
    return "", 204


@bp.put("/live")
@login_required
def put_live():
    d = request.get_json(silent=True) or {}
    try:
        values = {
            "sleep_start": _int_or_none(d.get("sleepStart"), lo=1),
            "sleep_by": _int_or_none(d.get("sleepBy")),
            "feed_start": _int_or_none(d.get("feedStart"), lo=1),
            "feed_by": _int_or_none(d.get("feedBy")),
        }
        kind = d.get("feedKind")
        if kind is not None and kind not in KINDS:
            raise ValueError
    except (ValueError, TypeError):
        return err("dados inválidos")
    live = db.session.get(LiveState, 1) or LiveState(id=1)
    for k, v in values.items():
        setattr(live, k, v)
    live.feed_kind = kind
    live.updated_at = now_ms()
    db.session.add(live)
    db.session.commit()
    return jsonify(live.to_dict())


@bp.put("/baby")
@login_required
def put_baby():
    d = request.get_json(silent=True) or {}
    name = str(d.get("name") or "").strip()[:40] or "Bebê"
    birth = str(d.get("birth") or "")
    if birth and not DATE_RE.match(birth):
        return err("data inválida")
    baby = db.session.get(Baby, 1) or Baby(id=1)
    baby.name, baby.birth, baby.updated_at = name, birth, now_ms()
    db.session.add(baby)
    db.session.commit()
    return jsonify(baby.to_dict())

import time

from .extensions import db


def now_ms() -> int:
    return int(time.time() * 1000)


class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(200), unique=True, nullable=False, index=True)
    name = db.Column(db.String(60), nullable=False)
    password_hash = db.Column(db.String(300), nullable=False)
    created_at = db.Column(db.BigInteger, nullable=False, default=now_ms)


class Baby(db.Model):
    __tablename__ = "baby"
    id = db.Column(db.Integer, primary_key=True)  # sempre 1
    name = db.Column(db.String(40), nullable=False, default="Joaquim")
    birth = db.Column(db.String(10), nullable=False, default="")  # AAAA-MM-DD
    updated_at = db.Column(db.BigInteger, nullable=False, default=now_ms)

    def to_dict(self):
        return {"name": self.name, "birth": self.birth}


class Event(db.Model):
    """Sono ou mamada. Horários em milissegundos desde 1970 (UTC)."""
    __tablename__ = "events"
    id = db.Column(db.String(40), primary_key=True)  # gerado no celular
    type = db.Column(db.String(10), nullable=False)  # sleep | feed
    kind = db.Column(db.String(12))  # peito-e | peito-d | mamadeira | solido
    start = db.Column(db.BigInteger, nullable=False, index=True)
    end = db.Column(db.BigInteger)
    ml = db.Column(db.Integer)
    note = db.Column(db.String(200))
    by_user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    deleted = db.Column(db.Boolean, nullable=False, default=False)
    updated_at = db.Column(db.BigInteger, nullable=False, default=now_ms, index=True)

    def to_dict(self):
        d = {"id": self.id, "type": self.type, "start": self.start, "by": self.by_user_id}
        for k in ("kind", "end", "ml", "note"):
            v = getattr(self, k)
            if v is not None:
                d[k] = v
        if self.deleted:
            d["deleted"] = True
        return d


class LiveState(db.Model):
    """Cronômetros em andamento, compartilhados entre os celulares."""
    __tablename__ = "live_state"
    id = db.Column(db.Integer, primary_key=True)  # sempre 1
    sleep_start = db.Column(db.BigInteger)
    sleep_by = db.Column(db.Integer)
    feed_start = db.Column(db.BigInteger)
    feed_kind = db.Column(db.String(12))
    feed_by = db.Column(db.Integer)
    updated_at = db.Column(db.BigInteger, nullable=False, default=now_ms)

    def to_dict(self):
        return {
            "sleepStart": self.sleep_start, "sleepBy": self.sleep_by,
            "feedStart": self.feed_start, "feedKind": self.feed_kind, "feedBy": self.feed_by,
        }

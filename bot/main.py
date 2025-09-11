# bot/main.py
import os
import hmac
import hashlib
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy import text

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

# =========================
# ENV – senin deðerlerine göre
# =========================
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]  # 8383... (DO'da Secret)
DATABASE_URL       = os.environ.get("DATABASE_URL")    # psycopg URI (tek satýr)
SECRET             = os.environ.get("SECRET", "")      # 288e7f80d1204fea9bdc2749450bc4bc
PUBLIC_GAME_URL    = os.environ.get("PUBLIC_GAME_URL", "https://okapi-miniapp-7ex5j.ondigitalocean.app/")
GAME_SHORT_NAME    = os.environ.get("GAME_SHORT_NAME", "kapi_run")
WEBHOOK_PATH       = os.environ.get("WEBHOOK_PATH", "/tg/webhook")  # /tg/webhook

# =========================
# FASTAPI APP & STATIC
# =========================
app = FastAPI(title="KAPI RUN - Bot & API")

# Statikler (varsa mount et)
if os.path.isdir("images"):
    app.mount("/images", StaticFiles(directory="images"), name="images")
if os.path.isdir("scripts"):
    app.mount("/scripts", StaticFiles(directory="scripts"), name="scripts")
if os.path.isdir("media"):
    app.mount("/media", StaticFiles(directory="media"), name="media")
if os.path.isdir("icons"):
    app.mount("/icons", StaticFiles(directory="icons"), name="icons")

@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"ok": True}

@app.get("/__routes")
async def list_routes():
    return [{"path": r.path, "methods": list(getattr(r, "methods", []))} for r in app.routes]

@app.get("/")
async def serve_index():
    index_path = os.path.join(os.getcwd(), "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path, media_type="text/html")
    return JSONResponse({"ok": True, "hint": "index.html bulunamadý"}, status_code=200)

# =========================
# DATABASE (async)
# =========================
engine: Optional[AsyncEngine] = None

async def ensure_schema() -> None:
    """scores tablosunu oluþtur + index."""
    assert engine is not None
    async with engine.begin() as conn:
        await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS scores (
            user_id    BIGINT PRIMARY KEY,
            username   TEXT,
            best_score INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """))
        await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_scores_best ON scores (best_score DESC);
        """))

# =========================
# TELEGRAM (PTB v21, async)
# =========================
telegram_app: Application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

def _fmt_user(u: Optional[str], uid: int) -> str:
    u = (u or "").strip()
    if not u:
        return f"user_{uid}"
    return u[1:] if u.startswith("@") else u

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """ /start › Oyunu Baþlat butonu """
    kb = [[InlineKeyboardButton("Oyunu Baþlat", url=PUBLIC_GAME_URL)]]
    await update.message.reply_text(
        "KAPI RUN’a hoþ geldin! ??\nButona bas ve oyna. Skorlarýn otomatik kaydedilecek.",
        reply_markup=InlineKeyboardMarkup(kb)
    )

async def cmd_top(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """ /top › En iyi 200 skor """
    if engine is None:
        await update.message.reply_text("Leaderboard þu an kullanýlamýyor (DB yok).")
        return
    async with engine.connect() as conn:
        res = await conn.execute(text("""
            SELECT user_id, username, best_score
            FROM scores
            ORDER BY best_score DESC, updated_at ASC
            LIMIT 200
        """))
        rows = list(res)
    if not rows:
        await update.message.reply_text("Henüz skor yok. Ýlk skor senin olsun! ??")
        return
    lines = []
    for i, r in enumerate(rows, 1):
        uname = _fmt_user(r._mapping["username"], r._mapping["user_id"])
        score = r._mapping["best_score"]
        lines.append(f"{i}. @{uname} — {score}")
        if len("\n".join(lines)) > 3500:
            lines.append("…")
            break
    await update.message.reply_text("?? TOP SKORLAR\n" + "\n".join(lines))

telegram_app.add_handler(CommandHandler("start", cmd_start))
telegram_app.add_handler(CommandHandler("top",   cmd_top))

# =========================
# WEBHOOK (Telegram › FastAPI)
# =========================
@app.post(WEBHOOK_PATH)
async def telegram_webhook(request: Request):
    """Telegram webhook giriþ noktasý."""
    data = await request.json()
    update = Update.de_json(data, telegram_app.bot)
    await telegram_app.process_update(update)
    return {"ok": True}

# =========================
# SCORE API
# =========================
def _hmac_ok(user_id: int, score: int, sig: str) -> bool:
    """
    Basit HMAC doðrulama:
      client_signature = HMAC_SHA256( f"{user_id}:{score}".encode(), SECRET.encode() ).hexdigest()
    """
    if not SECRET:
        return False
    msg = f"{user_id}:{score}".encode("utf-8")
    expected = hmac.new(SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)

@app.post("/api/score")
async def post_score(payload: Dict[str, Any]):
    """
    JSON:
      { "user_id": 123, "username": "akif", "score": 456, "sig": "<hmac-hex>" }
    """
    for k in ("user_id", "username", "score", "sig"):
        if k not in payload:
            raise HTTPException(status_code=400, detail=f"missing field: {k}")

    user_id  = int(payload["user_id"])
    username = _fmt_user(str(payload["username"] or ""), user_id)
    score    = int(payload["score"])
    sig      = str(payload["sig"])

    if not _hmac_ok(user_id, score, sig):
        raise HTTPException(status_code=401, detail="invalid signature")

    if engine is None:
        raise HTTPException(status_code=500, detail="database not configured")

    async with engine.begin() as conn:
        await conn.execute(text("""
            INSERT INTO scores (user_id, username, best_score)
            VALUES (:uid, :uname, :s)
            ON CONFLICT (user_id) DO UPDATE
            SET username   = EXCLUDED.username,
                best_score = GREATEST(scores.best_score, EXCLUDED.best_score),
                updated_at = now();
        """), {"uid": user_id, "uname": username, "s": score})

    return {"ok": True, "saved": True}

@app.get("/api/leaderboard")
async def leaderboard(limit: int = 200):
    """Top N skor (varsayýlan 200)"""
    if engine is None:
        raise HTTPException(status_code=500, detail="database not configured")
    limit = max(1, min(200, int(limit)))
    async with engine.connect() as conn:
        res = await conn.execute(text("""
            SELECT user_id, username, best_score, updated_at
            FROM scores
            ORDER BY best_score DESC, updated_at ASC
            LIMIT :lim
        """), {"lim": limit})
        rows = [dict(r._mapping) for r in res]
    return rows

# =========================
# LIFECYCLE – startup/shutdown
# =========================
@app.on_event("startup")
async def on_startup():
    # Telegram app init
    await telegram_app.initialize()
    # DB baðlan
    global engine
    if DATABASE_URL:
        engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
        await ensure_schema()
    else:
        print("WARNING: DATABASE_URL not set; leaderboard/score API çalýþmayacak.")

@app.on_event("shutdown")
async def on_shutdown():
    await telegram_app.shutdown()
    if engine is not None:
        await engine.dispose()

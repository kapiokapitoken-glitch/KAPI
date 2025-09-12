# bot/main.py
import os
import sys
import json
import hmac
import hashlib
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request, HTTPException, status
from fastapi.responses import JSONResponse, FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware   # <--- cache middleware için

from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy import text

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

# =========================
# ENV
# =========================
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
SECRET = (os.environ.get("SECRET") or "").strip()
PUBLIC_GAME_URL = (os.environ.get("PUBLIC_GAME_URL") or "/").strip()
GAME_SHORT_NAME = (os.environ.get("GAME_SHORT_NAME") or "kapi_run").strip()

WEBHOOK_PATH = (os.environ.get("WEBHOOK_PATH") or "/tg/webhook").strip()
if not WEBHOOK_PATH.startswith("/"):
    WEBHOOK_PATH = "/" + WEBHOOK_PATH  # normalize

# =========================
# FASTAPI
# =========================
app = FastAPI(title="KAPI RUN - Bot & API")

# ---- Cache disable middleware ----
class NoStoreForStatic(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        p = request.url.path or ""
        if p.startswith(("/images", "/scripts", "/media", "/icons")) or p in (
            "/style.css", "/data.json", "/appmanifest.json", "/sw.js", "/offline.json", "/index.html"
        ):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoStoreForStatic)

# Mount static dirs if present
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
    return JSONResponse({"ok": True, "hint": "index.html not found"}, status_code=200)

# =========================
# DATABASE
# =========================
engine: Optional[AsyncEngine] = None

async def ensure_schema() -> None:
    assert engine is not None
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS scores (
                user_id BIGINT PRIMARY KEY
            );
        """))
        await conn.execute(text("""
            ALTER TABLE scores
              ADD COLUMN IF NOT EXISTS username   TEXT,
              ADD COLUMN IF NOT EXISTS best_score INTEGER NOT NULL DEFAULT 0,
              ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_scores_best ON scores (best_score DESC);
        """))

# =========================
# TELEGRAM
# =========================
telegram_app: Application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

def _fmt_user(u: Optional[str], uid: int) -> str:
    u = (u or "").strip()
    if not u:
        return f"user_{uid}"
    return u[1:] if u.startswith("@") else u

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message or update.effective_message
    if not msg:
        return
    kb = [[InlineKeyboardButton("Play the Game", url=PUBLIC_GAME_URL)]]
    await msg.reply_text("Welcome to KAPI RUN!", reply_markup=InlineKeyboardMarkup(kb))

async def cmd_top(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message or update.effective_message
    if not msg:
        return
    if engine is None:
        await msg.reply_text("Leaderboard is not available (DB not configured).")
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
        await msg.reply_text("No scores yet.")
        return
    lines = []
    for i, r in enumerate(rows, 1):
        uname = _fmt_user(r._mapping["username"], r._mapping["user_id"])
        score = r._mapping["best_score"]
        lines.append(f"{i}. @{uname} - {score}")
        if len("\n".join(lines)) > 3500:
            lines.append("...")
            break
    await msg.reply_text("TOP SCORES\n" + "\n".join(lines))

telegram_app.add_handler(CommandHandler("start", cmd_start))
telegram_app.add_handler(CommandHandler("top", cmd_top))

# =========================
# WEBHOOK
# =========================
@app.api_route(WEBHOOK_PATH, methods=["GET", "POST"])
async def telegram_webhook(request: Request):
    if request.method == "GET":
        return PlainTextResponse("OK", status_code=status.HTTP_200_OK)
    try:
        data = await request.json()
    except Exception:
        body = await request.body()
        print("WEBHOOK parse error:", body[:500], file=sys.stderr)
        return JSONResponse({"ok": False, "error": "invalid json"}, status_code=400)
    print("WEBHOOK update:", json.dumps(data)[:500], file=sys.stderr)
    update = Update.de_json(data, telegram_app.bot)
    await telegram_app.process_update(update)
    return {"ok": True}

# =========================
# SCORE API
# =========================
def _hmac_ok(user_id: int, score: int, sig: str) -> bool:
    if not SECRET:
        return False
    msg = f"{user_id}:{score}".encode("utf-8")
    expected = hmac.new(SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)

@app.post("/api/score")
async def post_score(payload: Dict[str, Any]):
    for k in ("user_id", "username", "score", "sig"):
        if k not in payload:
            raise HTTPException(status_code=400, detail=f"missing field: {k}")
    user_id = int(payload["user_id"])
    username = _fmt_user(str(payload["username"] or ""), user_id)
    score = int(payload["score"])
    sig = str(payload["sig"])
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
# LIFECYCLE
# =========================
@app.on_event("startup")
async def on_startup():
    await telegram_app.initialize()
    global engine
    if DATABASE_URL:
        engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
        await ensure_schema()
    else:
        print("WARNING: DATABASE_URL not set.")

@app.on_event("shutdown")
async def on_shutdown():
    await telegram_app.shutdown()
    if engine is not None:
        await engine.dispose()

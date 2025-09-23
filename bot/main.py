# bot/main.py
import os
import sys
import json
import hmac
import hashlib
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, parse_qsl, unquote_plus

from fastapi import FastAPI, Request, HTTPException, status, Header
from fastapi.responses import JSONResponse, FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy import text

from telegram import Update, MenuButtonWebApp, WebAppInfo
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters

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
    WEBHOOK_PATH = "/" + WEBHOOK_PATH

ADMIN_OWNER_ID = int(os.environ.get("ADMIN_OWNER_ID", "1375167714"))
SECRET_ADMIN = (os.environ.get("SECRET_ADMIN") or "").strip()

# =========================
# FASTAPI
# =========================
app = FastAPI(title="KAPI RUN - Bot & API")

# Disable cache for static files served via FastAPI endpoints
class NoStoreForStatic(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        p = request.url.path or ""
        if p.startswith(("/images", "/scripts", "/media", "/icons")) or p in (
            "/style.css", "/data.json", "/appmanifest.json", "/manifest.json",
            "/sw.js", "/offline.json", "/index.html"
        ):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoStoreForStatic)

# Static mounts (for folders)
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

# ---------- helpers to locate root files (cwd or repo root) ----------
def _first_existing(filename: str, fallback: bool = True):
    p1 = os.path.join(os.getcwd(), filename)
    if os.path.isfile(p1):
        return p1
    if fallback:
        base = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        p2 = os.path.join(base, filename)
        if os.path.isfile(p2):
            return p2
    return None

# ---------- root-level file endpoints (needed for proper styling & cache bust) ----------
@app.get("/style.css")
async def serve_style_css():
    p = _first_existing("style.css")
    if p:
        return FileResponse(p, media_type="text/css")
    raise HTTPException(status_code=404, detail="style.css not found")

@app.get("/data.json")
async def serve_data_json():
    p = _first_existing("data.json")
    if not p:
        raise HTTPException(status_code=404, detail="data.json not found")
    return FileResponse(
        p,
        media_type="application/json",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )

@app.get("/appmanifest.json")
async def serve_appmanifest_json():
    p = _first_existing("appmanifest.json")
    if p:
        return FileResponse(p, media_type="application/manifest+json")
    raise HTTPException(status_code=404, detail="appmanifest.json not found")

@app.get("/manifest.json")
async def serve_manifest_json():
    p = _first_existing("manifest.json")
    if p:
        return FileResponse(p, media_type="application/manifest+json")
    raise HTTPException(status_code=404, detail="manifest.json not found")

@app.get("/sw.js")
async def serve_service_worker():
    p = _first_existing("sw.js")
    if p:
        return FileResponse(p, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="sw.js not found")

@app.get("/offline.json")
async def serve_offline_json():
    p = _first_existing("offline.json")
    if not p:
        raise HTTPException(status_code=404, detail="offline.json not found")
    return FileResponse(
        p,
        media_type="application/json",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )

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

def _is_owner(update: Update) -> bool:
    u = update.effective_user
    return bool(u and u.id == ADMIN_OWNER_ID)

# ---------- User-visible texts ----------
START_TEXT = (
    "**🧣 Welcome OKAPI!**\n\n"
    "**Kapi is ready to run. Are you ready to guide him?**\n"
    "**Tap the KAPI RUN button below to begin your adventure.**\n"
    "**Type /top to see who’s leading the herd.**\n"
    "**Use /info for tips and secrets.**"
)

INFO_TEXT = (
    "🎮 Detailed Gameplay Guide\n\n"
    "Welcome to the OKAPI TOKEN world! Our hero Kapi keeps running on a path full of obstacles. "
    "Your goal is to overcome obstacles with Kapi and achieve the highest score.\n\n"
    "1) Start\n"
    "• Tap the *KAPI RUN* label in the chat menu to open the game.\n"
    "• Kapi starts running automatically; you try to overcome obstacles with him.\n\n"
    "2) Obstacles & Hazards\n"
    "• Scary hazards appear: zombies, creatures, and flying birds.\n"
    "• Stay away from rocks, pits, or broken ground.\n"
    "• Any collision ends the run.\n\n"
    "3) Controls (Jumping)\n"
    "• Tap the screen → Kapi jumps.\n"
    "• Timing is critical: too early or too late means you won’t avoid the obstacle.\n"
    "• When Kapi gets scared, he may jump twice — this effect is temporary and unpredictable.\n\n"
    "4) Collectibles\n"
    "• Red scarves appear on the path. Collect them to increase your score.\n\n"
    "5) Scoring & Difficulty\n"
    "• Your score increases by the distance you run and the total number of red scarves.\n"
    "• The longer you survive, the faster and harder it gets.\n\n"
    "6) Kapi’s Role\n"
    "• Kapi is the hero you control. He runs, avoids obstacles, and may perform extra jumps when scared.\n"
    "• Keeping him safe is up to you!\n\n"
    "7) Leaderboard\n"
    "• Your best score is saved automatically.\n"
    "• Use /top to see the highest-scoring players.\n\n"
    "8) Tips\n"
    "• Stay calm; avoid unnecessary jumps.\n"
    "• Jump timing is the most critical skill.\n"
    "• Push for long runs, collect red scarves, and aim for the top! 🧣❤️"
)

# ---------- Commands ----------
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message or update.effective_message
    if not msg:
        return

    # Blue menu button (bottom bar)
    try:
        await context.bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(
                text="KAPI RUN",
                web_app=WebAppInfo(url=PUBLIC_GAME_URL)
            )
        )
    except Exception as e:
        print("set_chat_menu_button error:", e, file=sys.stderr)

    await msg.reply_text(START_TEXT, parse_mode="Markdown")

async def cmd_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message or update.effective_message
    if msg:
        await msg.reply_text(INFO_TEXT, parse_mode="Markdown")

async def cmd_top(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message or update.effective_message
    if not msg:
        return
    if engine is None:
        await msg.reply_text("Leaderboard is not available (database not configured).")
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
    await msg.reply_text("🏆 Global Leaderboard\n" + "\n".join(lines))

telegram_app.add_handler(CommandHandler("start", cmd_start))
telegram_app.add_handler(CommandHandler("info",  cmd_info))
telegram_app.add_handler(CommandHandler("top",   cmd_top))

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
    update = Update.de_json(data, telegram_app.bot)
    await telegram_app.process_update(update)
    return {"ok": True}

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

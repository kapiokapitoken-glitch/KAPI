# bot/main.py
import os
import sys
import json
import hmac
import hashlib
import time
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, parse_qsl, unquote_plus

from fastapi import FastAPI, Request, HTTPException, status, Header
from fastapi.responses import JSONResponse, FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy import text

from telegram import (
    Update,
    MenuButtonWebApp,
    WebAppInfo,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    CallbackGame,          # 👈 eklendi
)
from telegram.ext import Application, CommandHandler, ContextTypes

# =========================
# ENV
# =========================
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
SECRET = (os.environ.get("SECRET") or "").strip()
PUBLIC_GAME_URL = (os.environ.get("PUBLIC_GAME_URL") or "/").strip()   # menü butonu için
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

class NoStoreForStatic(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        p = request.url.path or ""
        if p.startswith(("/images", "/scripts", "/media", "/icons")) or p in (
            "/style.css", "/data.json", "/appmanifest.json", "/manifest.json",
            "/sw.js", "/offline.json", "/index.html", "/webapp-check.html"
        ):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoStoreForStatic)

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

@app.get("/")
async def serve_index():
    p = _first_existing("index.html")
    if p:
        return FileResponse(p, media_type="text/html")
    return JSONResponse({"ok": True, "hint": "index.html not found"}, status_code=200)

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

@app.get("/webapp-check.html")
async def serve_webapp_check_html():
    p = _first_existing("webapp-check.html")
    if p:
        return FileResponse(p, media_type="text/html")
    raise HTTPException(status_code=404, detail="webapp-check.html not found")

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
    "🧣 *Welcome, OKAPI!*\n\n"
    "Kapi is ready to run. Are you ready to guide it?\n"
    "Tap the *PLAY* button below to start your adventure.\n"
    "Type /top to see the leaderboard.\n"
    "Use /info for tips and secrets."
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

    chat = update.effective_chat
    is_group = bool(chat and chat.type in ("group", "supergroup"))

    # Özel sohbette alt menüye miniapp butonu (kullanıcı talebiyle korunuyor)
    if not is_group:
        try:
            await context.bot.set_chat_menu_button(
                chat_id=chat.id,
                menu_button=MenuButtonWebApp(
                    text="KAPI RUN",
                    web_app=WebAppInfo(url=PUBLIC_GAME_URL)
                )
            )
        except Exception as e:
            print("set_chat_menu_button error:", e, file=sys.stderr)

    # 👇 OYUNU HER YERDE TELEGRAM İÇİNDE AÇ: send_game + callback_game
    try:
        await context.bot.send_game(
            chat_id=chat.id,
            game_short_name=GAME_SHORT_NAME,
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("▶️ PLAY", callback_game=CallbackGame())]
            ]),
        )
        # Bilgilendirici metni ayrıca gönder
        await msg.reply_text(START_TEXT, parse_mode="Markdown", disable_web_page_preview=True)
    except Exception as e:
        # Çok nadir fallback: deep-link (yine Telegram içinde açar)
        print("send_game failed, fallback to deep-link:", e, file=sys.stderr)
        bot_username = context.bot.username
        deep_link = f"https://t.me/{bot_username}?game={GAME_SHORT_NAME}"
        kb = InlineKeyboardMarkup([[InlineKeyboardButton("▶️ PLAY", url=deep_link)]])
        await msg.reply_text(START_TEXT, parse_mode="Markdown", reply_markup=kb, disable_web_page_preview=True)

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

# ----- ADMIN COMMANDS (Telegram) -----
async def cmd_whoami(update: Update, context: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    is_owner = "YES" if _is_owner(update) else "NO"
    await (update.message or update.effective_message).reply_text(
        f"user_id={u.id if u else 'unknown'} username=@{(u.username or '') if u else ''} owner={is_owner}"
    )

async def cmd_admin_test(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_owner(update):
        await (update.message or update.effective_message).reply_text("forbidden")
        return
    tok = " ".join(context.args).strip() if context.args else ""
    ok = bool(tok and SECRET_ADMIN and tok == SECRET_ADMIN)
    await (update.message or update.effective_message).reply_text(
        f"token_ok={str(ok).lower()}"
    )

async def cmd_admin_reset_user(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_owner(update):
        await (update.message or update.effective_message).reply_text("forbidden")
        return
    if engine is None:
        await (update.message or update.effective_message).reply_text("db not configured")
        return
    if not context.args or len(context.args) < 2:
        await (update.message or update.effective_message).reply_text("usage: /admin_reset_user <token> <user_id>")
        return
    tok = context.args[0].strip()
    if not (SECRET_ADMIN and tok == SECRET_ADMIN):
        await (update.message or update.effective_message).reply_text("token invalid")
        return
    try:
        uid = int(context.args[1])
    except Exception:
        await (update.message or update.effective_message).reply_text("invalid user_id")
        return
    async with engine.begin() as conn:
        res = await conn.execute(
            text("UPDATE scores SET best_score=0, updated_at=now() WHERE user_id=:uid"),
            {"uid": uid}
        )
        changed = res.rowcount or 0
    await (update.message or update.effective_message).reply_text(f"changed:{changed}")

async def cmd_admin_reset_all(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_owner(update):
        await (update.message or update.effective_message).reply_text("forbidden")
        return
    if engine is None:
        await (update.message or update.effective_message).reply_text("db not configured")
        return
    tok = " ".join(context.args).strip() if context.args else ""
    if not (SECRET_ADMIN and tok == SECRET_ADMIN):
        await (update.message or update.effective_message).reply_text("token invalid")
        return
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE scores SET best_score=0, updated_at=now()"))
    await (update.message or update.effective_message).reply_text("ok:true reset_all")

telegram_app.add_handler(CommandHandler("start",            cmd_start))
telegram_app.add_handler(CommandHandler("info",             cmd_info))
telegram_app.add_handler(CommandHandler("top",              cmd_top))
telegram_app.add_handler(CommandHandler("whoami",           cmd_whoami))
telegram_app.add_handler(CommandHandler("admin_test",       cmd_admin_test))
telegram_app.add_handler(CommandHandler("admin_reset_user", cmd_admin_reset_user))
telegram_app.add_handler(CommandHandler("admin_reset_all",  cmd_admin_reset_all))

# =========================
# SCORE SIGNATURE HELPERS
# =========================
def _hmac_ok(user_id: int, score: int, sig: str) -> bool:
    if not SECRET:
        return False
    msg = f"{user_id}:{score}".encode("utf-8")
    expected = hmac.new(SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)

def _check_webapp_initdata(init_data: str, bot_token: str) -> bool:
    if not init_data or not bot_token:
        return False
    try:
        parsed = parse_qsl(init_data, keep_blank_values=True, strict_parsing=False, encoding="utf-8")
        hash_val: Optional[str] = None
        pairs = []
        for k, v in parsed:
            k = unquote_plus(k); v = unquote_plus(v)
            if k == "hash":
                hash_val = v
            else:
                pairs.append((k, v))
        if not hash_val:
            return False
        pairs.sort(key=lambda kv: kv[0])
        data_check_string = "\n".join([f"{k}={v}" for (k, v) in pairs])
        secret = hmac.new(b"WebAppData", bot_token.strip().encode("utf-8"), hashlib.sha256).digest()
        calc = hmac.new(secret, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(calc.lower(), hash_val.lower())
    except Exception as e:
        print("initdata verify error:", e, file=sys.stderr)
        return False

# =========================
# SCORE API
# =========================
@app.post("/api/score")
async def post_score(
    request: Request,
    x_telegram_init_data: Optional[str] = Header(default=None)
):
    try:
        body = await request.json()
        if not isinstance(body, dict):
            body = {}
    except Exception:
        body = {}
    try:
        score_val = int(body.get("score", 0))
    except Exception:
        score_val = 0
    score_val = max(0, score_val)

    init_data = (x_telegram_init_data or body.get("init_data") or "").strip()
    user_id: Optional[int] = None
    username: Optional[str] = None

    if init_data and _check_webapp_initdata(init_data, TELEGRAM_BOT_TOKEN):
        params = parse_qs(init_data, keep_blank_values=True)
        user_json = params.get("user", [None])[0]
        if user_json:
            try:
                u = json.loads(user_json)
                user_id = int(u.get("id"))
                username = _fmt_user(u.get("username") or "", user_id)
            except Exception:
                pass
    else:
        if all(k in body for k in ("user_id", "score", "sig")):
            try:
                uid = int(body.get("user_id"))
                sig = str(body.get("sig") or "")
                if _hmac_ok(uid, score_val, sig):
                    user_id = uid
                    username = _fmt_user(str(body.get("username") or ""), user_id)
            except Exception:
                pass

    if user_id is None:
        raise HTTPException(status_code=401, detail="invalid signature")

    if engine is None:
        raise HTTPException(status_code=500, detail="database not configured")

    async with engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO scores (user_id, username, best_score)
                VALUES (:uid, :uname, :s)
                ON CONFLICT (user_id) DO UPDATE
                SET username   = EXCLUDED.username,
                    best_score = GREATEST(scores.best_score, EXCLUDED.best_score),
                    updated_at = now();
            """),
            {"uid": user_id, "uname": username, "s": score_val}
        )

    return {"ok": True, "saved": True, "user_id": user_id, "username": username, "score": score_val}

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
# ADMIN API (HTTP)
# =========================
def _check_admin_header(request: Request) -> bool:
    tok = request.headers.get("X-Admin-Token", "") if hasattr(request, "headers") else ""
    return bool(SECRET_ADMIN and tok and tok == SECRET_ADMIN)

@app.post("/api/admin/reset_user")
async def api_reset_user(payload: Dict[str, Any], request: Request):
    if not _check_admin_header(request):
        raise HTTPException(status_code=403, detail="forbidden")
    if engine is None:
        raise HTTPException(status_code=500, detail="database not configured")
    try:
        uid = int(payload.get("user_id"))
    except Exception:
        raise HTTPException(status_code=400, detail="invalid user_id")
    async with engine.begin() as conn:
        res = await conn.execute(
            text("UPDATE scores SET best_score=0, updated_at=now() WHERE user_id=:uid"),
            {"uid": uid}
        )
        changed = res.rowcount or 0
    return {"ok": True, "changed": changed}

@app.post("/api/admin/reset_all")
async def api_reset_all(request: Request):
    if not _check_admin_header(request):
        raise HTTPException(status_code=403, detail="forbidden")
    if engine is None:
        raise HTTPException(status_code=500, detail="database not configured")
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE scores SET best_score=0, updated_at=now()"))
    return {"ok": True, "reset_all": True}

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

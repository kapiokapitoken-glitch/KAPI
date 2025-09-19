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

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

# =========================
# ENV
# =========================
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]  # zorunlu
DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
SECRET = (os.environ.get("SECRET") or "").strip()  # eski client HMAC fallback (opsiyonel)
PUBLIC_GAME_URL = (os.environ.get("PUBLIC_GAME_URL") or "/").strip()
GAME_SHORT_NAME = (os.environ.get("GAME_SHORT_NAME") or "kapi_run").strip()

WEBHOOK_PATH = (os.environ.get("WEBHOOK_PATH") or "/tg/webhook").strip()
if not WEBHOOK_PATH.startswith("/"):
    WEBHOOK_PATH = "/" + WEBHOOK_PATH  # normalize

# Admin env'leri:
ADMIN_OWNER_ID = int(os.environ.get("ADMIN_OWNER_ID", "1375167714"))  # bot sahibi (sen)
SECRET_ADMIN = (os.environ.get("SECRET_ADMIN") or "").strip()         # örn: 401208Ak.

# =========================
# FASTAPI
# =========================
app = FastAPI(title="KAPI RUN - Bot & API")

# ---- Static için cache kapatma ----
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

# Statik klasörleri mount et
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

# ---------- Root-level game files ----------
def _first_existing(filename: str, fallback: bool = True):
    # 1) CWD
    p1 = os.path.join(os.getcwd(), filename)
    if os.path.isfile(p1):
        return p1
    # 2) bot/.. (repo root)
    if fallback:
        base = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        p2 = os.path.join(base, filename)
        if os.path.isfile(p2):
            return p2
    return None

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

# Self-test sayfası (iki alias)
@app.get("/webapp-check.html")
async def serve_webapp_check_html():
    p = _first_existing("webapp-check.html")
    if p:
        return FileResponse(p, media_type="text/html")
    raise HTTPException(status_code=404, detail="webapp-check.html not found")

@app.get("/scripts/webapp-check.html")
async def serve_webapp_check_html_alias():
    return await serve_webapp_check_html()

# Debug helper
@app.get("/debug/ls")
async def debug_ls():
    root = os.getcwd()
    try:
        items = sorted(os.listdir(root))
    except Exception as e:
        items = [f"<ls error: {e}>"]
    return {"cwd": root, "files": items}

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

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message or update.effective_message
    if not msg:
        return
    # Cache-bust
    v = str(int(time.time()))
    sep = "&" if "?" in PUBLIC_GAME_URL else "?"
    url = f"{PUBLIC_GAME_URL}{sep}v={v}"
    kb = [[InlineKeyboardButton("Play the Game", url=url)]]
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

# ---- Admin debug & komutları ----
async def cmd_whoami(update: Update, context: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    await (update.effective_message or update.message).reply_text(
        f"uid={u.id} username=@{(u.username or '-')}, owner={'YES' if _is_owner(update) else 'NO'}"
    )

async def cmd_admin_test(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message or update.message
    if not _is_owner(update):
        return await msg.reply_text("forbidden")
    tok = (context.args[0].strip() if context.args else "")
    await msg.reply_text(f"token_ok={tok == SECRET_ADMIN}")

async def cmd_admin_reset_user(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message or update.message
    if not _is_owner(update):
        return await msg.reply_text("forbidden")

    # /admin_reset_user <token> <user_id|@username>
    args = context.args or []
    if len(args) < 2:
        return await msg.reply_text("usage: /admin_reset_user <token> <user_id|@username>")

    token = args[0].strip()
    if token != SECRET_ADMIN:
        return await msg.reply_text("bad token")

    target = args[1].strip()
    uid = None
    if target.startswith("@"):
        if engine is None:
            return await msg.reply_text("db not configured")
        async with engine.connect() as conn:
            res = await conn.execute(text("SELECT user_id FROM scores WHERE username = :u"), {"u": target[1:]})
            row = res.first()
            if row:
                uid = int(row[0])
        if uid is None:
            return await msg.reply_text("username not found")
    else:
        try:
            uid = int(target)
        except Exception:
            return await msg.reply_text("invalid user_id")

    if engine is None:
        return await msg.reply_text("db not configured")

    async with engine.begin() as conn:
        res = await conn.execute(
            text("UPDATE scores SET best_score = 0, updated_at = now() WHERE user_id = :uid"),
            {"uid": uid}
        )
        changed = res.rowcount or 0

    await msg.reply_text(f"ok changed={changed}")

async def cmd_admin_reset_all(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message or update.message
    if not _is_owner(update):
        return await msg.reply_text("forbidden")

    # /admin_reset_all <token>
    args = context.args or []
    token = (args[0].strip() if args else "")
    if token != SECRET_ADMIN:
        return await msg.reply_text("bad token")

    context.user_data["__awaiting_reset_all"] = True
    return await msg.reply_text("Type YES to confirm reset all")

async def _confirm_reset_all(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # owner "YES" derse tümünü sıfırla
    msg = update.effective_message or update.message
    if not _is_owner(update):
        return
    if not context.user_data.get("__awaiting_reset_all"):
        return
    if (msg.text or "").strip().upper() != "YES":
        context.user_data["__awaiting_reset_all"] = False
        return await msg.reply_text("cancelled")

    context.user_data["__awaiting_reset_all"] = False
    if engine is None:
        return await msg.reply_text("db not configured")

    async with engine.begin() as conn:
        await conn.execute(text("UPDATE scores SET best_score = 0, updated_at = now()"))

    await msg.reply_text("all reset")

# Handler kayıtları
telegram_app.add_handler(CommandHandler("start",            cmd_start))
telegram_app.add_handler(CommandHandler("top",              cmd_top))
telegram_app.add_handler(CommandHandler("whoami",           cmd_whoami))
telegram_app.add_handler(CommandHandler("admin_test",       cmd_admin_test))
telegram_app.add_handler(CommandHandler("admin_reset_user", cmd_admin_reset_user))
telegram_app.add_handler(CommandHandler("admin_reset_all",  cmd_admin_reset_all))
telegram_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, _confirm_reset_all))

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
    # Log kısalt
    try:
        print("WEBHOOK update:", json.dumps(data)[:500], file=sys.stderr)
    except Exception:
        pass
    update = Update.de_json(data, telegram_app.bot)
    await telegram_app.process_update(update)
    return {"ok": True}

# =========================
# SIGNATURE HELPERS
# =========================
def _hmac_ok(user_id: int, score: int, sig: str) -> bool:
    """
    Legacy imza (SECRET ile) fallback.
    """
    if not SECRET:
        return False
    msg = f"{user_id}:{score}".encode("utf-8")
    expected = hmac.new(SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)

def _check_webapp_initdata(init_data: str, bot_token: str) -> bool:
    """
    Telegram WebApp initData doğrulaması.
    - data_check_string = 'hash' HARİÇ tüm parametreler (signature DAHİL),
      alfabetik sıraya göre "key=value", aralara '\n'
    - secret = HMAC_SHA256(key=b"WebAppData", msg=bot_token)
    - calc   = HMAC_SHA256(key=secret, msg=data_check_string).hexdigest()
    """
    if not init_data or not bot_token:
        return False
    try:
        parsed = parse_qsl(init_data, keep_blank_values=True, strict_parsing=False, encoding="utf-8")

        hash_val: Optional[str] = None
        pairs = []
        for k, v in parsed:
            k = unquote_plus(k)
            v = unquote_plus(v)
            if k == "hash":
                hash_val = v
            else:
                # 'signature' DAHİL, sadece 'hash' hariç
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
    """
    Skor kaydı:
      - Öncelik: Telegram WebApp initData (header: X-Telegram-Init-Data veya body.init_data)
      - Fallback: Legacy SECRET HMAC (user_id:score -> sig)
    """
    # Body al
    try:
        body = await request.json()
        if not isinstance(body, dict):
            body = {}
    except Exception:
        body = {}

    # Skor
    try:
        score_val = int(body.get("score", 0))
    except Exception:
        score_val = 0
    score_val = max(0, score_val)

    # 1) WebApp initData doğrulaması
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
        # 2) Legacy HMAC fallback
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

    # DB upsert
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
# ADMIN HTTP API
# =========================
def _require_admin_header(request: Request):
    hdr = request.headers.get("X-Admin-Token", "")
    if not SECRET_ADMIN or hdr.strip() != SECRET_ADMIN:
        raise HTTPException(status_code=403, detail="forbidden")

@app.post("/api/admin/reset_user")
async def api_admin_reset_user(payload: Dict[str, Any], request: Request):
    _require_admin_header(request)
    if engine is None:
        raise HTTPException(status_code=500, detail="database not configured")

    uid = None
    if "user_id" in payload and payload["user_id"] is not None:
        try:
            uid = int(payload["user_id"])
        except Exception:
            raise HTTPException(status_code=400, detail="invalid user_id")
    elif "username" in payload and payload["username"]:
        uname = str(payload["username"]).lstrip("@")
        async with engine.connect() as conn:
            res = await conn.execute(text("SELECT user_id FROM scores WHERE username = :u"), {"u": uname})
            row = res.first()
            if row:
                uid = int(row[0])
        if uid is None:
            raise HTTPException(status_code=404, detail="username not found")
    else:
        raise HTTPException(status_code=400, detail="need user_id or username")

    async with engine.begin() as conn:
        res = await conn.execute(
            text("UPDATE scores SET best_score = 0, updated_at = now() WHERE user_id = :uid"),
            {"uid": uid}
        )
        changed = res.rowcount or 0
    return {"ok": True, "changed": changed}

@app.post("/api/admin/reset_all")
async def api_admin_reset_all(request: Request):
    _require_admin_header(request)
    if engine is None:
        raise HTTPException(status_code=500, detail="database not configured")
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE scores SET best_score = 0, updated_at = now()"))
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

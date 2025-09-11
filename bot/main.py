import os
from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.staticfiles import StaticFiles
import httpx

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
GAME_SHORT_NAME = os.getenv("GAME_SHORT_NAME", "kapi_run")
PUBLIC_GAME_URL = os.getenv("PUBLIC_GAME_URL", "")  # https://.../kapi_run/index.html önerilir
SECRET = os.getenv("SECRET", "")

TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

app = FastAPI()

# --- OYUN DOSYALARINI SERVİS ET ---
# public/kapi_run klasörünü /kapi_run altında yayınlıyoruz
app.mount("/kapi_run", StaticFiles(directory="public/kapi_run"), name="kapi_run")

@app.get("/health")
async def health():
    return {"status": "ok"}

async def tg(method: str, payload: dict):
    url = f"{TELEGRAM_API}/{method}"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, json=payload)
        return r.json()

@app.post("/telegram/webhook")
async def telegram_webhook(request: Request,
                           x_telegram_bot_api_secret_token: str | None = Header(default=None)):
    # (Opsiyonel) Webhook Secret kontrolü
    if SECRET and x_telegram_bot_api_secret_token and x_telegram_bot_api_secret_token != SECRET:
        raise HTTPException(status_code=403, detail="Bad secret token")

    update = await request.json()

    # Mesaj akışı
    message = update.get("message") or update.get("edited_message")
    if message:
        chat_id = message["chat"]["id"]
        text = (message.get("text") or "").strip()

        if text.startswith("/start"):
            # Telegram Game mesajı (oyun kısa adıyla)
            await tg("sendGame", {"chat_id": chat_id, "game_short_name": GAME_SHORT_NAME})

            # İsteğe bağlı: Direkt link butonu (oyunun public URL’i)
            if PUBLIC_GAME_URL:
                await tg("sendMessage", {
                    "chat_id": chat_id,
                    "text": "Oyunu açmak için düğmeye tıkla 👇",
                    "reply_markup": {
                        "inline_keyboard": [[{"text": "🎮 KAPI RUN", "url": PUBLIC_GAME_URL}]]
                    }
                })
            return {"ok": True}

        # Diğer mesajlar
        await tg("sendMessage", {"chat_id": chat_id, "text": "Merhaba! /start yazarak oyunu başlatabilirsin."})
        return {"ok": True}

    # Callback query akışı (oyun butonuna tıklanınca gelenler vs.)
    callback_query = update.get("callback_query")
    if callback_query:
        cq_id = callback_query["id"]
        await tg("answerCallbackQuery", {"callback_query_id": cq_id})
        return {"ok": True}

    return {"ok": True}

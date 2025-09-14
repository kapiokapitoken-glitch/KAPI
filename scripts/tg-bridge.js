// scripts/tg-bridge.js
(function () {
  const W = window;
  const TG = W.Telegram && W.Telegram.WebApp ? W.Telegram.WebApp : null;

  if (!W.runtime && typeof globalThis !== "undefined") {
    W.runtime = globalThis.runtime || undefined;
  }

  W.KAPI_reportScore = function (s) {
    console.log("[KAPI] reportScore:", s);
  };

  W.submitScore = async function (score) {
    try {
      if (!Number.isFinite(score) || score < 0) throw new Error("Geçersiz skor");
      const initData = TG ? TG.initData : null; // WebApp dışında null (bilerek)
      const payload = { score: Math.floor(score), init_data: initData };

      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });
      const j = await res.json().catch(()=> ({}));
      console.log("[KAPI] /api/score resp:", res.status, j);
    } catch (e) {
      console.error("[KAPI] submitScore error:", e);
    }
  };

  if (TG) { try { TG.ready(); } catch {} }
  else { console.log("[KAPI] Telegram WebApp ortamı değil — init_data olmadan test 401 dönecek."); }
})();

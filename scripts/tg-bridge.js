$REPO = "C:\Users\BilTek\Documents\GitHub\KAPI"
Set-Location $REPO

$bridge = @'
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

      const initData = TG ? TG.initData : null;

      // initData içinden user_id / username çıkar
      let user_id = null, username = null;
      if (initData) {
        try {
          const params = new URLSearchParams(initData);
          const userStr = params.get("user");
          if (userStr) {
            const u = JSON.parse(userStr);
            user_id = (u && u.id) ?? null;
            username = (u && u.username) ?? null;
          }
        } catch (e) {
          console.warn("[KAPI] initData parse warn:", e);
        }
      }

      const payload = {
        score: Math.floor(score),
        init_data: initData,   // ileride backend imza doğrulaması için kalsın
        user_id,               // mevcut backend bunu istiyor
        username               // opsiyonel ama faydalı
      };

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
  else { console.log("[KAPI] Telegram WebApp ortamı değil — init_data olmadan test 401/400 beklenir."); }
})();
'@

Set-Content -Path "$REPO\scripts\tg-bridge.js" -Value $bridge -Encoding UTF8

git add scripts\tg-bridge.js
git commit -m "feat: include user_id/username from Telegram initData in score payload"
git push

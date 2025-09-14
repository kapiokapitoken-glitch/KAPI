(function () {
  const W = window;
  const TG = W.Telegram && W.Telegram.WebApp ? W.Telegram.WebApp : null;

  if (!W.runtime && typeof globalThis !== "undefined") {
    W.runtime = globalThis.runtime || undefined;
  }

  W.submitScore = async function (score) {
    try {
      if (!Number.isFinite(score) || score < 0) throw new Error("Invalid score");

      const initData = TG ? TG.initData : null;

      let user_id = null, username = null, sig = null, auth_date = null;
      if (initData) {
        try {
          const params = new URLSearchParams(initData);
          const userStr = params.get("user");
          if (userStr) {
            const u = JSON.parse(userStr);
            user_id = (u && u.id) || null;
            username = (u && u.username) || null;
          }
          sig = params.get("hash");
          auth_date = params.get("auth_date");
        } catch (e) {}
      }

      const payload = {
        score: Math.floor(score),
        user_id,
        username,
        sig,
        auth_date,
        init_data: initData
      };

      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });
      const txt = await res.text().catch(() => "");
      console.log("[KAPI bridge] /api/score", res.status, txt);
    } catch (e) {
      console.error("[KAPI bridge] submitScore error:", e);
    }
  };

  if (TG) { try { TG.ready(); } catch {} }
})();

// scripts/tg-bridge.js
(function () {
  const W = window;
  const TG = W.Telegram && W.Telegram.WebApp ? W.Telegram.WebApp : null;

  function parseInitData() {
    const out = {
      init_data: null,
      user_id: null,
      username: null,
      first_name: null,
      last_name: null,
      query_id: null,
      chat_type: null,
      chat_instance: null,
      auth_date: null,
      sig: null,
      hash: null,
    };
    if (!TG || !TG.initData) return out;

    const initData = TG.initData;
    out.init_data = initData;
    try {
      const params = new URLSearchParams(initData);

      // user objesi
      const userStr = params.get("user");
      if (userStr) {
        const u = JSON.parse(userStr);
        out.user_id = (u && u.id) || null;
        out.username = (u && u.username) || null;
        out.first_name = (u && u.first_name) || null;
        out.last_name = (u && u.last_name) || null;
      }

      // diğer alanlar
      out.query_id = params.get("query_id");
      out.chat_type = params.get("chat_type");
      out.chat_instance = params.get("chat_instance");

      const auth = params.get("auth_date");
      out.auth_date = auth != null ? Number(auth) : null;

      const hash = params.get("hash");
      out.sig = hash;   // backend 'sig' istiyor olabilir
      out.hash = hash;  // bazı backend'ler 'hash' ismini bekler
    } catch (e) {
      // sessiz geç
    }
    return out;
  }

  W.submitScore = async function (score) {
    try {
      if (!Number.isFinite(score) || score < 0) throw new Error("Invalid score");

      const ctx = parseInitData();
      const payload = {
        score: Math.floor(score),

        // Kimlik
        user_id: ctx.user_id,
        username: ctx.username,
        first_name: ctx.first_name,
        last_name: ctx.last_name,

        // WebApp imza/bağlam
        query_id: ctx.query_id,
        chat_type: ctx.chat_type,
        chat_instance: ctx.chat_instance,
        auth_date: ctx.auth_date,
        sig: ctx.sig,
        hash: ctx.hash,

        // Ham init_data (server tarafında doğrulama için)
        init_data: ctx.init_data,
      };

      // Kısa debug özeti
      console.log("[KAPI bridge] payload", {
        score: payload.score,
        user_id: payload.user_id,
        username: payload.username,
        sig_len: payload.sig ? payload.sig.length : 0,
        auth_date: payload.auth_date,
        init_len: ctx.init_data ? ctx.init_data.length : 0
      });

      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const txt = await res.text().catch(() => "");
      console.log("[KAPI bridge] /api/score", res.status, txt);
    } catch (e) {
      console.error("[KAPI bridge] submitScore error:", e);
    }
  };

  // İsteğe bağlı: debug için erişim
  W.getTelegramContext = parseInitData;

  if (TG) { try { TG.ready(); } catch {} }
})();

// scripts/tg-bridge.js
(function () {
  const W = window;
  const TG = W.Telegram && W.Telegram.WebApp ? W.Telegram.WebApp : null;

  function parseInitData() {
    const out = {
      init_data: null,         // ham query string (TG.initData)
      init_params: {},         // tüm key=val parametreler (string)
      user_json: null,         // initData içindeki user string'i
      user_id: null, username: null, first_name: null, last_name: null,
      query_id: null, chat_type: null, chat_instance: null,
      start_param: null, can_send_after: null,
      auth_date: null,         // number
      hash: null,              // Telegram'ın hash'i
      sig: null                // hash'i 'sig' olarak da geç
    };
    if (!TG || !TG.initData) return out;

    const initData = TG.initData;
    out.init_data = initData;

    try {
      const params = new URLSearchParams(initData);
      // tüm parametreleri objeye dök
      params.forEach((v, k) => { out.init_params[k] = v; });

      // user (JSON string)
      const userStr = params.get("user");
      if (userStr) {
        out.user_json = userStr;
        try {
          const u = JSON.parse(userStr);
          out.user_id    = (u && u.id) || null;
          out.username   = (u && u.username) || null;
          out.first_name = (u && u.first_name) || null;
          out.last_name  = (u && u.last_name) || null;
        } catch {}
      }

      // diğerleri
      out.query_id      = params.get("query_id");
      out.chat_type     = params.get("chat_type");
      out.chat_instance = params.get("chat_instance");
      out.start_param   = params.get("start_param");
      out.can_send_after = params.get("can_send_after");

      const auth = params.get("auth_date");
      out.auth_date = auth != null ? Number(auth) : null;

      const hash = params.get("hash");
      out.hash = hash;
      out.sig  = hash; // bazı backend'ler 'sig' bekliyor
    } catch {}
    return out;
  }

  W.submitScore = async function (score) {
    try {
      if (!Number.isFinite(score) || score < 0) throw new Error("Invalid score");

      const ctx = parseInitData();
      const payload = {
        score: Math.floor(score),
        ts: Date.now(),                 // teşhis için zaman damgası

        // Kimlik bilgileri (kolay tüketim için)
        user_id: ctx.user_id,
        username: ctx.username,
        first_name: ctx.first_name,
        last_name: ctx.last_name,

        // Telegram initData ham ve işlenmiş haller
        init_data: ctx.init_data,       // ham query string (en kritik)
        init_params: ctx.init_params,   // tüm parametreler (string)

        // Orijinal user JSON string (bazı sunucular bununla doğrular)
        user: ctx.user_json,

        // İmza/bağlam
        hash: ctx.hash,
        sig: ctx.sig,
        auth_date: ctx.auth_date,       // number
        query_id: ctx.query_id,
        chat_type: ctx.chat_type,
        chat_instance: ctx.chat_instance,
        start_param: ctx.start_param,
        can_send_after: ctx.can_send_after,

        // İsteğe bağlı bilgi
        href: (typeof location !== "undefined" && location.href) || null,
      };

      // Kısa debug özeti (içerikleri dökmüyoruz)
      console.log("[KAPI bridge] payload", {
        score: payload.score,
        user_id: payload.user_id,
        username: payload.username,
        sig_len: payload.sig ? payload.sig.length : 0,
        auth_date: payload.auth_date,
        init_len: payload.init_data ? payload.init_data.length : 0
      });

      const res = await fetch("/api/score", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Bazı backend'ler initData'yı header'dan okur:
          "X-Telegram-Init-Data": ctx.init_data || ""
        },
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

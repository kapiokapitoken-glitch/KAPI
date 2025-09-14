// scripts/tg-bridge.js
(function () {
  const W = window;
  const TG = W.Telegram && W.Telegram.WebApp ? W.Telegram.WebApp : null;

  function buildInitQSFromUnsafe(u) {
    // Telegram check_string: alfabetik sırada key=value (hash hariç),
    // fakat biz header için tam QS istiyoruz; hash'i de ekliyoruz.
    const pairs = [];
    const push = (k, v) => { if (v !== undefined && v !== null && v !== "") pairs.push([k, String(v)]); };

    // Temel alanlar
    push("auth_date", u.auth_date);
    push("chat_instance", u.chat_instance);
    push("chat_type", u.chat && u.chat.type || u.chat_type);
    push("query_id", u.query_id);
    push("start_param", u.start_param);
    push("can_send_after", u.can_send_after);

    // User JSON string'i
    if (u.user) {
      try { push("user", JSON.stringify(u.user)); } catch {}
    }

    // Hash en sonda
    push("hash", u.hash);

    // Sıralayıp encode et
    pairs.sort((a,b) => a[0].localeCompare(b[0]));
    const usp = new URLSearchParams();
    for (const [k, v] of pairs) usp.append(k, v);
    return usp.toString();
  }

  function parseInitData() {
    const out = {
      init_data: null,
      init_params: {},
      user_json: null,
      user_id: null, username: null, first_name: null, last_name: null,
      query_id: null, chat_type: null, chat_instance: null,
      start_param: null, can_send_after: null,
      auth_date: null,
      hash: null,
      sig: null,
    };

    const unsafe = (TG && TG.initDataUnsafe) ? TG.initDataUnsafe : null;
    const initData = (TG && TG.initData) ? TG.initData : "";

    // 1) Önce string olan initData
    if (initData && initData.length) {
      out.init_data = initData;
      try {
        const params = new URLSearchParams(initData);
        params.forEach((v, k) => { out.init_params[k] = v; });
        const userStr = params.get("user");
        if (userStr) {
          out.user_json = userStr;
          try {
            const u = JSON.parse(userStr);
            out.user_id = u && u.id || null;
            out.username = u && u.username || null;
            out.first_name = u && u.first_name || null;
            out.last_name = u && u.last_name || null;
          } catch {}
        }
        out.query_id = params.get("query_id");
        out.chat_type = params.get("chat_type");
        out.chat_instance = params.get("chat_instance");
        out.start_param = params.get("start_param");
        out.can_send_after = params.get("can_send_after");
        const auth = params.get("auth_date");
        out.auth_date = auth != null ? Number(auth) : null;
        out.hash = params.get("hash");
        out.sig = out.hash;
      } catch {}
      return out;
    }

    // 2) initData boşsa, initDataUnsafe'tan toparla ve QS üret
    if (unsafe) {
      try {
        out.user_id = unsafe.user && unsafe.user.id || null;
        out.username = unsafe.user && unsafe.user.username || null;
        out.first_name = unsafe.user && unsafe.user.first_name || null;
        out.last_name  = unsafe.user && unsafe.user.last_name || null;
        out.user_json = unsafe.user ? JSON.stringify(unsafe.user) : null;

        out.query_id = unsafe.query_id || null;
        out.chat_type = (unsafe.chat && unsafe.chat.type) || unsafe.chat_type || null;
        out.chat_instance = unsafe.chat_instance || null;
        out.start_param = unsafe.start_param || null;
        out.can_send_after = unsafe.can_send_after || null;
        out.auth_date = unsafe.auth_date != null ? Number(unsafe.auth_date) : null;
        out.hash = unsafe.hash || null;
        out.sig = out.hash;

        // init_params objesi
        const tmp = {};
        if (out.user_json) tmp.user = out.user_json;
        if (out.query_id) tmp.query_id = out.query_id;
        if (out.chat_type) tmp.chat_type = out.chat_type;
        if (out.chat_instance) tmp.chat_instance = out.chat_instance;
        if (out.start_param) tmp.start_param = out.start_param;
        if (out.can_send_after) tmp.can_send_after = out.can_send_after;
        if (out.auth_date != null) tmp.auth_date = String(out.auth_date);
        if (out.hash) tmp.hash = out.hash;
        out.init_params = tmp;

        // Header için kanonik QS oluştur
        out.init_data = buildInitQSFromUnsafe({
          user: unsafe.user,
          query_id: out.query_id,
          chat_type: out.chat_type,
          chat_instance: out.chat_instance,
          start_param: out.start_param,
          can_send_after: out.can_send_after,
          auth_date: out.auth_date,
          hash: out.hash
        });
      } catch {}
    }
    return out;
  }

  W.submitScore = async function (score) {
    try {
      if (!Number.isFinite(score) || score < 0) throw new Error("Invalid score");

      const ctx = parseInitData();
      const payload = {
        score: Math.floor(score),
        ts: Date.now(),
        user_id: ctx.user_id,
        username: ctx.username,
        first_name: ctx.first_name,
        last_name: ctx.last_name,
        init_data: ctx.init_data,
        init_params: ctx.init_params,
        user: ctx.user_json,
        hash: ctx.hash,
        sig: ctx.sig,
        auth_date: ctx.auth_date,
        query_id: ctx.query_id,
        chat_type: ctx.chat_type,
        chat_instance: ctx.chat_instance,
        start_param: ctx.start_param,
        can_send_after: ctx.can_send_after,
        href: (typeof location !== "undefined" && location.href) || null,
      };

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

  W.getTelegramContext = parseInitData;

  if (TG) { try { TG.ready(); } catch {} }
})();

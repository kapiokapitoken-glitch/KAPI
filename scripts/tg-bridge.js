// scripts/tg-bridge.js
(function () {
  const W = window;
  const TG = (W.Telegram && W.Telegram.WebApp) ? W.Telegram.WebApp : null;

  // initData boşsa, initDataUnsafe'tan kanonik querystring üret
  function qsFromUnsafe(u){
    if (!u) return "";
    const pairs=[]; const push=(k,v)=>{ if(v!==undefined && v!==null && v!=="") pairs.push([k,String(v)]) };
    push("auth_date",u.auth_date);
    push("chat_instance",u.chat_instance);
    push("chat_type",(u.chat&&u.chat.type)||u.chat_type);
    push("query_id",u.query_id);
    push("start_param",u.start_param);
    push("can_send_after",u.can_send_after);
    if(u.user){ try{ push("user", JSON.stringify(u.user)); }catch(e){} }
    push("hash",u.hash);
    pairs.sort((a,b)=>a[0].localeCompare(b[0]));
    const usp=new URLSearchParams(); pairs.forEach(([k,v])=>usp.append(k,v));
    return usp.toString();
  }

  function getInitData(){
    try{
      if (TG && TG.initData && /(^|&)hash=/.test(TG.initData)) return TG.initData;
      if (TG && TG.initDataUnsafe) return qsFromUnsafe(TG.initDataUnsafe);
    }catch(e){}
    return "";
  }

  W.submitScore = async function (score) {
    try {
      if (!Number.isFinite(score) || score < 0) throw new Error("Invalid score");
      const initData = getInitData();

      // user_id / username (opsiyonel; backend initData'dan da çıkarır)
      let user_id = null, username = null, auth_date = null, hash = null;
      if (initData) {
        try {
          const p = new URLSearchParams(initData);
          const uStr = p.get("user");
          if (uStr) {
            const u = JSON.parse(uStr);
            user_id = (u && u.id) || null;
            username = (u && u.username) || null;
          }
          auth_date = p.get("auth_date");
          hash = p.get("hash");
        } catch {}
      }

      const payload = {
        score: Math.floor(score),
        user_id, username,
        auth_date,
        hash,                 // bilgi amaçlı; doğrulama initData üzerinden yapılır
        init_data: initData   // <-- asıl önemli kısım
      };

      const res = await fetch("/api/score", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // header üzerinden de geç (backend ikisini de kabul ediyor)
          "X-Telegram-Init-Data": initData || ""
        },
        body: JSON.stringify(payload),
        credentials: "include"
      });

      // Sessiz çalış; yalnız başarısız olursa ufak bir uyarı ver
      if (!res.ok) {
        const txt = await res.text().catch(()=> "");
        // İstersen yoruma al: alert('Skor gönderilemedi: ' + res.status);
        console.log("[bridge] score resp", res.status, txt);
      }
    } catch (e) {
      console.error("[bridge] submitScore error:", e);
    }
  };

  // İstersen test için serbest fonksiyon
  W.__testScore = function(){ return W.submitScore(123); };

  if (TG) { try { TG.ready(); } catch {} }
})();

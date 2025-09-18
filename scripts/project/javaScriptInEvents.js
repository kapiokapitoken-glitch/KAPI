

const scriptsInEvents = {

	async Global_events_Event6(runtime, localVars)
	{
		// Construct 3 global değişkeninden skor al
		const s = Math.max(0, Math.floor(runtime.globalVars.NEWSCORE || 0));
		
		// JS tarafında da çift gönderimi kilitle
		if (window.scoreSent) { 
		    return; 
		}
		window.scoreSent = true;
		
		// Telegram WebApp içindeysek initData var, değilse boş string kalır
		const initData = (window.Telegram && Telegram.WebApp)
		  ? (Telegram.WebApp.initData || "")
		  : "";
		
		try {
		  if (typeof window.submitScore === "function") {
		    window.submitScore(s, initData);
		    console.log("[KAPI RUN] Skor gönderildi:", s);
		  } else {
		    console.warn("[KAPI RUN] window.submitScore bulunamadı!");
		  }
		} catch (e) {
		  console.error("[KAPI RUN] submitScore hata:", e);
		}
		
	}
};

globalThis.C3.JavaScriptInEvents = scriptsInEvents;

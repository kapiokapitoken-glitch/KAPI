(function(){
  // --- küçük HUD ---
  var hud=null; function logLine(t){ try{
    if(!hud){ hud=document.createElement("div");
      hud.style.cssText="position:fixed;left:8px;bottom:8px;max-width:92%;max-height:42%;overflow:auto;background:rgba(0,0,0,.85);color:#0f0;font:12px/1.4 monospace;z-index:1000000;padding:8px;border:1px solid #0f0;border-radius:8px";
      document.addEventListener("DOMContentLoaded", function(){ document.body.appendChild(hud); });
    }
    var d=document.createElement("div"); d.textContent="["+new Date().toISOString().slice(11,19)+"] "+t;
    hud.appendChild(d); if(hud.childNodes.length>400) hud.removeChild(hud.firstChild); hud.scrollTop=hud.scrollHeight;
  }catch(_){ }}
  function slog(){ try{ console.log.apply(console, arguments); logLine(Array.prototype.join.call(arguments," ")); }catch(_){ } }
  function serr(){ try{ console.error.apply(console, arguments); logLine(Array.prototype.join.call(arguments," ")); }catch(_){ } }

  // --- güvenli isim (Türkçe karakter map + JS identifier) ---
  function toSafeName(s){
    try{
      if(s==null) return "_n";
      s=String(s);
      var map={"ğ":"g","":"G","ş":"s","Ş":"S","ı":"i","":"I","ö":"o","Ö":"O","ç":"c","Ç":"C","ü":"u","Ü":"U"};
      s=s.replace(/[ğşŞıöÖçÇüÜ]/g, function(c){ return map[c]||c; });
      s=s.replace(/[^A-Za-z0-9_$]/g, "_");
      if(/^[0-9]/.test(s)) s="_"+s;
      return s || "_n";
    }catch(_){ return "_n"; }
  }

  // --- data.json sanitizasyonu: tüm "name"/"n" alanları normalize ---
  function sanitizeDataJsonText(txt){
    try{
      var obj = JSON.parse(txt);
      var changed = 0;
      (function walk(o){
        if(!o || typeof o!=="object") return;
        if(Array.isArray(o)){ for(var i=0;i<o.length;i++) walk(o[i]); return; }
        for(var k in o){
          if(!Object.prototype.hasOwnProperty.call(o,k)) continue;
          var v = o[k];
          // C3’ün event variable/param/ad alanları çoğunlukla "n" veya "name"
          if((k==="n" || k==="name") && typeof v==="string"){
            var saf = toSafeName(v);
            if(saf !== v){ o[k]=saf; changed++; }
          }
          walk(v);
        }
      })(obj);
      if(changed>0){
        slog("[C3-HOOK] data.json sanitized; changed =", changed);
        return JSON.stringify(obj);
      }else{
        slog("[C3-HOOK] data.json sanitized; changed = 0 (ok)");
        return null; // dokunma
      }
    }catch(e){
      serr("[C3-HOOK] sanitize parse error:", e && e.message);
      return null;
    }
  }

  // --- fetch proxy: data.json yakala ve düzelt ---
  try{
    if(window.fetch){
      var realFetch = window.fetch.bind(window);
      window.fetch = async function(input, init){
        var url = (typeof input==="string") ? input : (input && input.url) || "";
        var res = await realFetch(input, init);
        try{
          if(/\/data\.json(\?|$)/.test(url)){
            var clone = res.clone();
            var txt = await clone.text();
            var patched = sanitizeDataJsonText(txt);
            if(patched != null){
              return new Response(patched, {
                status: res.status, statusText: res.statusText,
                headers: {"Content-Type":"application/json"}
              });
            }
          }
        }catch(e){ serr("[C3-HOOK] fetch patch error:", e && e.message); }
        return res;
      };
      slog("[C3-HOOK] fetch proxy installed (data.json sanitizer)");
    }
  }catch(e){ serr("[C3-HOOK] fetch hook failed:", e && e.message); }

  // (steğe bağlı) genel hata log’u
  window.addEventListener("unhandledrejection", function(e){
    serr("[C3-HOOK] unhandledrejection", (e && (e.reason && e.reason.message)) || (e && e.reason) || e);
  });
  window.addEventListener("error", function(e){
    serr("[C3-HOOK] window.error", e && e.message, e && e.filename, e && e.lineno);
  });

})();

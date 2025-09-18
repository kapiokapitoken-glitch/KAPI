(function(){
  // --- tiny on-screen overlay for logs ---
  var addOverlay = (function(){
    var el = null;
    function ensure(){
      if (el) return el;
      el = document.createElement("div");
      el.id = "c3hookOverlay";
      el.style.cssText = "position:fixed;left:8px;bottom:8px;max-width:90%;max-height:40%;overflow:auto;background:rgba(0,0,0,0.85);color:#0f0;font:12px/1.4 monospace;z-index:1000000;padding:8px;border:1px solid #0f0;border-radius:8px";
      document.addEventListener("DOMContentLoaded", function(){ document.body.appendChild(el); });
      return el;
    }
    return function(msg){
      try{
        var box = ensure();
        var d = document.createElement("div");
        d.textContent = "[" + new Date().toISOString().slice(11,19) + "] " + msg;
        box.appendChild(d);
        if (box.childNodes.length > 400) box.removeChild(box.firstChild);
        box.scrollTop = box.scrollHeight;
      }catch(_){}
    };
  })();

  function slog(){ try{ console.log.apply(console, arguments); addOverlay(Array.prototype.join.call(arguments, " ")); }catch(_){} }
  function serr(){ try{ console.error.apply(console, arguments); addOverlay(Array.prototype.join.call(arguments, " ")); }catch(_){} }

  function wrap(fn, tag){
    return function(){
      try { return fn.apply(this, arguments); }
      catch(e){
        try{
          serr("[C3-HOOK] "+tag+" ERROR args=", JSON.stringify(Array.prototype.slice.call(arguments)), "message=", (e && e.message) || e);
        }catch(_){}
        throw e;
      }
    };
  }

  function interceptGPN(R){
    try{
      if(!R) return false;

      // (A) mevcut fonksiyonu sar
      if (typeof R.GetJsPropName === "function" && !R.__gpnHooked){
        R.GetJsPropName = wrap(R.GetJsPropName, "GetJsPropName");
        R.__gpnHooked = true;
        slog("[C3-HOOK] Hooked Eb.Runtime.GetJsPropName (direct)");
      }

      // (B) sonradan atamalar için property-intercept
      if (!R.__gpnIntercepted){
        var _gpn = R.GetJsPropName;
        try{
          Object.defineProperty(R, "GetJsPropName", {
            configurable: true,
            enumerable: false,
            get(){ return _gpn; },
            set(v){
              if (typeof v === "function"){
                _gpn = wrap(v, "GetJsPropName(set)");
                slog("[C3-HOOK] Intercepted assignment of GetJsPropName");
              } else {
                _gpn = v;
              }
            }
          });
          R.__gpnIntercepted = true;
          if (typeof _gpn === "function"){ R.GetJsPropName = _gpn; }
        }catch(e){ /* bazı ortamlarda defineProperty mümkün olmayabilir */ }
      }
      return true;
    }catch(_){ return false; }
  }

  function tryHook(){
    var Eb = window.Eb;
    if (!Eb || !Eb.Runtime) return false;
    return interceptGPN(Eb.Runtime);
  }

  function tryHookEventVar(){
    try{
      var EvVar = (window.PG && PG.EventVariable) || (window.gG && gG.EventVariable);
      if(!EvVar || !EvVar.prototype || typeof EvVar.prototype.Create !== "function" || EvVar.prototype.__evHooked) return false;
      var orig = EvVar.prototype.Create;
      EvVar.prototype.Create = function(){
        try{
          var name = (this && (this.n || this.name)) || "(unknown)";
          slog("[C3-HOOK] EventVariable.Create name=", name);
        }catch(_){}
        return orig.apply(this, arguments);
      };
      EvVar.prototype.__evHooked = true;
      slog("[C3-HOOK] Hooked EventVariable.Create");
      return true;
    }catch(_){ return false; }
  }

  // hemen dene
  tryHook();

  // Eb atandığında tekrar dene
  try{
    var __Eb = window.Eb;
    Object.defineProperty(window, "Eb", {
      configurable: true, enumerable: true,
      get(){ return __Eb; },
      set(v){ __Eb = v; tryHook(); }
    });
    slog("[C3-HOOK] window.Eb setter installed");
  }catch(e){
    serr("[C3-HOOK] defineProperty failed", e);
  }

  // geç gelen tanımlar için polling
  var t = setInterval(function(){
    tryHook();
    tryHookEventVar();
  }, 50);

  // global hataları da göster
  window.addEventListener("unhandledrejection", function(e){
    serr("[C3-HOOK] unhandledrejection", (e && (e.reason && e.reason.message)) || (e && e.reason) || e);
  });
  window.addEventListener("error", function(e){
    serr("[C3-HOOK] window.error", e && e.message, e && e.filename, e && e.lineno);
  });
})();

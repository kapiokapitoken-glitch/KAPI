(function(){
  function slog(){ try{ console.log.apply(console, arguments); }catch(_){} }
  function serr(){ try{ console.error.apply(console, arguments); }catch(_){} }
  function wrap(fn, tag){
    return function(){
      try { return fn.apply(this, arguments); }
      catch(e){
        try{
          serr("[C3-HOOK] "+tag+" ERROR",
               "args=", Array.prototype.slice.call(arguments),
               "message=", (e && e.message) || e);
        }catch(_){}
        throw e;
      }
    };
  }

  function interceptGPN(R){
    try{
      if(!R) return false;

      // (A) Halihazırda fonksiyon ise sar
      if (typeof R.GetJsPropName === "function" && !R.__gpnHooked){
        R.GetJsPropName = wrap(R.GetJsPropName, "GetJsPropName");
        R.__gpnHooked = true;
        slog("[C3-HOOK] Hooked Eb.Runtime.GetJsPropName (direct)");
      }

      // (B) Atama anını da yakala: property interceptor
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
          // eski değer varsa tekrar set ederek saralım
          if (typeof _gpn === "function"){
            R.GetJsPropName = _gpn;
          }
        }catch(e){ /* bazı ortamlarda defineProperty engellenebilir */ }
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

  // Mevcutsa dene
  tryHook();

  // Eb atanınca tekrar dene (setter)
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

  // Polling: geç gelen tanımlar için
  var t = setInterval(function(){
    tryHook();
    tryHookEventVar();
  }, 50);

  // Ek görünür loglar
  window.addEventListener("unhandledrejection", function(e){
    serr("[C3-HOOK] unhandledrejection", e && (e.reason || e));
  });
  window.addEventListener("error", function(e){
    serr("[C3-HOOK] window.error", e && e.message, e && e.filename, e && e.lineno);
  });
})();

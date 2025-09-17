(function(){
  function slog(){ try{ console.log.apply(console, arguments); }catch(_){} }
  function serr(){ try{ console.error.apply(console, arguments); }catch(_){} }

  function hookGPN(Eb){
    try{
      if(!Eb || !Eb.Runtime) return;
      if(Eb.Runtime.__gpnHooked) return;
      var orig = Eb.Runtime.GetJsPropName;
      if(typeof orig !== "function") return;
      Eb.Runtime.GetJsPropName = function(){
        try { return orig.apply(this, arguments); }
        catch(e){
          try{
            serr("[C3-HOOK] GetJsPropName ERROR",
                 "args=", Array.prototype.slice.call(arguments),
                 "message=", (e && e.message) || e);
          }catch(_){}
          throw e;
        }
      };
      Eb.Runtime.__gpnHooked = true;
      slog("[C3-HOOK] Hooked Eb.Runtime.GetJsPropName (early)");
    }catch(e){/*noop*/}
  }

  // 1) Mevcut Eb varsa hemen kanca
  if (window.Eb) hookGPN(window.Eb);

  // 2) Eb atanınca otomatik kanca: setter
  try{
    var __Eb = window.Eb;
    Object.defineProperty(window, "Eb", {
      configurable: true,
      enumerable: true,
      get(){ return __Eb; },
      set(v){ __Eb = v; try{ hookGPN(v); }catch(_){} }
    });
    slog("[C3-HOOK] window.Eb setter installed");
  }catch(e){
    serr("[C3-HOOK] defineProperty failed", e);
  }

  // (Opsiyonel) EventVariable.Create isimlerini yazdır
  function tryHookEventVar(){
    try{
      var EvVar = (window.PG && PG.EventVariable) || (window.gG && gG.EventVariable);
      if(!EvVar || !EvVar.prototype || typeof EvVar.prototype.Create !== "function" || EvVar.prototype.__evHooked) return;
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
    }catch(_){}
  }

  // PG/gG sonradan gelirse periyodik dene
  var t = setInterval(function(){
    tryHookEventVar();
    if (window.Eb && window.Eb.Runtime && window.Eb.Runtime.__gpnHooked) { /* bırak devam etsin */ }
  }, 60);
})();

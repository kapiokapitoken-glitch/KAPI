(function(){
  // Güvenli log helper
  function safeLog(){ try{ console.log.apply(console, arguments); }catch(_){} }
  function safeErr(){ try{ console.error.apply(console, arguments); }catch(_){} }

  function hookOnce(){
    try{
      var Eb = window.Eb;
      if (!Eb || !Eb.Runtime) return false;

      // 1) *** ÖNEML ***: Stack'te görünen fonksiyon sınıf üstünde -> Eb.Runtime.GetJsPropName
      if (typeof Eb.Runtime.GetJsPropName === "function" && !Eb.Runtime.__gpnHooked){
        var _origGPN = Eb.Runtime.GetJsPropName;
        Eb.Runtime.GetJsPropName = function(){
          try{
            return _origGPN.apply(this, arguments);
          }catch(e){
            safeErr("[C3-HOOK] GetJsPropName ERROR",
                    "args=", Array.prototype.slice.call(arguments),
                    "message=", (e && e.message) || e);
            throw e;
          }
        };
        Eb.Runtime.__gpnHooked = true;
        safeLog("[C3-HOOK] Hooked Eb.Runtime.GetJsPropName");
      }

      // 2) EventVariable.Create mevcutsa isimleri logla (minify adına göre iki olası yol)
      var EvVarClass = (window.PG && PG.EventVariable) || (window.gG && gG.EventVariable);
      if (EvVarClass && EvVarClass.prototype && typeof EvVarClass.prototype.Create === "function" && !EvVarClass.prototype.__evCreateHooked){
        var _origCreate = EvVarClass.prototype.Create;
        EvVarClass.prototype.Create = function(){
          try{
            var name = (this && (this.n || this.name)) || "(unknown)";
            safeLog("[C3-HOOK] EventVariable.Create name=", name);
          }catch(_){}
          return _origCreate.apply(this, arguments);
        };
        EvVarClass.prototype.__evCreateHooked = true;
        safeLog("[C3-HOOK] Hooked EventVariable.Create");
      }

      return true;
    }catch(_){
      return false;
    }
  }

  // C3 kodu gelene kadar periyodik dene
  var t = setInterval(function(){
    if (hookOnce()){ clearInterval(t); }
  }, 80);
})();

(function(){
  function hook(){
    try{
      var Eb = window.Eb;
      if (!Eb || !Eb.Runtime || !Eb.Runtime.prototype) return false;

      var R = Eb.Runtime.prototype;

      // 1) GetJsPropName kancası: hatalı ismi ve argümanları logla
      if (typeof R.GetJsPropName === "function" && !R.__getJsPropNameHooked){
        var orig = R.GetJsPropName;
        R.GetJsPropName = function(){
          try {
            return orig.apply(this, arguments);
          } catch (e){
            try {
              console.error("[C3-HOOK] GetJsPropName ERROR. args=", arguments, "message=", e && e.message);
            } catch(_){}
            throw e;
          }
        };
        R.__getJsPropNameHooked = true;
        console.log("[C3-HOOK] GetJsPropName hooked");
      }

      // 2) Event değişken yaratımı yakala (ismini logla) — mevcutsa
      // Minified isimler değişebileceği için iki olası ad deniyoruz:
      var EvVarClass = (window.PG && PG.EventVariable) || (window.gG && gG.EventVariable);
      if (EvVarClass && EvVarClass.prototype && EvVarClass.prototype.Create && !EvVarClass.prototype.__evHooked){
        var origCreate = EvVarClass.prototype.Create;
        EvVarClass.prototype.Create = function(){
          try {
            var name = (this && (this.n || this.name)) || "(unknown)";
            console.log("[C3-HOOK] Creating EventVariable:", name);
          } catch(_){}
          return origCreate.apply(this, arguments);
        };
        EvVarClass.prototype.__evHooked = true;
        console.log("[C3-HOOK] EventVariable.Create hooked");
      }

      return true;
    } catch(_) {
      return false;
    }
  }

  // C3 kodu yüklenene kadar bekle
  var t = setInterval(function(){
    if (hook()){ clearInterval(t); }
  }, 60);
})();

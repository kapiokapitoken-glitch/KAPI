(function(){
  // --- küçük overlay ---
  var addOverlay=(function(){var el=null;function ensure(){if(el)return el;el=document.createElement("div");el.id="c3hookOverlay";el.style.cssText="position:fixed;left:8px;bottom:8px;max-width:90%;max-height:42%;overflow:auto;background:rgba(0,0,0,0.85);color:#0f0;font:12px/1.4 monospace;z-index:1000000;padding:8px;border:1px solid #0f0;border-radius:8px";document.addEventListener("DOMContentLoaded",function(){document.body.appendChild(el);});return el;}return function(msg){try{var box=ensure();var d=document.createElement("div");d.textContent="["+new Date().toISOString().slice(11,19)+"] "+msg;box.appendChild(d);if(box.childNodes.length>400)box.removeChild(box.firstChild);box.scrollTop=box.scrollHeight;}catch(_){} };})();
  function slog(){try{console.log.apply(console,arguments);addOverlay(Array.prototype.join.call(arguments," "));}catch(_){}} 
  function serr(){try{console.error.apply(console,arguments);addOverlay(Array.prototype.join.call(arguments," "));}catch(_){}} 

  // geçersiz ad -> güvenli JS adı (ASCII/altçizgi)
  function toSafeName(s){
    try{
      if(s==null) return "_ev";
      s=String(s);
      var map={"ğ":"g","":"G","ş":"s","Ş":"S","ı":"i","":"I","ö":"o","Ö":"O","ç":"c","Ç":"C","ü":"u","Ü":"U"};
      s=s.replace(/[ğşŞıöÖçÇüÜ]/g,function(c){return map[c]||c;});
      s=s.replace(/[^A-Za-z0-9_$]/g,"_");
      if(/^[0-9]/.test(s)) s="_"+s;
      return s||"_ev";
    }catch(_){return "_ev";}
  }

  // hata halinde güvenli ada düşen sarıcı
  function wrapWithFallback(fn, tag){
    if(fn && fn.__c3hookWrapped) return fn;
    function wrapped(){
      try{ return fn.apply(this, arguments); }
      catch(e){
        var orig = (arguments && arguments.length ? arguments[0] : "(none)");
        var safe = toSafeName(orig);
        serr("[C3-HOOK] "+tag+" ERROR -> fallback:", JSON.stringify(orig),"=>",safe,"msg=",(e&&e.message)||e);
        return safe;
      }
    }
    try{ Object.defineProperty(wrapped,"name",{value:(fn.name||"gpn")+"_wrapped"}); }catch(_){}
    wrapped.__c3hookWrapped = true;
    return wrapped;
  }

  // 1) Doğrudan Eb.Runtime.GetJsPropName hook (varsa)
  function tryHookDirect(){
    try{
      var Eb = window.Eb;
      if(!Eb || !Eb.Runtime) return false;
      var R = Eb.Runtime;
      if(typeof R.GetJsPropName === "function" && !R.GetJsPropName.__c3hookWrapped){
        R.GetJsPropName = wrapWithFallback(R.GetJsPropName, "GetJsPropName(direct)");
        slog("[C3-HOOK] Hooked GetJsPropName via Eb.Runtime (direct)");
        return true;
      }
    }catch(_){}
    return false;
  }

  // 2) Geniş tarayıcı: isim/mesaj eşleşen her fonksiyonu sar
  var seenObjs = new WeakSet();
  function scanAndHook(root, maxDepth){
    var hooked=0;
    try{
      (function walk(obj, depth){
        if(!obj || typeof obj!=="object" && typeof obj!=="function") return;
        if(seenObjs.has(obj)) return; seenObjs.add(obj);
        if(depth<=0) return;

        var keys=[]; try{ keys=Object.getOwnPropertyNames(obj); }catch(_){ return; }
        for(var i=0;i<keys.length;i++){
          var k=keys[i], desc;
          try{ desc=Object.getOwnPropertyDescriptor(obj,k); }catch(_){ continue; }
          if(!desc) continue;
          var val = (desc.get ? (function(){try{return desc.get.call(obj);}catch(_){return obj[k];}})() : obj[k]);

          if(typeof val==="function"){
            var fname=String(k), codeStr=""; try{ codeStr=Function.prototype.toString.call(val); }catch(_){}
            var looksLikeGpn = /GetJsPropName/i.test(fname) || /invalid prop reference/.test(codeStr);
            if(looksLikeGpn && !val.__c3hookWrapped){
              try{
                var wrapped = wrapWithFallback(val, "GetJsPropName(scan:"+fname+")");
                try{ Object.defineProperty(obj,k,{configurable:true,writable:true,value:wrapped}); }catch(_){ obj[k]=wrapped; }
                hooked++; slog("[C3-HOOK] Hooked by scan:", fname, "on", (obj&&obj.constructor&&obj.constructor.name)||"obj");
              }catch(e){ serr("[C3-HOOK] hook fail on",fname,e); }
            }
          }

          // derine in
          try{
            var child=val;
            if(child && (typeof child==="object" || typeof child==="function")){
              if(!seenObjs.has(child)) walk(child, depth-1);
            }
          }catch(_){}
        }
      })(root, maxDepth||5);
    }catch(_){}
    return hooked;
  }

  // 3) KRTK: EventVariable.Create içinde adı SANITIZE et (GetJsPropName çağrılmadan önce)
  function tryHookEventVar(){
    try{
      var EvVar = (window.PG && PG.EventVariable) || (window.gG && gG.EventVariable);
      if(!EvVar || !EvVar.prototype || typeof EvVar.prototype.Create!=="function" || EvVar.prototype.__evHooked) return false;
      var orig = EvVar.prototype.Create;
      EvVar.prototype.Create = function(){
        try{
          var old = (this && (this.n!=null?this.n:this.name)) || "(unknown)";
          var safe = toSafeName(old);
          if(old !== safe){
            try{ this.n = safe; }catch(_){}
            try{ this.name = safe; }catch(_){}
            slog("[C3-HOOK] sanitized EventVariable name:", JSON.stringify(old), "=>", safe);
          }else{
            slog("[C3-HOOK] EventVariable.Create name OK:", safe);
          }
        }catch(e){ serr("[C3-HOOK] EventVariable.Create wrapper err",e); }
        return orig.apply(this, arguments);
      };
      EvVar.prototype.__evHooked = true;
      slog("[C3-HOOK] Hooked EventVariable.Create (sanitize)");
      return true;
    }catch(_){ return false; }
  }

  // başlat
  tryHookDirect();

  // Eb sonradan atanırsa tekrar dene
  try{
    var __Eb = window.Eb;
    Object.defineProperty(window,"Eb",{configurable:true,enumerable:true,
      get(){return __Eb;},
      set(v){ __Eb=v; tryHookDirect(); }
    });
    slog("[C3-HOOK] window.Eb setter installed");
  }catch(e){ serr("[C3-HOOK] defineProperty failed",e); }

  // periyodik tarama: direct + scan + EventVariable sanitize
  var ticks=0;
  var timer=setInterval(function(){
    var a=tryHookDirect();
    var b=scanAndHook(window,5);
    var c=tryHookEventVar();
    if((a||b||c) && ++ticks>50) clearInterval(timer);
  }, 80);

  // global hatalar
  window.addEventListener("unhandledrejection", function(e){
    serr("[C3-HOOK] unhandledrejection", (e && (e.reason && e.reason.message)) || (e && e.reason) || e);
  });
  window.addEventListener("error", function(e){
    serr("[C3-HOOK] window.error", e && e.message, e && e.filename, e && e.lineno);
  });
})();

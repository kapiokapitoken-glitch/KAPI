(function(){
  // --- mini HUD ---
  var hud=null; function line(t){try{
    if(!hud){ hud=document.createElement("div");
      hud.style.cssText="position:fixed;left:8px;bottom:8px;max-width:92%;max-height:42%;overflow:auto;background:rgba(0,0,0,.85);color:#0f0;font:12px/1.4 monospace;z-index:1000000;padding:8px;border:1px solid #0f0;border-radius:8px";
      document.addEventListener("DOMContentLoaded",()=>document.body.appendChild(hud));
    }
    var d=document.createElement("div"); d.textContent="["+new Date().toISOString().slice(11,19)+"] "+t;
    hud.appendChild(d); if(hud.childNodes.length>400) hud.removeChild(hud.firstChild); hud.scrollTop=hud.scrollHeight;
  }catch(_){}}; function slog(){try{console.log.apply(console,arguments);}catch(_){ } line([].join.call(arguments," "));}
  function serr(){try{console.error.apply(console,arguments);}catch(_){ } line([].join.call(arguments," "));}

  // --- güvenli isim ---
  function toSafeName(s){
    try{
      if(s==null) return "_n";
      s=String(s);
      var map={"ğ":"g","":"G","ş":"s","Ş":"S","ı":"i","":"I","ö":"o","Ö":"O","ç":"c","Ç":"C","ü":"u","Ü":"U"};
      s=s.replace(/[ğşŞıöÖçÇüÜ]/g,(c)=>map[c]||c);
      s=s.replace(/[^A-Za-z0-9_$]/g,"_");
      if(/^[0-9]/.test(s)) s="_"+s;
      return s||"_n";
    }catch(_){return "_n";}
  }

  // --- JSON içi name/n alanlarını düzelt ---
  function sanitizeObjectNames(obj){
    var changed=0;
    (function walk(o){
      if(!o||typeof o!=="object") return;
      if(Array.isArray(o)){ for(var i=0;i<o.length;i++) walk(o[i]); return; }
      for(var k in o){ if(!Object.prototype.hasOwnProperty.call(o,k)) continue;
        var v=o[k];
        if((k==="n"||k==="name"||k==="prop"||k==="property"||k==="var"||k==="id") && typeof v==="string"){
          var s=toSafeName(v); if(s!==v){ o[k]=s; changed++; }
        }
        walk(v);
      }
    })(obj);
    return changed;
  }

  function sanitizeDataJsonText(txt){
    try{
      var obj=JSON.parse(txt);
      var changed=sanitizeObjectNames(obj);
      if(changed>0){ slog("[C3-HOOK] data.json sanitized; changed =",changed); return JSON.stringify(obj); }
      slog("[C3-HOOK] data.json sanitized; changed = 0"); return null;
    }catch(e){ serr("[C3-HOOK] sanitize parse error:",e&&e.message); return null; }
  }

  // --- fetch proxy: data.json'ı yakala ve düzelt ---
  try{
    if(window.fetch){
      var realFetch=window.fetch.bind(window);
      window.fetch=async function(input,init){
        var url=(typeof input==="string")?input:((input&&input.url)||"");
        var res=await realFetch(input,init);
        try{
          if(/\/data\.json(\?|$)/.test(url)){
            var clone=res.clone(); var txt=await clone.text();
            var patched=sanitizeDataJsonText(txt);
            if(patched!=null){
              return new Response(patched,{status:res.status,statusText:res.statusText,
                headers:{"Content-Type":"application/json"}});
            }
          }
        }catch(e){ serr("[C3-HOOK] fetch patch error:",e&&e.message); }
        return res;
      };
      slog("[C3-HOOK] fetch proxy installed (data.json sanitizer)");
    }
  }catch(e){ serr("[C3-HOOK] fetch hook failed:",e&&e.message); }

  // --- GetJsPropName patch ---
  function wrapGJPN(R){
    try{
      if(!R||typeof R.GetJsPropName!=="function") return false;
      if(R._gjpnPatched) return true;
      var orig=R.GetJsPropName.bind(R);
      R.GetJsPropName=function(name){
        var original=name, safe=(typeof name==="string")?toSafeName(name):name;
        try{ return orig(safe); }
        catch(e){ serr("[C3-HOOK] GetJsPropName throw; in=",original," safe=",safe," err=",e&&e.message); throw e; }
      };
      R._gjpnPatched=true; slog("[C3-HOOK] GetJsPropName patched"); return true;
    }catch(e){ serr("[C3-HOOK] wrapGJPN failed:",e&&e.message); return false; }
  }
  function installGJPNSetterOnRuntime(R){
    try{
      if(!R) return;
      var desc=Object.getOwnPropertyDescriptor(R,"GetJsPropName");
      if(!desc||desc.configurable){
        var _fn=R.GetJsPropName;
        Object.defineProperty(R,"GetJsPropName",{configurable:true,enumerable:true,
          get:function(){return _fn;}, set:function(v){ _fn=v; try{wrapGJPN(R);}catch(_){}}});
        try{wrapGJPN(R);}catch(_){}
        slog("[C3-HOOK] Runtime.GetJsPropName setter installed");
      }
    }catch(e){ serr("[C3-HOOK] installGJPNSetterOnRuntime failed:",e&&e.message); }
  }
  function handleEbRuntime(EbObj){
    try{
      if(!EbObj) return;
      if(EbObj.Runtime){ installGJPNSetterOnRuntime(EbObj.Runtime); }
      var d=Object.getOwnPropertyDescriptor(EbObj,"Runtime");
      if(!d||d.configurable){
        var _R=EbObj.Runtime;
        Object.defineProperty(EbObj,"Runtime",{configurable:true,enumerable:true,
          get:function(){return _R;}, set:function(v){ _R=v; try{installGJPNSetterOnRuntime(v); slog("[C3-HOOK] patched via Eb.Runtime setter");}catch(_){}}});
        slog("[C3-HOOK] Eb.Runtime setter installed");
      }
    }catch(e){ serr("[C3-HOOK] handleEbRuntime failed:",e&&e.message); }
  }

  // --- PG.EventVariable.Create ve gG.EventSheet._CreateEventVariable patch ---
  function tryPatchEventVariableCreate(PG){
    try{
      if(!PG||!PG.EventVariable) return false;
      var EV=PG.EventVariable;
      if(EV._createPatched) return true;
      var cand = EV.Create || EV.create || EV.prototype && (EV.prototype.Create||EV.prototype.create);
      if(typeof cand!=="function") return false;

      var orig=cand.bind(EV);
      var wrapper=function(){
        try{
          for(var i=0;i<arguments.length;i++){
            var a=arguments[i];
            if(a && typeof a==="object"){
              if(typeof a.n==="string"){ var s=toSafeName(a.n); if(s!==a.n){ slog("[C3-HOOK] EV.name sanitized:",a.n,"→",s); a.n=s; } }
              if(typeof a.name==="string"){ var s2=toSafeName(a.name); if(s2!==a.name){ slog("[C3-HOOK] EV.name sanitized:",a.name,"→",s2); a.name=s2; } }
            }
          }
        }catch(__){}
        return orig.apply(this, arguments);
      };

      if(EV.Create) EV.Create = wrapper;
      if(EV.create) EV.create = wrapper;
      if(EV.prototype){
        if(EV.prototype.Create) EV.prototype.Create = wrapper;
        if(EV.prototype.create) EV.prototype.create = wrapper;
      }
      EV._createPatched = true;
      slog("[C3-HOOK] PG.EventVariable.Create patched");
      return true;
    }catch(e){ serr("[C3-HOOK] patch EV.Create failed:", e&&e.message); return false; }
  }

  function tryPatchEventSheetCreateVariable(gG){
    try{
      if(!gG||!gG.EventSheet) return false;
      var ES=gG.EventSheet;
      if(ES._createVarPatched) return true;
      var cand = ES._CreateEventVariable || ES.prototype && ES.prototype._CreateEventVariable;
      if(typeof cand!=="function") return false;

      var orig=cand.bind(ES);
      var wrapper=function(){
        try{
          for(var i=0;i<arguments.length;i++){
            var a=arguments[i];
            if(a && typeof a==="object"){
              if(typeof a.n==="string"){ var s=toSafeName(a.n); if(s!==a.n){ slog("[C3-HOOK] Sheet.EV.name sanitized:",a.n,"→",s); a.n=s; } }
              if(typeof a.name==="string"){ var s2=toSafeName(a.name); if(s2!==a.name){ slog("[C3-HOOK] Sheet.EV.name sanitized:",a.name,"→",s2); a.name=s2; } }
            }
          }
        }catch(__){}
        return orig.apply(this, arguments);
      };

      if(ES._CreateEventVariable) ES._CreateEventVariable = wrapper;
      if(ES.prototype && ES.prototype._CreateEventVariable) ES.prototype._CreateEventVariable = wrapper;
      ES._createVarPatched = true;
      slog("[C3-HOOK] gG.EventSheet._CreateEventVariable patched");
      return true;
    }catch(e){ serr("[C3-HOOK] patch Sheet._CreateEventVariable failed:", e&&e.message); return false; }
  }

  function installPGSetter(){
    try{
      var desc=Object.getOwnPropertyDescriptor(window,"PG");
      if(!desc||desc.configurable){
        var _PG=window.PG;
        Object.defineProperty(window,"PG",{configurable:true,enumerable:true,
          get:function(){return _PG;}, set:function(v){ _PG=v; try{
            tryPatchEventVariableCreate(v);
            slog("[C3-HOOK] patched via PG setter");
          }catch(_){}}});
        if(_PG) tryPatchEventVariableCreate(_PG);
      }
    }catch(e){ serr("[C3-HOOK] PG setter error:", e&&e.message); }
  }
  function installgGSetter(){
    try{
      var desc=Object.getOwnPropertyDescriptor(window,"gG");
      if(!desc||desc.configurable){
        var _gG=window.gG;
        Object.defineProperty(window,"gG",{configurable:true,enumerable:true,
          get:function(){return _gG;}, set:function(v){ _gG=v; try{
            tryPatchEventSheetCreateVariable(v);
            slog("[C3-HOOK] patched via gG setter");
          }catch(_){}}});
        if(_gG) tryPatchEventSheetCreateVariable(_gG);
      }
    }catch(e){ serr("[C3-HOOK] gG setter error:", e&&e.message); }
  }

  // 1) mevcut nesnelerde dene
  if(window.Eb) try{ handleEbRuntime(window.Eb); }catch(_){}
  if(window.PG) try{ tryPatchEventVariableCreate(window.PG); }catch(_){}
  if(window.gG) try{ tryPatchEventSheetCreateVariable(window.gG); }catch(_){}

  // 2) setter’ları kur
  (function installEbSetter(){
    try{
      var desc=Object.getOwnPropertyDescriptor(window,"Eb");
      if(!desc||desc.configurable){
        var _Eb=window.Eb;
        Object.defineProperty(window,"Eb",{configurable:true,enumerable:true,
          get:function(){return _Eb;}, set:function(v){ _Eb=v; try{
            handleEbRuntime(v); slog("[C3-HOOK] patched via Eb setter");
          }catch(_){}}});
        slog("[C3-HOOK] window.Eb setter installed");
        if(_Eb) try{ handleEbRuntime(_Eb); }catch(_){}
      } else {
        slog("[C3-HOOK] window.Eb not configurable; skipping setter");
      }
    }catch(e){ serr("[C3-HOOK] Eb setter error:",e&&e.message); }
  })();
  installPGSetter();
  installgGSetter();

  // 3) uzun süreli poll
  (function poll(){
    var tries=0, t=setInterval(function(){
      try{
        if(window.Eb && window.Eb.Runtime && window.Eb.Runtime._gjpnPatched){ clearInterval(t); return; }
        if(window.PG && window.PG.EventVariable && window.PG.EventVariable._createPatched &&
           window.gG && window.gG.EventSheet && window.gG.EventSheet._createVarPatched){ clearInterval(t); return; }
      }catch(_){}
      if(++tries>600){ clearInterval(t); serr("[C3-HOOK] patch timeout"); }
    },50);
  })();

  window.addEventListener("unhandledrejection",function(e){
    var m=(e&&e.reason&&e.reason.message)||(e&&e.reason)||e; serr("[C3-HOOK] unhandledrejection",m);
  });
  window.addEventListener("error",function(e){
    serr("[C3-HOOK] window.error",e&&e.message,e&&e.filename,e&&e.lineno);
  });
})();

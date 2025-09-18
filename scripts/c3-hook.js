(function(){
  // ---- mini overlay + log helpers ----
  var overlay=null;
  function show(msg){
    try{
      if(!overlay){
        overlay=document.createElement("div");
        overlay.style.cssText="position:fixed;left:8px;bottom:8px;max-width:92%;max-height:42%;overflow:auto;background:rgba(0,0,0,.85);color:#0f0;font:12px/1.4 monospace;z-index:1000000;padding:8px;border:1px solid #0f0;border-radius:8px";
        document.addEventListener("DOMContentLoaded",function(){document.body.appendChild(overlay);});
      }
      var d=document.createElement("div");
      d.textContent="["+new Date().toISOString().slice(11,19)+"] "+msg;
      overlay.appendChild(d);
      if(overlay.childNodes.length>500) overlay.removeChild(overlay.firstChild);
      overlay.scrollTop=overlay.scrollHeight;
    }catch(_){}
  }
  function slog(){ try{ console.log.apply(console, arguments); show(Array.prototype.join.call(arguments," ")); }catch(_){} }
  function serr(){ try{ console.error.apply(console, arguments); show(Array.prototype.join.call(arguments," ")); }catch(_){ } }

  // ---- güvenli ad üretici ----
  function toSafeName(s){
    try{
      if(s==null) return "_ev";
      s=String(s);
      var map={"ğ":"g","":"G","ş":"s","Ş":"S","ı":"i","":"I","ö":"o","Ö":"O","ç":"c","Ç":"C","ü":"u","Ü":"U"};
      s=s.replace(/[ğşŞıöÖçÇüÜ]/g,function(c){return map[c]||c;});
      s=s.replace(/[^A-Za-z0-9_$]/g,"_");
      if(/^[0-9]/.test(s)) s="_"+s;
      return s || "_ev";
    }catch(_){ return "_ev"; }
  }

  // ---- sarmalayıcı (GetJsPropName için fallback döndürür) ----
  function wrapWithFallback(fn, tag){
    if(typeof fn!=="function") return fn;
    if(fn.__c3hookWrapped) return fn;
    function wrapped(){
      try{ return fn.apply(this, arguments); }
      catch(e){
        var orig = (arguments && arguments.length ? arguments[0] : "(none)");
        var safe = toSafeName(orig);
        serr("[C3-HOOK] "+tag+" ERROR -> fallback:", JSON.stringify(orig),"⇒",safe,"msg=",(e&&e.message)||e);
        return safe;
      }
    }
    try{ Object.defineProperty(wrapped,"name",{value:(fn.name||"gpn")+"_wrapped"}); }catch(_){}
    wrapped.__c3hookWrapped = true;
    return wrapped;
  }

  // ---- Telegram yardımcıları (gerekirse payload için) ----
  function TG(){ return (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null; }
  function qsFromUnsafe(u){
    if(!u) return "";
    var pairs=[], push=(k,v)=>{ if(v!==undefined && v!==null && v!=="") pairs.push([k,String(v)]) };
    push("auth_date",u.auth_date);
    push("chat_instance",u.chat_instance);
    push("chat_type",(u.chat&&u.chat.type)||u.chat_type);
    push("query_id",u.query_id);
    push("start_param",u.start_param);
    push("can_send_after",u.can_send_after);
    if(u.user){ try{ push("user", JSON.stringify(u.user)); }catch(e){} }
    push("hash",u.hash);
    pairs.sort((a,b)=>a[0].localeCompare(b[0]));
    var sp=new URLSearchParams(); pairs.forEach(([k,v])=>sp.append(k,v));
    return sp.toString();
  }
  function buildCtx(){
    var t=TG(), init = t&&t.initData || "", unsafe = t&&t.initDataUnsafe || null;
    if(!init && unsafe) init = qsFromUnsafe(unsafe);
    return { init:init, unsafe:unsafe };
  }

  // ---- Eb.Runtime.GetJsPropName kancaları ----
  function hookGetJsPropNameAll(){
    var hooked=false;
    try{
      if(window.Eb && window.Eb.Runtime){
        // static
        if(typeof window.Eb.Runtime.GetJsPropName==="function" && !window.Eb.Runtime.GetJsPropName.__c3hookWrapped){
          window.Eb.Runtime.GetJsPropName = wrapWithFallback(window.Eb.Runtime.GetJsPropName, "GetJsPropName(static)");
          slog("[C3-HOOK] Hooked Eb.Runtime.GetJsPropName (static)");
          hooked=true;
        }
        // prototype (instance)
        if(window.Eb.Runtime.prototype && typeof window.Eb.Runtime.prototype.GetJsPropName==="function" && !window.Eb.Runtime.prototype.GetJsPropName.__c3hookWrapped){
          window.Eb.Runtime.prototype.GetJsPropName = wrapWithFallback(window.Eb.Runtime.prototype.GetJsPropName, "GetJsPropName(proto)");
          slog("[C3-HOOK] Hooked Eb.Runtime.prototype.GetJsPropName");
          hooked=true;
        }
      }
    }catch(e){ serr("[C3-HOOK] hookGetJsPropNameAll error", e); }
    return hooked;
  }

  // ---- EventVariable.Create sanitize ----
  function hookEventVariableCreate(){
    var ok=false;
    try{
      var cand = [ (window.PG && PG.EventVariable), (window.gG && gG.EventVariable) ].filter(Boolean);
      for(var i=0;i<cand.length;i++){
        var EvVar=cand[i];
        if(EvVar && EvVar.prototype && typeof EvVar.prototype.Create==="function" && !EvVar.prototype.__evHooked){
          (function(E){
            var orig=E.prototype.Create;
            E.prototype.Create=function(){
              try{
                var old=(this && (this.n!=null?this.n:this.name)) || "(unknown)";
                var safe=toSafeName(old);
                if(old!==safe){ try{ this.n=safe; }catch(_){}
                                 try{ this.name=safe; }catch(_){}
                  slog("[C3-HOOK] sanitized EventVariable:", JSON.stringify(old),"⇒",safe);
                }
              }catch(err){ serr("[C3-HOOK] EventVariable.Create sanitize err",err); }
              return orig.apply(this, arguments);
            };
            E.prototype.__evHooked=true;
            slog("[C3-HOOK] Hooked EventVariable.Create");
            ok=true;
          })(EvVar);
        }
      }
    }catch(e){ /* ignore */ }
    return ok;
  }

  // ---- Güvenli tarama (yalnızca "value" tipindeki fonksiyonları, getter yok) ----
  var visited=new WeakSet();
  function safeScan(obj, depth, label){
    var count=0;
    try{
      (function walk(o, d){
        if(!o || (typeof o!=="object" && typeof o!=="function")) return;
        if(visited.has(o)) return; visited.add(o);
        if(d<=0) return;

        var names=[]; try{ names=Object.getOwnPropertyNames(o); }catch(_){ return; }
        for(var i=0;i<names.length;i++){
          var k=names[i];
          var desc; try{ desc=Object.getOwnPropertyDescriptor(o,k); }catch(_){ continue; }
          // yalnızca data property ve function
          if(!desc || !("value" in desc)) continue;
          var v=desc.value;
          if(typeof v==="function"){
            var looks = /GetJsPropName/i.test(k);
            if(looks && !v.__c3hookWrapped){
              try{
                var w=wrapWithFallback(v, "GetJsPropName(scan:"+k+")");
                Object.defineProperty(o,k,{configurable:true,writable:true,value:w});
                slog("[C3-HOOK] Hooked by scan:", k, "on", (o&&o.constructor&&o.constructor.name)||label||"obj");
                count++;
              }catch(e){ serr("[C3-HOOK] scan hook fail", k, e); }
            }
          }
          // altına in (sadece plain object/function — DOM protolarına bulaşma)
          try{
            if(v && (typeof v==="object" || typeof v==="function")){
              var ctor=(v&&v.constructor&&v.constructor.name)||"";
              if(ctor==="Object" || ctor==="Function" || ctor==="" ){
                walk(v, d-1);
              }
            }
          }catch(_){}
        }
      })(obj, depth||3);
    }catch(_){}
    return count;
  }

  // ---- Eb sonradan atanırsa tekrar dene ----
  try{
    var __Eb = window.Eb;
    Object.defineProperty(window,"Eb",{configurable:true,enumerable:true,
      get(){ return __Eb; },
      set(v){ __Eb=v; hookGetJsPropNameAll(); }
    });
    slog("[C3-HOOK] window.Eb setter installed");
  }catch(e){ serr("[C3-HOOK] defineProperty(Eb) failed", e); }

  // ---- periyodik: önce direkt hook, sonra güvenli scan, sonra EventVariable ----
  var tries=0, timer=setInterval(function(){
    var a = hookGetJsPropNameAll();
    var b = 0;
    try{
      // sadece güvenli kökler
      if(window.PG) b += safeScan(window.PG, 3, "PG");
      if(window.gG) b += safeScan(window.gG, 3, "gG");
      if(window.Eb) b += safeScan(window.Eb, 3, "Eb");
      // window’u çok derine indirmeyelim
      b += safeScan(window, 1, "window");
    }catch(_){}
    var c = hookEventVariableCreate();

    if((a||b||c) && ++tries>60) clearInterval(timer);
  }, 120);

  // ---- global hata logları ----
  window.addEventListener("unhandledrejection", function(e){
    serr("[C3-HOOK] unhandledrejection", (e && (e.reason && e.reason.message)) || (e && e.reason) || e);
  });
  window.addEventListener("error", function(e){
    serr("[C3-HOOK] window.error", e && e.message, e && e.filename, e && e.lineno);
  });

  // ---- submitScore fallback (değiştirmiyoruz, lazım olursa) ----
  if (typeof window.submitScore !== "function") {
    window.submitScore = async function(score){
      try{
        if(!Number.isFinite(score) || score<0) throw new Error("Invalid score");
        var ctx=buildCtx();
        var user_id=null, username=null, auth_date=null, hash=null;
        try{
          var p=new URLSearchParams(ctx.init||"");
          var us=p.get("user"); if(us){ try{us=JSON.parse(us); user_id=us&&us.id||null; username=us&&us.username||null;}catch(_){ } }
          auth_date=p.get("auth_date"); hash=p.get("hash");
        }catch(_){}
        var payload={ score:Math.floor(score), user_id:user_id, username:username, sig:hash, auth_date:auth_date, init_data:(ctx.init||"") };
        var r=await fetch("/api/score",{method:"POST",headers:{"Content-Type":"application/json","X-Telegram-Init-Data":(ctx.init||"")},body:JSON.stringify(payload),credentials:"include"});
        var t=""; try{ t=await r.text(); }catch(_){}
        slog("[C3-HOOK] submitScore ->", r.status, t);
      }catch(e){ serr("[C3-HOOK] submitScore error", e); }
    };
  }
})();

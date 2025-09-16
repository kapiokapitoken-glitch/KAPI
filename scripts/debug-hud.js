(function(){
  function mkLogBox(){
    var box=document.createElement("div");
    box.id="dbgHud";
    box.style.cssText="position:fixed;right:8px;top:8px;z-index:999999;background:rgba(0,0,0,0.85);color:#0f0;font:12px/1.4 monospace;width:92%;max-width:680px;height:42%;min-height:160px;border:1px solid #0f0;border-radius:8px;display:none;overflow:auto;padding:8px;box-sizing:border-box;";
    document.addEventListener("DOMContentLoaded",function(){document.body.appendChild(box);});
    return box;
  }
  var box = mkLogBox();
  function log(){ try{
    var s = Array.prototype.map.call(arguments, function(a){ try{return typeof a==="string"?a:JSON.stringify(a);}catch(e){return String(a);} }).join(" ");
    var d=document.createElement("div"); d.textContent="["+new Date().toISOString().slice(11,19)+"] "+s;
    box.appendChild(d); if(box.childNodes.length>400) box.removeChild(box.firstChild); box.scrollTop=box.scrollHeight;
  }catch(e){} }

  // Toolbar
  var bar=document.createElement("div"); bar.style.cssText="position:fixed;right:8px;top:8px;z-index:1000000;display:flex;gap:6px;";
  function btn(t,fn){var b=document.createElement("button"); b.textContent=t; b.style.cssText="padding:6px 10px;border-radius:6px;border:1px solid #333;background:#222;color:#fff;"; b.onclick=fn; return b;}
  var bDbg = btn("DBG", function(){ box.style.display = (box.style.display==="none"?"block":"none"); });
  var b123 = btn("send 123", function(){ if(typeof window.submitScore==="function"){ window.submitScore(123); log("submitScore(123) called"); } else { log("submitScore not found"); } });
  var bProbe = btn("probe core", async function(){
    async function probe(u){ try{ var r=await fetch(u,{cache:"no-store"}); log("PROBE", u, "->", r.status); }catch(e){ log("PROBE", u, "ERR", e); } }
    await probe("/scripts/main.js"); await probe("/data.json");
  });
  document.addEventListener("DOMContentLoaded",function(){ bar.appendChild(bDbg); bar.appendChild(b123); bar.appendChild(bProbe); document.body.appendChild(bar); });

  // Console & error hooks
  ["log","warn","error"].forEach(function(k){ var o=console[k]; console[k]=function(){ try{ log("console."+k+":", ...arguments); }catch(e){} o.apply(console,arguments); }; });
  window.addEventListener("error", function(e){ log("window.error:", e.message||e.error||e); });
  window.addEventListener("unhandledrejection", function(e){
    var r=e && (e.reason||{}); try{ log("unhandledrejection:", (r&&r.message)||r, (r&&r.stack)||""); }catch(_){ log("unhandledrejection:", r); }
  });

  // Bütün fetch’leri logla
  if (window.fetch){
    var _f = window.fetch.bind(window);
    window.fetch = async function(input, init){
      var url = (typeof input==="string") ? input : (input && (input.url||String(input)));
      var t0 = (typeof performance!=="undefined" && performance.now) ? performance.now() : Date.now();
      try{
        var resp = await _f(input, init);
        var t1 = (typeof performance!=="undefined" && performance.now) ? performance.now() : Date.now();
        var ms = Math.round(t1 - t0);
        if (!/debug-hud\.js/.test(url)) log("FETCH", url, "->", resp.status, (resp.statusText||""), ms+"ms");
        return resp;
      }catch(e){
        log("FETCH ERR", url, e && (e.message||e));
        throw e;
      }
    };
  }

  // === C3 Runtime Name Sanitizer Patch ===
  (function installNamePatch(){
    var reserved = new Set(["break","case","catch","class","const","continue","debugger","default","delete","do","else","export","extends","finally","for","function","if","import","in","instanceof","new","return","super","switch","this","throw","try","typeof","var","void","while","with","yield","let","enum","await","implements","package","protected","interface","private","public","static"]);
    function foldTr(s){
      if(!s) return s;
      return s.replace(/[şŞğıçÇöÖüÜ]/g, function(ch){
        return ({'ş':'s','Ş':'S','ğ':'g','':'G','ı':'i','':'I','ç':'c','Ç':'C','ö':'o','Ö':'O','ü':'u','Ü':'U'})[ch] || ch;
      });
    }
    function sanitize(name){
      var orig = String(name==null?"":name);
      var x = foldTr(orig);
      x = x.replace(/[^\x00-\x7F]/g, "_");          // ASCII dışı -> _
      x = x.replace(/[^A-Za-z0-9_]/g, "_");          // geçersiz -> _
      if (!/^[A-Za-z_]/.test(x)) x = "_"+x;          // başta harf/_ şart
      x = x.replace(/_+/g, "_").replace(/^_+$/,"_v");// stabilize
      if (reserved.has(x)) x = "_"+x;                // rezerve kelime
      if (x !== orig) console.warn("[C3 NAME SANITIZED]", orig, "=>", x);
      return x;
    }
    function tryPatch(){
      try{
        if(!(window.Eb && window.Eb.Runtime)) return false;
        var R = window.Eb.Runtime;
        var patched = 0;

        // prototype üzerinde varsa onu patchle
        if (R.prototype && typeof R.prototype.GetJsPropName === "function" && !R.prototype.__patched_sanitize__) {
          var o = R.prototype.GetJsPropName;
          R.prototype.GetJsPropName = function(name){ return sanitize(name); };
          R.prototype.__patched_sanitize__ = true;
          patched++;
        }
        // sınıf üstünde de varsa onu patchle (bazı build'lerde static olabilir)
        if (typeof R.GetJsPropName === "function" && !R.__patched_sanitize__) {
          var o2 = R.GetJsPropName;
          R.GetJsPropName = function(name){ return sanitize(name); };
          R.__patched_sanitize__ = true;
          patched++;
        }
        if (patched>0){ console.log("[HUD] GetJsPropName patched x"+patched); return true; }
      }catch(e){}
      return false;
    }
    var n=0, timer=setInterval(function(){
      if (tryPatch() || ++n>100){ clearInterval(timer); }
    }, 100);
  })();

  // lk boot probeleri
  (async function boot(){
    log("BOOT: start");
    try{ var r1=await fetch("/scripts/main.js",{cache:"no-store"}); log("BOOT main.js ->", r1.status); }catch(e){ log("BOOT main.js ERR",e); }
    try{ var r2=await fetch("/data.json",{cache:"no-store"}); log("BOOT data.json ->", r2.status); }catch(e){ log("BOOT data.json ERR",e); }
  })();
})();

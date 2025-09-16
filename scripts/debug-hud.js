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

  // Toggle bar
  var bar=document.createElement("div"); bar.style.cssText="position:fixed;right:8px;top:8px;z-index:1000000;display:flex;gap:6px;";
  function btn(t,fn){var b=document.createElement("button"); b.textContent=t; b.style.cssText="padding:6px 10px;border-radius:6px;border:1px solid #333;background:#222;color:#fff;"; b.onclick=fn; return b;}
  var bDbg = btn("DBG", function(){ box.style.display = (box.style.display==="none"?"block":"none"); });
  var b123 = btn("send 123", function(){ if(typeof window.submitScore==="function"){ window.submitScore(123); log("submitScore(123) called"); } else { log("submitScore not found"); } });
  var bProbe = btn("probe", async function(){
    async function probe(u){ try{ var r=await fetch(u,{cache:"no-store"}); log("PROBE", u, "->", r.status); }catch(e){ log("PROBE", u, "ERR", e); } }
    await probe("/scripts/main.js"); await probe("/data.json");
  });
  document.addEventListener("DOMContentLoaded",function(){ bar.appendChild(bDbg); bar.appendChild(b123); bar.appendChild(bProbe); document.body.appendChild(bar); });

  // Console & error hooks
  ["log","warn","error"].forEach(function(k){ var o=console[k]; console[k]=function(){ try{ log("console."+k+":", ...arguments); }catch(e){} o.apply(console,arguments); }; });
  window.addEventListener("error", function(e){ log("window.error:", e.message||e.error||e); });
  window.addEventListener("unhandledrejection", function(e){ log("unhandledrejection:", e.reason||e); });

  // lk boot’ta kritik assetleri ölç
  (async function boot(){
    log("BOOT: start");
    try{ var r1=await fetch("/scripts/main.js",{cache:"no-store"}); log("BOOT main.js ->", r1.status); }catch(e){ log("BOOT main.js ERR",e); }
    try{ var r2=await fetch("/data.json",{cache:"no-store"}); log("BOOT data.json ->", r2.status); }catch(e){ log("BOOT data.json ERR",e); }
  })();
})();

(function(){
  var box=document.createElement("div");
  box.id="dbgHud";
  box.style.cssText="position:fixed;right:8px;top:8px;z-index:999999;background:rgba(0,0,0,0.85);color:#0f0;font:12px/1.4 monospace;width:90%;max-width:640px;height:40%;min-height:160px;border:1px solid #0f0;border-radius:8px;display:none;overflow:auto;padding:8px;box-sizing:border-box;";
  function log(t){var d=document.createElement("div");d.textContent="["+new Date().toISOString().slice(11,19)+"] "+t;box.appendChild(d);if(box.childNodes.length>400)box.removeChild(box.firstChild);box.scrollTop=box.scrollHeight;}
  document.addEventListener("DOMContentLoaded",function(){document.body.appendChild(box);});
  var bar=document.createElement("div");bar.style.cssText="position:fixed;right:8px;top:8px;z-index:1000000;display:flex;gap:6px;";
  var b=document.createElement("button");b.textContent="DBG";b.style.cssText="padding:6px 10px;border-radius:6px;border:1px solid #333;background:#222;color:#fff;";
  b.onclick=function(){box.style.display=(box.style.display==="none"?"block":"none");sessionStorage.setItem("__DBG",box.style.display);};
  var s=document.createElement("button");s.textContent="send 123";s.style.cssText=b.style.cssText;
  s.onclick=function(){if(typeof window.submitScore==="function"){window.submitScore(123);log("submitScore(123) called");}else{log("submitScore not found");}};
  document.addEventListener("DOMContentLoaded",function(){bar.appendChild(b);bar.appendChild(s);document.body.appendChild(bar);});
  ["log","warn","error"].forEach(function(k){var o=console[k];console[k]=function(){try{log("console."+k+": "+Array.prototype.map.call(arguments,function(a){try{return typeof a==="string"?a:JSON.stringify(a);}catch(e){return String(a);}}).join(" "));}catch(e){}o.apply(console,arguments);};});
  if(window.fetch){var f=window.fetch.bind(window);window.fetch=async function(){var args=arguments;try{var url=String(args[0]);var r=await f.apply(null,args);if(url.indexOf("/api/score")!==-1){var c=r.clone();var t="";try{t=await c.text();}catch(e){}log("score -> status "+r.status+" body: "+(t||"<empty>"));}return r;}catch(e){log("fetch error: "+e);throw e;}};}
  if(location.hash.indexOf("debug")!==-1||sessionStorage.getItem("__DBG")==="block"){box.style.display="block";}
})();

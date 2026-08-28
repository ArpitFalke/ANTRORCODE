// Reproduce VibeForge/ANTROR Code preview pipeline in Node with the mock project files.
const fs = require('fs');

// ── exact copies from app.js ──
const SHIM =
 '<script>(function(){try{window.localStorage.getItem("__t")}catch(e){var m={};try{Object.defineProperty(window,"localStorage",{value:{getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]!=null?Object.keys(m)[i]:null},get length(){return Object.keys(m).length}}})catch(e2){}}})();</script>' +
 '<script>(function(){var send=function(t){try{parent.postMessage({__vfc:1,text:String(t).slice(0,500)},"*")}catch(e){}};' +
 'window.onerror=function(m,s,l){send("⛔ "+m+" @ "+(s||"inline")+":"+l)};' +
 'var oe=console.error;console.error=function(){try{var a=[].map.call(arguments,function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}});send("console.error: "+a.join(" "))}catch(_){ }oe.apply(console,arguments)};' +
 'window.addEventListener("unhandledrejection",function(ev){send("Promise rejected: "+(ev.reason&&ev.reason.message||ev.reason))});})();<\/script>';

function resolveLocal(ref, files){
  if(!ref || /^(https?:|data:|blob:|#|mailto:|\/\/)/i.test(ref)) return null;
  const p = ref.replace(/^\.\//,'').split('?')[0].split('#')[0];
  return Object.prototype.hasOwnProperty.call(files, p) ? p : null;
}
function guardClose(s){ return s.replace(/<\/(script|style)/gi, '<\\/$1'); }

function buildPreviewDoc(files){
  let html = files['index.html'];
  if(html == null) return null;
  html = html.replace(/<link\b[^>]*>/gi,(tag)=>{
    const m = tag.match(/href=["']([^"']+)["']/i);
    const rel = tag.match(/rel=["']([^"']+)["']/i);
    if(rel && !/stylesheet/i.test(rel[1])) return tag;
    const loc = m && resolveLocal(m[1], files);
    if(loc == null) return tag;
    return '<style>\n'+guardClose(files[loc])+'\n</style>';
  });
  html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi,(tag,src)=>{
    const loc = resolveLocal(src, files);
    if(loc == null) return tag;
    return '<script>\n'+guardClose(files[loc])+'\n<\/script>';
  });
  html = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi,(m,a,src,z)=>{
    const loc = resolveLocal(src, files);
    if(loc == null) return m;
    if(/^data:/i.test(files[loc])) return m;
    if(/\.svg$/i.test(loc)) return a+'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(files[loc])+z;
    return m;
  });
  if(/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, (m)=>m+SHIM);
  else html = SHIM + html;
  return html;
}
// ── end copies ──

// mock files exactly as test/mock-llm.js produces them
const mockSrc = fs.readFileSync(__dirname + '/mock-llm.js', 'utf8');
// eval the template literals by extracting them
function grab(name){
  const re = new RegExp('const ' + name + ' = `([\\s\\S]*?)`;');
  const m = mockSrc.match(re);
  if(!m) throw new Error('cannot extract ' + name);
  return m[1].replace(/\\`/g,'`').replace(/\\\$\{/g,'${').replace(/<\\\//g,'</');
}
const files = { 'index.html': grab('html'), 'style.css': grab('css') };
console.log('── file sizes:', Object.entries(files).map(([p,c])=>p+'='+c.length+'B').join(' '));
console.log('── index.html contains </html>?', files['index.html'].includes('</html>'));
console.log('── index.html contains <\\/script artifact?', files['index.html'].includes('<\\/script'));
console.log('── index.html raw ──\n' + files['index.html'].slice(0,400) + '\n');

const doc = buildPreviewDoc(files);
console.log('── built doc length:', doc == null ? 'null' : doc.length);
console.log('── built doc head ──\n' + doc.slice(0, 900) + '\n');
console.log('── built doc has <body content?', doc.includes('<div class="glow">'));
console.log('── built doc has inlined css?', doc.includes('--') && doc.includes('glow'));
const openScripts = (doc.match(/<script/g)||[]).length, closeScripts = (doc.match(/<\/script>/g)||[]).length;
console.log('── <script> balance: open=' + openScripts + ' close=' + closeScripts);
const openStyles = (doc.match(/<style>/g)||[]).length, closeStyles = (doc.match(/<\/style>/g)||[]).length;
console.log('── <style> balance: open=' + openStyles + ' close=' + closeStyles);

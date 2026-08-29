/* ════════════════════════════════════════════════════════════════
   ANTROR Code — describe it. ship it.
   A browser-only AI coding studio. A product by ANTROR.
   Keys live in your localStorage. Calls go straight to providers.
   ════════════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────── tiny utils ─────────────── */
const $id = (x) => document.getElementById(x);
const esc = (s) => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const debounce = (fn, ms) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmtBytes = (n) => n<1024 ? n+' B' : (n/1024).toFixed(1)+' KB';
const linesOf = (s) => s.split('\n').length;
const nowTs = () => Date.now();
const fmtTime = (ts) => new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});

/* navigate between pages — clean URLs on the live site, .html on plain local servers */
function go(page){
  // desktop app: navigate via the main process — no file:// URL quirks possible
  if(window.antrorAPI){ window.antrorAPI.goPage(page); return; }
  if(location.protocol==='file:'){ location.href=page+'.html'; return; }
  location.href='/'+page;
}

/* preview column appears only when there is something to show (first prompt / files) */
function syncPristine(open){
  // opening old content via a user action → show the preview; otherwise chat-only
  const has=(state.chat && state.chat.length) || Object.keys(state.project.files||{}).length;
  const pristine = open===true ? false : (open===false ? true : !has);
  document.body.classList.toggle('pristine',pristine);
  const ce=$id('chatEmpty'); if(ce) ce.hidden = !pristine || (state.chat && state.chat.length>0);
}

/* pending image attachments (tray chips → assets/ on send) */
let pendingAttach=[];
function renderAttachTray(){
  const tray=$id('attachTray'); if(!tray) return;
  tray.innerHTML='';
  tray.hidden=!pendingAttach.length;
  pendingAttach.forEach((a,i)=>{
    const chip=document.createElement('div'); chip.className='atchip';
    chip.innerHTML='<img src="'+a.dataUrl+'" alt="" /><span>'+esc(a.name)+'</span>';
    const x=document.createElement('button'); x.textContent='✕'; x.title='Remove';
    x.addEventListener('click',()=>{ pendingAttach.splice(i,1); renderAttachTray(); });
    chip.appendChild(x); tray.appendChild(chip);
  });
}

function toast(msg, kind='', ms=3400){
  const box = $id('toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(), 350); }, ms);
}
function downloadBlob(name, blob){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}

/* ─────────────── persistence ─────────────── */
const LS = { s:'vf.v1.settings', p:'vf.v1.project', c:'vf.v1.chat', h:'vf.v1.checkpoints', pr:'vf.v1.projects', u:'vf.v1.usage', t:'vf.v1.tasks' };
const loadJSON=(k,d)=>{ try{ const v=localStorage.getItem(k); return v==null ? d : JSON.parse(v);}catch(e){ return d; } };
let quotaWarned=false;
function save(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }
  catch(e){ if(!quotaWarned){ quotaWarned=true; toast('⚠ Browser storage is full — export your project as ZIP to be safe.', 'err', 6000);} } }

/* ─────────────── state ───────────────
   Multi-project: state.project is the project currently open.
   Every project (incl. chat + files) is kept in state.projects so you
   can switch between them without ever erasing your running work. */
function migrateProjects(){
  let list = loadJSON(LS.pr, null);
  if(list && Array.isArray(list)) return list;
  // first run of the multi-project era: wrap the legacy single project
  const legacy = loadJSON(LS.p, null);
  const legacyChat = loadJSON(LS.c, []);
  if(legacy && legacy.files && Object.keys(legacy.files).length){
    list = [{ id:'p'+nowTs(), name:legacy.name||'untitled', files:legacy.files, chat:legacyChat.slice(-30), updatedAt:nowTs(), cloudId:null }];
  } else list = [];
  return list;
}
const state = {
  settings: loadJSON(LS.s, { onboarded:false, provider:'zai', keys:{}, models:{}, bases:{} }),
  project:  loadJSON(LS.p, { name:'untitled', files:{} }),
  chat:     loadJSON(LS.c, []),
  checkpoints: loadJSON(LS.h, []),
  projects: migrateProjects(),
  usage: loadJSON(LS.u, { req:0, tin:0, tout:0, prov:{}, day:{} }),
  tasks: loadJSON(LS.t, {}),
  ui: { tabs:[], open:null, view:'preview', busy:false, chatSticky:true, phoneW:false },
};
function usageAdd(pid, tin, tout){
  const u=state.usage;
  const day=new Date().toISOString().slice(0,10);
  u.req=(u.req||0)+1; u.tin=(u.tin||0)+tin; u.tout=(u.tout||0)+tout;
  u.prov=u.prov||{}; u.day=u.day||{};
  const p=u.prov[pid]=u.prov[pid]||{req:0,tin:0,tout:0};
  p.req++; p.tin+=tin; p.tout+=tout;
  const d=u.day[day]=u.day[day]||{req:0,tin:0,tout:0};
  d.req++; d.tin+=tin; d.tout+=tout;
  // keep only the last 30 days
  const days=Object.keys(u.day).sort();
  while(days.length>30) delete u.day[days.shift()];
  save(LS.u, u);
}
const saveSettings = () => save(LS.s, state.settings);
const saveProject  = () => save(LS.p, state.project);
const saveChat     = () => save(LS.c, state.chat.slice(-30));
const saveChecks   = () => save(LS.h, state.checkpoints);
const saveProjects = () => save(LS.pr, state.projects);

function persistCurrentProject(){
  if(!state.project.id){
    // adopt into list (or reuse matching legacy entry)
    const existing = state.projects.find(p=>p.name===state.project.name && p.id);
    state.project.id = existing ? existing.id : 'p'+nowTs()+Math.floor(Math.random()*99);
    state.project.cloudId = existing ? (existing.cloudId||null) : null;
    state.project.updatedAt = nowTs();
  }
  state.project.chat = state.chat.slice(-30);
  state.project.updatedAt = nowTs();
  const i = state.projects.findIndex(p=>p.id===state.project.id);
  if(i>=0) state.projects[i] = { id:state.project.id, cloudId:state.project.cloudId||null, name:state.project.name, files:state.project.files, chat:state.project.chat, updatedAt:state.project.updatedAt };
  else state.projects.push({ id:state.project.id, cloudId:state.project.cloudId||null, name:state.project.name, files:state.project.files, chat:state.project.chat, updatedAt:state.project.updatedAt });
  state.projects.sort((a,b)=>b.updatedAt-a.updatedAt);
  while(state.projects.length>24) state.projects.pop(); // keep storage sane
  saveProjects(); saveProject(); saveChat();
}
function blankProject(name){
  return { id:'p'+nowTs()+Math.floor(Math.random()*99), name:name||('untitled-'+Math.floor(Math.random()*90+10)), files:{}, chat:[], updatedAt:nowTs(), cloudId:null };
}

/* ─────────────── providers ─────────────── */
const PROVIDERS = {
  zai:       { label:'Z.ai · GLM',      desc:'GLM-4.x — excellent coding-per-dollar',            kind:'openai',
               base:'https://api.z.ai/api/paas/v4',                    model:'glm-4.6',          keyUrl:'https://z.ai/manage-apikey/apikey-list' },
  anthropic: { label:'Anthropic · Claude', desc:'Claude Sonnet / Opus — top-tier coding',        kind:'anthropic',
               base:'https://api.anthropic.com',                       model:'claude-sonnet-4-5', keyUrl:'https://console.anthropic.com/settings/keys' },
  openai:    { label:'OpenAI · GPT',    desc:'GPT-5 / Codex family (chat completions)',           kind:'openai',
               base:'https://api.openai.com/v1',                       model:'gpt-5',            keyUrl:'https://platform.openai.com/api-keys' },
  openrouter:{ label:'OpenRouter',      desc:'One key → hundreds of models, some free',           kind:'openai',
               base:'https://openrouter.ai/api/v1',                    model:'z-ai/glm-4.6',     keyUrl:'https://openrouter.ai/settings/keys' },
  gemini:    { label:'Google · Gemini', desc:'Gemini 2.5 Pro / Flash — generous free tier',       kind:'gemini',
               base:'https://generativelanguage.googleapis.com/v1beta', model:'gemini-2.5-flash', keyUrl:'https://aistudio.google.com/app/apikey' },
  groq:      { label:'Groq',            desc:'Llama & friends at silly speeds',                   kind:'openai',
               base:'https://api.groq.com/openai/v1',                  model:'llama-3.3-70b-versatile', keyUrl:'https://console.groq.com/keys' },
  nvidia:    { label:'NVIDIA NIM',      desc:'Llama · Nemotron · DeepSeek · Qwen — free credits',  kind:'openai',
               base:'https://integrate.api.nvidia.com/v1',             model:'meta/llama-3.3-70b-instruct', keyUrl:'https://build.nvidia.com' },
  ollama:    { label:'Ollama · local',  desc:'Free & private — run “ollama serve” first',         kind:'openai', noKey:true,
               base:'http://localhost:11434/v1',                       model:'qwen2.5-coder:7b', keyUrl:'' },
  custom:    { label:'Custom endpoint', desc:'Any OpenAI-compatible URL (LM Studio, proxy…)',     kind:'openai', noKey:true,
               base:'',                                                model:'',                 keyUrl:'' },
};
const PROV_ORDER = ['zai','anthropic','openai','openrouter','gemini','groq','nvidia','ollama','custom'];

/* ── build modes (premium composer picker) ── */
const THINK_LABEL={off:'Off',low:'Low',medium:'Medium',max:'Max'};
const THINK_LVL={low:{a:4096,g:4096,o:'low'},medium:{a:8192,g:8192,o:'medium'},max:{a:16384,g:24576,o:'high'}};
const MODES={
  web: { icon:'🌐', label:'Web app',
    hint:'Sites, dashboards and tools — clean vanilla HTML/CSS/JS.',
    sys:'CURRENT MODE: WEB APP. Build polished, responsive single-page web apps with vanilla HTML/CSS/JS.' },
  full:{ icon:'🧩', label:'Full-stack',
    hint:'Frontend + backend — Node/Express API, data layer, README with run steps.',
    sys:'CURRENT MODE: FULL-STACK APP. Build the frontend (index.html/style.css/app.js) AND a real backend: server.js (Node + Express), a data layer (db.js — in-memory with JSON-file persistence), and package.json with a start script and dependencies listed. The frontend must still run standalone in the preview: wrap every fetch in try/catch and fall back to built-in demo data when the API is unreachable. Add a README.md with exact run steps (npm install && node server.js). Visually mark which parts are backend-only.' },
  game:{ icon:'🎮', label:'Game',
    hint:'Canvas games with juice — physics, particles, sound, touch + keys.',
    sys:'CURRENT MODE: GAME. Build a complete, immediately playable browser game: index.html + game.js + style.css using <canvas> and a 60fps requestAnimationFrame loop. Include real game feel: acceleration/friction physics, particles, screen shake, hit flashes, easing, procedural sound via WebAudio (no external files), keyboard AND touch controls, score with best-score saved locally, pause and game-over/restart flow. Polish the visuals with gradients, glow and clean typography. It must run by just opening index.html.' },
};
const MODE_ORDER=['web','full','game'];

/* ── context window sizes (rough, per provider) ── */
const CTX_LIMIT={zai:128000,anthropic:200000,openai:400000,openrouter:128000,gemini:1000000,groq:128000,nvidia:128000,ollama:32768,custom:128000};
const est=(t)=>Math.ceil(String(t||'').length/4);
function fmtK(n){ return n>=1000 ? Math.round(n/1000)+'k' : String(n); }
function ctxLimit(){ return CTX_LIMIT[activeProviderId()] || 128000; }
function updateCtxPill(total){
  const lim=ctxLimit(); const t=Math.min(total||0,lim);
  const fill=$id('ctxFill'), txt=$id('ctxText');
  if(fill){ fill.style.width=Math.max(2,Math.min(100,Math.round(t/lim*100)))+'%';
    fill.style.background = t/lim>0.85 ? 'var(--err)' : '#e8e8e8'; }
  if(txt) txt.textContent=fmtK(t)+' / '+fmtK(lim);
}
function ctxOfConversation(extra){
  let t=est(buildSystem())+est((MODES[state.settings.mode]||MODES.web).sys)+est(extra||'');
  state.chat.forEach(m=>{ t+=est(m.display ?? m.text ?? ''); });
  return t;
}

/* ── tasks: every AI run is a task ── */
function taskList(){
  const id=state.project.id||'local';
  if(!state.tasks[id]) state.tasks[id]=[];
  return state.tasks[id];
}
function saveTasks(){ save(LS.t, state.tasks); }
function taskAdd(label){
  const t={ id:'t'+nowTs()+Math.floor(Math.random()*99), t:nowTs(), label:String(label).slice(0,80), status:'running', dur:0, files:0, add:0, del:0, changed:[] };
  const L=taskList(); L.unshift(t); while(L.length>25) L.pop();
  saveTasks(); return t;
}
function taskDone(task, status, dur, dsum){
  task.status=status; task.dur=dur;
  let a=0,d=0,n=0; Object.keys(dsum||{}).forEach(p=>{ n++; a+=dsum[p].added; d+=dsum[p].removed; task.changed.push(p); });
  task.files=n; task.add=a; task.del=d;
  saveTasks();
}
function timeAgo(ts){ const s=Math.round((nowTs()-ts)/1000); if(s<60)return s+'s ago'; const m=Math.floor(s/60); if(m<60)return m+'m ago'; const h=Math.floor(m/60); if(h<24)return h+'h ago'; return Math.floor(h/24)+'d ago'; }
function renderTasks(){
  const list=$id('tasksList'); if(!list) return;
  const L=taskList();
  list.innerHTML='';
  if(!L.length){ list.innerHTML='<div class="hist-empty">No tasks yet — every AI run appears here with its status and diff stats.</div>'; return; }
  const ICON={running:'<span class="ts-run">⏳</span>', done:'<span class="ts-ok">✓</span>', stopped:'<span class="ts-stop">⏹</span>', error:'<span class="ts-err">⚠</span>'};
  L.forEach(t=>{
    const d=document.createElement('div'); d.className='taskitem'+(t.status==='running'?' run':'');
    const st = t.status==='done' ? '<span class="da">+'+t.add+'</span> <span class="dr">−'+t.del+'</span> · '+t.files+' file'+(t.files===1?'':'s')
             : t.status==='running' ? 'running…' : t.status;
    d.innerHTML=ICON[t.status]+'<span class="htxt"><span class="hl">'+esc(t.label)+'</span>'+
      '<span class="hd">'+st+' · '+fmtTime(t.t)+' · '+timeAgo(t.t)+(t.dur?' · took '+(t.dur<60000?Math.round(t.dur/1000)+'s':Math.round(t.dur/60000)+'m'):'')+'</span></span>';
    if(t.changed && t.changed.length){
      d.style.cursor='pointer';
      d.title='Open '+t.changed[0];
      d.addEventListener('click',()=>{ if(state.project.files[t.changed[0]]!=null) openInEditor(t.changed[0]); $id('tasksDrawer').hidden=true; });
    }
    list.appendChild(d);
  });
}

function activeProviderId(){ return state.settings.provider || 'zai'; }
function activeConfig(){
  const id = activeProviderId();
  const P = PROVIDERS[id] || PROVIDERS.zai;
  return {
    id, kind:P.kind, noKey:!!P.noKey,
    base : state.settings.bases[id] ?? P.base,
    model: state.settings.models[id] ?? P.model,
    key  : state.settings.keys[id] ?? '',
  };
}
function configFromUI(){
  const id = state.ui.pickProv || activeProviderId();
  const P = PROVIDERS[id];
  const baseVal  = $id('baseInput').value.trim();
  const modelVal = $id('modelInput').value.trim();
  return {
    id, kind:P.kind, noKey:!!P.noKey,
    base : baseVal || P.base,
    model: modelVal || P.model,
    key  : $id('keyInput').value.trim(),
  };
}

/* ─────────────── system prompt ─────────────── */
const VIBE_SYSTEM = [
'You are ANTROR Code, an AI pair programmer for "vibe coders" — people who describe what they want in plain language and expect working software back.',
'',
'HOW TO OUTPUT CODE (very important):',
'- Every time you create or change a file, output the COMPLETE file inside these exact tags:',
'<file path="index.html">',
'(full file content)',
'</file>',
'- One block per file. Paths are relative to the project root, plain filenames like "index.html", "style.css", "js/app.js". Never use absolute paths or "../".',
'- Always rewrite the whole file, even for tiny changes. No diffs, no "...rest unchanged" comments.',
'- Every web project MUST have an entry point called index.html.',
'- Default to clean vanilla HTML/CSS/JS. CDN imports are fine; frameworks/build-tools only if explicitly asked. Everything must run in the browser with zero install steps.',
'- Prefer compact-but-polished code: nice colors, spacing, hover states, mobile-friendly. Vibe coders love something that feels finished.',
'- Do not invent binary assets; use emoji, CSS art, gradients, or SVG you write yourself.',
'',
'HOW TO TALK:',
'- After any code blocks, add a SHORT friendly explanation of what you built/changed and how to try it. Plain language, minimal jargon.',
'- If a request is vague, make tasteful assumptions and briefly say what you assumed instead of asking many questions.',
'- No filler, no apologies, exactly one best version of the solution.',
].join('\n');

function buildSystem(){
  let sys=VIBE_SYSTEM;
  const P=state.settings.plugins||{};
  if(P.tailwind) sys+='\n\nPLUGIN — TAILWIND: Style everything with Tailwind CSS via <script src="https://cdn.tailwindcss.com"></script> and utility classes; keep a <style> block only for custom keyframes.';
  if(P.motion) sys+='\n\nPLUGIN — MOTION: Add tasteful life to the UI — transitions on every interactive element, keyframe entrances, scroll reveals, micro-interactions. Smooth, never gimmicky.';
  if(P.seo) sys+='\n\nPLUGIN — SEO: Include complete meta tags (description, Open Graph, Twitter card), semantic HTML5 landmarks and descriptive page titles.';
  if(P.strictjs) sys+='\n\nPLUGIN — STRICT JS: Write modern strict-mode JavaScript — no globals, small pure functions, defensive error handling, meaningful names.';
  (state.settings.skills||[]).filter(s=>s.on).forEach(sk=>{ sys+='\n\nSKILL — '+sk.name+':\n'+sk.text; });
  (state.settings.mcp||[]).filter(m=>m.on).forEach(m=>{ sys+='\n\nMCP SERVER CONNECTED — "'+m.name+'" ('+m.url+'). When the user asks for something this server provides, explain how you would call it and provide the exact request.'; });
  return sys;
}

function manifestBlock(){
  const files = state.project.files;
  const paths = Object.keys(files);
  if(!paths.length) return 'CURRENT PROJECT: completely empty. This is the first turn — scaffold every file the app needs.';
  let out='CURRENT PROJECT FILES:\n';
  let total=0; paths.forEach(p=>total+=files[p].length);
  if(total<=30000){
    paths.forEach(p=>{ out += `\n----- ${p} -----\n${files[p]}\n`; });
    out += '(These are the full current sources — modify them directly.)';
  }else{
    paths.forEach(p=>{ out += `- ${p} (${fmtBytes(files[p].length)})\n`; });
    out += '(Project is large: you see the inventory only. Rewrite whole files confidently from context.)';
  }
  return out;
}
function buildMessages(){
  const convo = state.chat
    .filter(m => m.role==='user' || m.role==='assistant')
    .slice(-14)
    .map(m=>{
      let t = m.display ?? m.text ?? '';
      if(t.length>9000) t = t.slice(0,9000)+'\n…[trimmed]';
      return { role:m.role, text:t };
    });
  return convo;
}

/* ─────────────── virtual filesystem ─────────────── */
function sanitizePath(p){
  p = String(p||'').trim().replace(/^\.?\//,'').replace(/\\/g,'/');
  if(!p || p.includes('..') || p.startsWith('/')) return null;
  return p;
}
function applyFile(rawPath, content){
  const path = sanitizePath(rawPath);
  if(!path){ toast('⚠ The AI tried to write an invalid path: '+rawPath, 'err'); return null; }
  state.project.files[path] = String(content).replace(/\r\n/g,'\n').replace(/^\n+/,'').replace(/\s+$/,'\n');
  return path;
}
function fileIcon(p){
  const e = p.split('.').pop().toLowerCase();
  return ({html:'🌐',css:'🎨',js:'⚡',mjs:'⚡',json:'🧾',md:'📖',svg:'🖼',txt:'📄'})[e] || '📄';
}
function renderTree(){
  const tree = $id('fileTree'); tree.innerHTML='';
  if(!Object.keys(state.project.files).length){
    const e=document.createElement('div'); e.className='tree-empty';
    e.innerHTML='<span>📁</span> No files yet — they appear as the AI builds';
    tree.appendChild(e); return;
  }
  const paths = Object.keys(state.project.files).sort((a,b)=>{
    const d=(x)=>x.includes('/')?1:0;
    return d(a)-d(b) || a.localeCompare(b);
  });
  paths.forEach(p=>{
    const b=document.createElement('div');
    b.className='fitem'+(p===state.ui.open?' active':'');
    b.title=p;
    b.innerHTML=`<span class="ic">${fileIcon(p)}</span><span>${esc(p)}</span>`;
    b.addEventListener('click',()=>{ openInEditor(p); });
    tree.appendChild(b);
  });
}

/* ─────────────── preview builder ─────────────── */
const SHIM =
 '<script>(function(){try{window.localStorage.getItem("__t")}catch(e){var m={};try{Object.defineProperty(window,"localStorage",{value:{getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]!=null?Object.keys(m)[i]:null},get length(){return Object.keys(m).length}}})catch(e2){}}})();</script>' +
 '<script>(function(){var send=function(t){try{parent.postMessage({__vfc:1,text:String(t).slice(0,500)},"*")}catch(e){}};' +
 'window.onerror=function(m,s,l){send("⛔ "+m+" @ "+(s||"inline")+":"+l)};' +
 'var oe=console.error;console.error=function(){try{var a=[].map.call(arguments,function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}});send("console.error: "+a.join(" "))}catch(_){ }oe.apply(console,arguments)};' +
 'window.addEventListener("unhandledrejection",function(ev){send("Promise rejected: "+(ev.reason&&ev.reason.message||ev.reason))});})();<\/script>';

function resolveLocal(ref){
  if(!ref || /^(https?:|data:|blob:|#|mailto:|\/\/)/i.test(ref)) return null;
  const p = ref.replace(/^\.\//,'').split('?')[0].split('#')[0];
  return Object.prototype.hasOwnProperty.call(state.project.files, p) ? p : null;
}
function guardClose(s){ return s.replace(/<\/(script|style)/gi, '<\\/$1'); }

function buildPreviewDoc(){
  const files = state.project.files;
  let html = files['index.html'];
  if(html == null) return null;

  // inline local stylesheets
  html = html.replace(/<link\b[^>]*>/gi,(tag)=>{
    const m = tag.match(/href=["']([^"']+)["']/i);
    const rel = tag.match(/rel=["']([^"']+)["']/i);
    if(rel && !/stylesheet/i.test(rel[1])) return tag;
    const loc = m && resolveLocal(m[1]);
    if(loc == null) return tag;
    return '<style>\n'+guardClose(files[loc])+'\n</style>';
  });
  // inline local scripts
  html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi,(tag,src)=>{
    const loc = resolveLocal(src);
    if(loc == null) return tag;
    return '<script>\n'+guardClose(files[loc])+'\n<\/script>';
  });
  // local svg images → data uri
  html = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi,(m,a,src,z)=>{
    const loc = resolveLocal(src);
    if(loc == null) return m;
    if(/^data:/i.test(files[loc])) return m;
    if(/\.svg$/i.test(loc)) return a+'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(files[loc])+z;
    return m;
  });

  if(/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, (m)=>m+SHIM);
  else html = SHIM + html;
  return html;
}
let consErrors=[];
function refreshPreview(){
  const oldFrame=$id('previewFrame'), empty=$id('previewEmpty');
  consErrors=[]; updConsBadge();
  const doc = buildPreviewDoc();
  if(doc==null){ oldFrame.removeAttribute('srcdoc'); empty.hidden=false; }
  else {
    empty.hidden=true;
    // swap in a fresh iframe so every run gets a clean document (avoids stale
    // compositor/state on repeated srcdoc swaps)
    const fresh = oldFrame.cloneNode(false);
    oldFrame.replaceWith(fresh);
    fresh.srcdoc = doc;
  }
}
const refreshSoon = debounce(()=>refreshPreview(), 650);
window.addEventListener('message',(e)=>{
  const d=e.data;
  if(d && d.__antrorSettings===1 && e.source!==window){ location.reload(); return; }
  if(d && d.__vfc===1 && e.source && e.source !== window){
    consErrors.push(d.text); if(consErrors.length>30) consErrors.shift();
    updConsBadge();
  }
});
function updConsBadge(){
  const b=$id('consBadgeBtn');
  $id('consCount').textContent = consErrors.length;
  b.hidden = consErrors.length===0;
}

/* ─────────────── editor ─────────────── */
const edSave = debounce(()=>{ saveProject(); }, 700);
function renderTabs(){
  const row=$id('tabsRow'); row.innerHTML='';
  state.ui.tabs.forEach(p=>{
    const t=document.createElement('div');
    t.className='tab'+(p===state.ui.open?' active':'');
    t.innerHTML=`<span>${fileIcon(p)}</span><span>${esc(p)}</span>`;
    const x=document.createElement('span');
    x.className='tclose'; x.textContent='✕'; x.title='Close tab (file stays)';
    x.addEventListener('click',(ev)=>{ ev.stopPropagation(); closeTab(p); });
    t.appendChild(x);
    t.addEventListener('click',()=>{ state.ui.open=p; renderTabs(); loadEditor(); showView('code'); });
    row.appendChild(t);
  });
}
function closeTab(p){
  state.ui.tabs = state.ui.tabs.filter(x=>x!==p);
  if(state.ui.open===p){ state.ui.open = state.ui.tabs[state.ui.tabs.length-1] || null; loadEditor(); }
  renderTabs(); if(!state.ui.open) showView('preview');
}
function openInEditor(p){
  if(!state.ui.tabs.includes(p)) state.ui.tabs.push(p);
  state.ui.open=p; renderTabs(); loadEditor(); showView('code');
}
function loadEditor(){
  const ta=$id('codeEditor'), g=$id('gutter');
  if(state.ui.open==null){ ta.value=''; ta.disabled=true; }
  else { ta.disabled=false; ta.value = state.project.files[state.ui.open] ?? ''; }
  syncGutter(); updEdStatus();
}
function syncGutter(){
  const ta=$id('codeEditor'), g=$id('gutter');
  const n=Math.max(1, ta.value.split('\n').length);
  let s=''; for(let i=1;i<=n;i++) s+=i+'\n';
  g.textContent=s; g.scrollTop=ta.scrollTop;
}
function updEdStatus(){
  const ta=$id('codeEditor');
  $id('edPath').textContent = state.ui.open==null ? 'no file open' : state.ui.open;
  $id('edMeta').textContent = state.ui.open==null ? '' :
    `${linesOf(ta.value)} lines · ${fmtBytes(new Blob([ta.value]).size)}`;
}
function bindEditor(){
  const ta=$id('codeEditor');
  ta.addEventListener('input',()=>{
    if(state.ui.open==null) return;
    state.project.files[state.ui.open]=ta.value;
    syncGutter(); updEdStatus(); refreshSoon(); edSave();
    renderTreeSoon();
  });
  ta.addEventListener('scroll',()=>{ $id('gutter').scrollTop=ta.scrollTop; });
  ta.addEventListener('keydown',(e)=>{
    if(e.key==='Tab'){ e.preventDefault();
      const s=ta.selectionStart,epos=ta.selectionEnd;
      ta.value=ta.value.slice(0,s)+'  '+ta.value.slice(epos);
      ta.selectionStart=ta.selectionEnd=s+2;
      ta.dispatchEvent(new Event('input'));
    }
  });
}
const renderTreeSoon = debounce(renderTree, 300);

/* stage views */
function showView(v){
  state.ui.view=v;
  $id('segPreview').classList.toggle('active', v==='preview');
  $id('segCode').classList.toggle('active', v==='code');
  $id('previewWrap').hidden = v!=='preview';
  $id('editorWrap').hidden  = v!=='code';
  if(v==='preview') refreshPreview();
}

/* ─────────────── chat rendering ─────────────── */
function chatNearBottom(){
  const l=$id('chatLog');
  return l.scrollHeight - l.scrollTop - l.clientHeight < 70;
}
function scrollChat(force){
  const l=$id('chatLog');
  if(force) state.ui.chatSticky=true;
  if(state.ui.chatSticky) l.scrollTop=l.scrollHeight;
  $id('jumpLatest').hidden = chatNearBottom();
}
function bindChatScroll(){
  const l=$id('chatLog');
  l.addEventListener('scroll',()=>{
    const near=chatNearBottom();
    state.ui.chatSticky=near;
    $id('jumpLatest').hidden=near;
  },{passive:true});
  $id('jumpLatest').addEventListener('click',()=>scrollChat(true));
}

function addUserMsg(text){
  const m=document.createElement('div'); m.className='msg user';
  m.innerHTML=`<span class="who">you</span>`;
  const b=document.createElement('div'); b.className='bubble'; b.textContent=text;
  b.title='Click to edit & resend';
  b.addEventListener('click',()=>{
    const tb=$id('promptBox');
    tb.value=text.replace(/\n\n\(attached images[^)]*\)$/,''); autoGrow();
    tb.focus(); tb.setSelectionRange(tb.value.length,tb.value.length);
  });
  m.appendChild(b); $id('chatLog').appendChild(m); scrollChat(true);
}
function newAiMsg(){
  const m=document.createElement('div'); m.className='msg ai stream';
  m.innerHTML=`<span class="who aiwho"><img src="assets/logo.png" alt="" /> antror code</span>`;
  const b=document.createElement('div'); b.className='bubble';
  const sp=document.createElement('span'); sp.className='stxt';
  const caret=document.createElement('span'); caret.className='caret';
  b.appendChild(sp); b.appendChild(caret);
  m.appendChild(b); $id('chatLog').appendChild(m); scrollChat(true);
  return { root:m, txt:sp, caret, bubble:b };
}
function fcard(root, path, n, delta){
  let wrap=root.querySelector('.fcards');
  if(!wrap){ wrap=document.createElement('div'); wrap.className='fcards'; root.appendChild(wrap); }
  const c=document.createElement('div'); c.className='fcard';
  const badge = delta ? ` · <b class="da">+${delta.added}</b> <b class="dr">−${delta.removed}</b>` : '';
  c.innerHTML=`📄 <b>${esc(path)}</b><span class="ln">${n} lines${badge}</span>`;
  c.addEventListener('click',()=>{ if(delta) openDiff(path); else openInEditor(path); });
  wrap.appendChild(c); scrollChat();
}
function errorCard(msgRoot, html){
  const c=document.createElement('div'); c.className='errcard'; c.innerHTML=html;
  msgRoot.root.appendChild(c); scrollChat();
}

/* markdown-lite (safe: escapes first) */
function renderRich(md){
  let s=esc(md);
  const store=[];
  s=s.replace(/```(\w*)\n([\s\S]*?)```/g,(m,lang,code)=>{
    store.push(`<pre><code>${code.replace(/\n$/,'')}</code></pre>`); return '\u0000B'+(store.length-1)+'\u0000';
  });
  s=s.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  s=s.replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>');
  s=s.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h2>$1</h2>');
  const lines=s.split('\n'); const out=[]; let ul=false;
  for(const ln of lines){
    const li=ln.match(/^\s*[-•*] (.*)$/);
    if(li){ if(!ul){out.push('<ul>');ul=true;} out.push('<li>'+li[1]+'</li>'); }
    else{
      if(ul){out.push('</ul>');ul=false;}
      if(/^\s*$/.test(ln)) continue;
      out.push(ln.startsWith('<h')||ln.startsWith('<pre')||ln.startsWith('\u0000') ? ln : '<p>'+ln+'</p>');
    }
  }
  if(ul)out.push('</ul>');
  s=out.join('');
  s=s.replace(/\u0000B(\d+)\u0000/g,(m,i)=>store[+i]);
  return s;
}

/* ─────────────── provider adapters / SSE ─────────────── */
function joinUrl(base, path){ return base.replace(/\/+$/,'') + path; }

/* reasoning ("thinking") — uses each provider's native parameter */
function thinkParams(cfg){
  const lvl = state.settings.thinking ?? 'medium';
  if(lvl==='off') return { body:{}, pickThinking:null };
  const L = THINK_LVL[lvl] || THINK_LVL.medium;
  if(cfg.kind==='anthropic') return {
    body:{ thinking:{ type:'enabled', budget_tokens: L.a } },
    pickThinking:(j)=> j.type==='content_block_delta' && j.delta?.type==='thinking' ? (j.delta.thinking||'') : '',
  };
  if(cfg.kind==='gemini') return {
    body:{ generationConfig:{ thinkingConfig:{ thinkingBudget: L.g } } },
    pickThinking:(j)=>{ const c=j?.candidates?.[0]; if(!c?.content?.parts) return '';
      return c.content.parts.filter(p=>p.thought).map(p=>p.text||'').join(''); },
  };
  // OpenAI-compatible family
  let body={};
  if(cfg.id==='zai') body={ thinking:{ type:'enabled' } };                       // GLM-4.x native
  else if(cfg.id==='openai') body={ reasoning_effort: L.o };                     // GPT-5 / o-series
  else if(cfg.id==='openrouter') body={ reasoning:{ effort: L.o } };
  return { body, pickThinking:(j)=> j.choices?.[0]?.delta?.reasoning_content || j.choices?.[0]?.delta?.reasoning || '' };
}

function makeAdapter(cfg, msgs, sys, opts={}){
  const th = thinkParams(cfg);
  if(cfg.kind==='anthropic'){
    const maxTok = (opts.maxTokens??16000) + ((th.body.thinking?.budget_tokens)||0);
    return {
      url: joinUrl(cfg.base,'/v1/messages'),
      headers:{
        'x-api-key':cfg.key,
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true',
      },
      body:Object.assign({
        model:cfg.model, max_tokens:maxTok, stream:true, system:sys,
        messages: msgs.map(m=>({role:m.role, content:[{type:'text',text:m.text}]})),
      }, th.body),
      pickThinking: th.pickThinking,
      usagePick(j){
        if(j.type==='message_start') return { in: j.message?.usage?.input_tokens ?? null, out: null };
        if(j.type==='message_delta') return { out: j.usage?.output_tokens ?? null };
        return null;
      },
      pick(j){
        if(j.type==='error') throw new Error(j.error?.message||'API error');
        if(j.type==='content_block_delta') return j.delta?.text||'';
        return '';
      },
    };
  }
  if(cfg.kind==='gemini'){
    return {
      url: joinUrl(cfg.base, `/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`),
      headers:{ 'x-goog-api-key':cfg.key },
      body:Object.assign({
        systemInstruction:{parts:[{text:sys}]},
        contents: msgs.map(m=>({role: m.role==='assistant'?'model':'user', parts:[{text:m.text}]})),
      }, th.body),
      pickThinking: th.pickThinking,
      usagePick(j){
        const u=j?.usageMetadata;
        return u ? { in: u.promptTokenCount ?? null, out: u.candidatesTokenCount ?? null } : null;
      },
      pick(j){
        const c=j?.candidates?.[0];
        if(j.promptFeedback?.blockReason) throw new Error('Blocked by safety filter: '+j.promptFeedback.blockReason);
        if(!c?.content?.parts) return '';
        return c.content.parts.map(p=>p.thought?'':(p.text||'')).join('');
      },
    };
  }
  // default: OpenAI-compatible chat completions
  return {
    url: joinUrl(cfg.base,'/chat/completions'),
    headers: cfg.key ? {'Authorization':'Bearer '+cfg.key} : {},
    body:Object.assign({
      model:cfg.model, stream:true,
      messages:[{role:'system',content:sys}, ...msgs.map(m=>({role:m.role,content:m.text}))],
    }, th.body),
    pickThinking: th.pickThinking,
    usagePick(j){
      const u=j?.usage;
      return u ? { in: u.prompt_tokens ?? null, out: u.completion_tokens ?? null } : null;
    },
    pick(j){
      if(j.error) throw new Error(j.error.message||String(j.error));
      return j.choices?.[0]?.delta?.content || j.choices?.[0]?.text || '';
    },
  };
}
async function sseStream(adt, signal, onDelta, onThinking){
  const res = await fetch(adt.url,{
    method:'POST',
    headers:Object.assign({'Content-Type':'application/json'}, adt.headers),
    body:JSON.stringify(adt.body), signal,
  });
  if(!res.ok){
    let detail='';
    try{ const j=await res.json(); detail=j?.error?.message||j?.message||(typeof j?.error==='string'?j.error:JSON.stringify(j).slice(0,300)); }
    catch(e){ try{ detail=(await res.text()).slice(0,300);}catch(e2){} }
    const err=new Error(`HTTP ${res.status}${detail?' — '+detail:''}`);
    err.status=res.status; throw err;
  }
  const reader=res.body.getReader(); const dec=new TextDecoder();
  let buf='', out='';
  while(true){
    const {done,value}=await reader.read();
    if(done) break;
    buf+=dec.decode(value,{stream:true});
    let nl;
    while((nl=buf.indexOf('\n'))>=0){
      const line=buf.slice(0,nl).trim(); buf=buf.slice(nl+1);
      if(!line.startsWith('data:')) continue;
      const data=line.slice(5).trim();
      if(data==='[DONE]') return out;
      let j; try{ j=JSON.parse(data); }catch(e){ continue; }
      const piece = adt.pick(j) || '';
      if(piece){ out+=piece; if(onDelta) onDelta(piece); }
      if(onThinking && adt.pickThinking){
        const th = adt.pickThinking(j);
        if(th) onThinking(th);
      }
      if(adt.usagePick){
        const u=adt.usagePick(j);
        if(u && (u.in!=null || u.out!=null)){
          adt.__usage = adt.__usage || { in:0, out:0 };
          if(u.in!=null) adt.__usage.in=u.in;    // cumulative fields overwrite
          if(u.out!=null) adt.__usage.out=u.out;
        }
      }
    }
  }
  return out;
}
async function probe(cfg){
  const adt=makeAdapter(cfg,[{role:'user',text:'Reply with exactly: ok'}],'You are a connection test.',{maxTokens:16});
  const r=await sseStream(adt,null);
  return r.trim();
}
function friendlyError(err, cfg){
  const P=PROVIDERS[cfg.id]; const link=P.keyUrl?` Get a key: <a href="${P.keyUrl}" target="_blank" rel="noopener">${P.keyUrl}</a>.`:'';
  if(err.name==='AbortError') return '<b>Stopped.</b>';
  const m=String(err.message||err);
  if(err instanceof TypeError && /fetch/i.test(m))
    return `<b>Could not reach ${esc(P.label)}.</b> This is usually a network/CORS block:<br>
      • check the Base URL (<code>${esc(cfg.base)}</code>)<br>
      • some providers don't allow direct browser calls — <b>OpenRouter</b>, <b>Groq</b>, <b>Gemini</b> and <b>Ollama</b> are known to work<br>
      • or point Base URL at your own proxy`;
  if(err.status===401||err.status===403) return `<b>Key rejected (${err.status}).</b> Double-check your API key.${link}`;
  if(err.status===404) return `<b>Not found (404).</b> The model “<code>${esc(cfg.model)}</code>” may not exist — edit the model name in ⚙ settings.${link}`;
  if(err.status===429) return `<b>Rate limited / quota (429).</b> Wait a bit or check your plan balance.${link}`;
  if(err.status>=500) return `<b>${esc(P.label)} server error (${err.status}).</b> Try again shortly.<br><code>${esc(m.slice(0,240))}</code>`;
  return `<b>Request failed:</b> <code>${esc(m.slice(0,300))}</code>${link}`;
}

/* ─────────────── send pipeline ─────────────── */
let controller=null;

function ensureConfigured(){
  const cfg=activeConfig();
  if(cfg.id==='custom' && !cfg.base){ toast('Add your endpoint URL first','err'); openSettings(); return null; }
  if(!cfg.noKey && !cfg.key){ toast('Paste an API key first — opening settings ✦','err'); openSettings(); return null; }
  return cfg;
}
function pushCheckpoint(label){
  state.checkpoints.push({t:nowTs(),label:String(label).slice(0,80),files:clone(state.project.files)});
  while(state.checkpoints.length>20) state.checkpoints.shift();
  saveChecks();
}

function stripTags(s){
  s=s.replace(/<file\s[\s\S]*?<\/file>/g,'');
  const i=s.indexOf('<file'); if(i>=0)s=s.slice(0,i);
  return s;
}
function extractWritten(raw, written){
  const re=/<file\s+path\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/file>/g;
  let mm, fresh=[];
  while((mm=re.exec(raw))!==null){
    const p=applyFile(mm[1],mm[2]);
    if(p && !written.find(w=>w.path===p)){
      const entry={path:p, lines:linesOf(state.project.files[p])};
      written.push(entry); fresh.push(entry);
    }
  }
  return fresh;
}
let lastScrollT=0;
function softScroll(){ const n=performance.now(); if(n-lastScrollT>140){ lastScrollT=n; scrollChat(); } }

async function sendPrompt(rawText){
  if(state.ui.busy) return;
  const text=rawText.trim(); if(!text) return;
  const cfg=ensureConfigured(); if(!cfg) return;
  sendPrompt.lastPrompt=text;

  let sendText=text;
  if(pendingAttach.length){
    const names=[];
    for(const a of pendingAttach){ applyFile('assets/'+a.name, a.dataUrl); names.push('assets/'+a.name); }
    pendingAttach=[]; renderAttachTray();
    saveProject(); renderTree(); refreshPreview();
    sendText=text+'\n\n(attached images to use: '+names.join(', ')+')';
  }
  state.chat.push({role:'user',text:sendText,t:nowTs()});
  try{ localStorage.removeItem('vf.v1.draft'); }catch(e){}
  document.body.classList.remove('pristine');   // the preview takes its place from here on
  addUserMsg(text); saveChat();
  $id('promptBox').value=''; autoGrow();

  pushCheckpoint(text);
  const beforeFiles = clone(state.project.files);   // for the +/− diff after the run
  const runTask = taskAdd(text);                    // every run is a task
  const runStart = nowTs();
  const ui=newAiMsg();
  setBusy(true);
  controller=new AbortController();
  persistCurrentProject(); // user turn is never lost, even mid-run

  // live activity feed — what the AI is doing, visible before the full output
  const act=document.createElement('div'); act.className='activity';
  ui.root.insertBefore(act, ui.bubble);
  const actLine=(text, cls)=>{ const d=document.createElement('div'); d.className='actline '+(cls||''); d.textContent=text; act.appendChild(d); scrollChat(); return d; };

  let raw=''; let stopped=false; const written=[]; const carded=new Set();

  // working timer (like ZCode's "Working for 1m 28s")
  const t0=Date.now();
  const fmtDur=(ms)=>{ const sec=Math.round(ms/1000); return sec<60 ? sec+'s' : Math.floor(sec/60)+'m '+(sec%60)+'s'; };
  const timerEl=actLine('','live build');
  const timerPaint=()=>{ timerEl.innerHTML='<span class="eq"><i></i><i></i><i></i><i></i></span>Working for '+fmtDur(Date.now()-t0)+(written.length?' · '+written.length+' file'+(written.length===1?'':'s'):''); };
  timerPaint();
  const workTick=setInterval(timerPaint,900);
  const endTimer=(ok)=>{ clearInterval(workTick); timerEl.textContent=(ok?'✓ completed in ':'⚠ stopped after ')+fmtDur(Date.now()-t0); timerEl.className='actline'; };

  // live "thinking" line while the model reasons (replaced by real output)
  let thinkEl=null, thinkTxt='';
  const onThinking=(t)=>{
    thinkTxt+=t;
    if(!thinkEl){ thinkEl=actLine('','live think'); }
    thinkEl.innerHTML='<span class="spk">✦</span> Thinking · '+Math.max(1,Math.round(thinkTxt.length/4))+' tokens';
  };
  const onDelta=(chunk)=>{
    raw+=chunk;
    ui.txt.textContent = stripTags(raw);
    softScroll();
    const fresh=extractWritten(raw, written);   // files land (and preview refreshes) as they finish streaming
    if(fresh.length){
      renderTreeSoon(); refreshSoon();
      fresh.forEach(w=>{
        if(!carded.has(w.path)){ carded.add(w.path); fcard(ui.root,w.path,w.lines); }
        // live activity: what changed, where
        const before=beforeFiles[w.path];
        const d=lineDiff(before, state.project.files[w.path]);
        let badge='';
        if(d){ let a=0,r=0; d.forEach(l=>{if(l.t==='+')a++;else if(l.t==='-')r++;}); badge=` (+${a} −${r})`; }
        actLine('✎ '+w.path+' '+(before!=null?'':'new ')+badge,'ok');
      });
    }
    const ts=window.__vfTermSink; if(ts&&ts.delta) try{ts.delta(raw,written.length);}catch(e){}
  };
  const mode=MODES[state.settings.mode]||MODES.web;
  try{
    const sys=buildSystem()+'\n\n'+mode.sys+'\n\n=====\n'+manifestBlock();
    const msgs=buildMessages();
    const adt=makeAdapter(cfg,msgs,sys,{});
    await sseStream(adt,controller.signal,onDelta,onThinking);
    updateCtxPill(ctxOfConversation(mode.sys)+est(raw));
  }catch(err){
    if(err.name==='AbortError'){ stopped=true; }
    else{
      const disp=stripTags(raw);
      ui.txt.textContent=disp;
      finalizeBubble(ui,disp,written,stopped);
      state.chat.push({role:'assistant',display:disp,files:written.map(w=>w.path),error:true,t:nowTs()});
      saveChat(); saveProject(); renderTree(); persistCurrentProject();
      endTimer(false);
      taskDone(runTask,'error',nowTs()-runStart,null);
      errorCard(ui,friendlyError(err,cfg));
      const te=window.__vfTermSink; if(te&&te.error) try{te.error(err);}catch(e){}
      setBusy(false); return;
    }
  }

  const disp=stripTags(raw);
  extractWritten(raw, written);
  const dsum=diffSummary(beforeFiles, state.project.files);
  lastRunDiff={before:beforeFiles, after:clone(state.project.files)};
  endTimer(!stopped);
  taskDone(runTask, stopped?'stopped':(written.length||disp?'done':'done'), nowTs()-runStart, dsum);
  if(stopped && sendPrompt.lastPrompt && !$id('promptBox').value.trim()){
    $id('promptBox').value=sendPrompt.lastPrompt; autoGrow();
  }
  finalizeBubble(ui,disp,written,stopped,dsum,thinkTxt);
  // ZCode-style summary chip: how many lines added / removed + undo
  let nCh=0,add=0,del=0;
  Object.values(dsum||{}).forEach(v=>{ nCh++; add+=v.added; del+=v.removed; });
  if(nCh){
    const chip=document.createElement('div'); chip.className='changesum';
    chip.innerHTML='<span><b>'+nCh+' file'+(nCh>1?'s':'')+' changed</b></span>'+
      '<span class="da">+'+add+'</span><span class="dr">−'+del+'</span>';
    const undo=document.createElement('button'); undo.className='ghost'; undo.textContent='Undo';
    undo.addEventListener('click',()=>{
      pushCheckpoint('before undo');
      state.project.files=clone(beforeFiles); saveProject();
      state.ui.tabs=[]; state.ui.open=null; renderTabs(); loadEditor();
      renderTree(); showView('preview'); persistCurrentProject();
      lastRunDiff=null; chip.remove();
      toast('↩ Undid the last AI run — files restored','ok');
    });
    chip.appendChild(undo);
    act.insertBefore(chip, act.firstChild);
  }
  state.chat.push({role:'assistant',display:disp,files:written.map(w=>w.path),stopped,t:nowTs()});
  saveChat();
  saveProject(); renderTreeSoon(); persistCurrentProject();
  if(written.length) refreshPreview();
  // usage accounting (exact where the provider reports it, chars/4 estimate otherwise)
  const u=(typeof adt!=='undefined'&&adt&&adt.__usage)||{};
  usageAdd(cfg.id, u.in!=null?u.in:Math.round(text.length/4), u.out!=null?u.out:Math.round(raw.length/4));
  // auto-save the project to the device (desktop: native · browser: chosen folder)
  dsAutoSave();
  const td=window.__vfTermSink; if(td&&td.done) try{td.done(written);}catch(e){}
  setBusy(false);
}
function finalizeBubble(ui,disp,written,stopped,dsum,thinkTxt){
  ui.caret.remove(); ui.root.classList.remove('stream');
  ui.bubble.innerHTML = disp.trim() ? renderRich(disp) : '<p class="typeline">(no message — just code)</p>';
  if(thinkTxt && thinkTxt.trim()){
    const d=document.createElement('details'); d.className='thinkdetails';
    d.innerHTML='<summary>🧠 reasoning — '+Math.max(1,Math.round(thinkTxt.length/4))+' tokens</summary>';
    const body=document.createElement('div'); body.className='thinkbody'; body.textContent=thinkTxt.trim();
    d.appendChild(body);
    ui.root.insertBefore(d, ui.bubble);
  }
  written.forEach(w=>fcard(ui.root,w.path,w.lines,dsum?dsum[w.path]:null));
  if(stopped && (disp.trim()||written.length)){
    const note=document.createElement('div'); note.className='typeline'; note.textContent='⏹ stopped by you — partial work kept';
    ui.root.appendChild(note);
  }
  scrollChat();
}
function setBusy(b){
  state.ui.busy=b;
  $id('sendBtn').disabled=b;
  $id('stopBtn').hidden=!b;
  if(b) $id('chatPanel').classList.add('generating'); else $id('chatPanel').classList.remove('generating');
}

/* ─────────────── diff engine (what the AI added / removed) ─────────────── */
let lastRunDiff=null;

function lineDiff(aText,bText){
  const a=String(aText??'').split('\n'), b=String(bText??'').split('\n');
  const n=a.length, m=b.length;
  if(n*m>1200000) return null;                    // huge file — stats only
  const dp=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--)
    dp[i][j]= a[i]===b[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
  const out=[]; let i=0, j=0;
  while(i<n && j<m){
    if(a[i]===b[j]){ out.push({t:' ',s:a[i]}); i++; j++; }
    else if(dp[i+1][j] >= dp[i][j+1]){ out.push({t:'-',s:a[i]}); i++; }
    else { out.push({t:'+',s:b[j]}); j++; }
  }
  while(i<n) out.push({t:'-',s:a[i++]});
  while(j<m) out.push({t:'+',s:b[j++]});
  return out;
}
function diffSummary(beforeFiles, afterFiles){
  const paths=new Set([...Object.keys(beforeFiles||{}), ...Object.keys(afterFiles||{})]);
  const res={};
  paths.forEach(p=>{
    const a=beforeFiles?.[p], b=afterFiles?.[p];
    if(a===b) return;
    const d=lineDiff(a,b);
    if(!d){ res[p]={added:0,removed:0,big:true}; return; }
    let add=0, rem=0;
    d.forEach(l=>{ if(l.t==='+') add++; else if(l.t==='-') rem++; });
    res[p]={added:add,removed:rem,big:false};
  });
  return res;
}
function diffRuns(lines){                          // changes with 2 lines of context
  const keep=new Set();
  lines.forEach((l,idx)=>{ if(l.t!==' '){ for(let k=Math.max(0,idx-2);k<=Math.min(lines.length-1,idx+2);k++) keep.add(k); } });
  const out=[]; let last=-2;
  lines.forEach((l,idx)=>{
    if(!keep.has(idx)) return;
    if(idx-last>1) out.push({t:'…'});
    out.push(l); last=idx;
  });
  return out;
}
function openDiff(path){
  if(!lastRunDiff){ openInEditor(path); return; }
  const d=lineDiff(lastRunDiff.before[path], lastRunDiff.after[path]);
  if(!d){ openInEditor(path); return; }
  const runs=diffRuns(d);
  let add=0, rem=0; d.forEach(l=>{ if(l.t==='+') add++; else if(l.t==='-') rem++; });
  $id('diffTitle').innerHTML='📄 '+esc(path);
  $id('diffStats').innerHTML='<span class="da">+'+add+'</span> <span class="dr">−'+rem+'</span>';
  const body=$id('diffBody'); body.innerHTML='';
  runs.forEach(l=>{
    const r=document.createElement('div');
    if(l.t==='…'){ r.className='dl gap'; r.textContent='⋯'; }
    else{ r.className='dl '+l.t; r.textContent=(l.t===' '?' ':l.t)+l.s; }
    body.appendChild(r);
  });
  $id('diffOpenEditor').onclick=()=>{ $id('diffModal').hidden=true; openInEditor(path); };
  $id('diffModal').hidden=false;
}

/* ─────────────── checkpoints drawer ─────────────── */
function renderHistory(){
  const list=$id('histList'); list.innerHTML='';
  if(!state.checkpoints.length){ list.innerHTML='<div class="hist-empty">No checkpoints yet — they are captured before every AI run.</div>'; return; }
  [...state.checkpoints].reverse().forEach((cp)=>{
    const idx=state.checkpoints.indexOf(cp);
    const d=document.createElement('div'); d.className='hist-item';
    d.innerHTML=`<span>📦</span><span class="htxt"><span class="hl">${esc(cp.label||'(untitled run)')}</span>
      <span class="hd">${fmtTime(cp.t)} · ${Object.keys(cp.files).length} files</span></span>`;
    const btn=document.createElement('button'); btn.className='ghost'; btn.textContent='Restore';
    btn.addEventListener('click',()=>{
      if(!confirm('Restore this snapshot? Current files will be replaced (this creates a checkpoint first).')) return;
      pushCheckpoint('before restore');
      state.project.files=clone(cp.files);
      saveProject();
      state.ui.tabs=[]; state.ui.open=null; renderTabs(); loadEditor();
      renderTree(); showView('preview');
      $id('historyDrawer').hidden=true;
      toast('↩ Restored snapshot from '+fmtTime(cp.t),'ok');
    });
    d.appendChild(btn); list.appendChild(d);
  });
}

/* ─────────────── import existing folder ─────────────── */
const IMPORT_EXTS=['html','htm','css','js','mjs','cjs','jsx','ts','tsx','json','md','svg','txt','xml','yml','yaml','csv','webmanifest'];
function importFolder(){ $id('importInput').click(); }
async function handleImportFiles(fileList){
  const files=[...fileList]; if(!files.length) return;
  const root=((files[0].webkitRelativePath||'').split('/')[0]) || 'imported';
  const picked=[];
  for(const f of files){
    const rel=((f.webkitRelativePath||f.name).split('/').slice(1).join('/')) || f.name;
    const segs=rel.split('/');
    if(segs.some(s=>s==='.git'||s==='node_modules'||s.startsWith('.'))) continue;
    if(!IMPORT_EXTS.includes(rel.split('.').pop().toLowerCase())) continue;
    if(f.size>300000) continue;               // skip big/binary-ish files
    picked.push({f,rel});
    if(picked.length>=80) break;
  }
  if(!picked.length){ toast('No readable text files in that folder — binaries and dotfiles are skipped','err',5000); return; }
  if(!confirm('Import '+picked.length+' file(s) from “'+root+'” as a NEW project?\nYour current project is saved first — nothing is erased.')) return;
  persistCurrentProject();
  state.project=blankProject(root);
  state.chat=[]; $id('chatLog').innerHTML='';
  state.checkpoints=[]; saveChecks();
  state.ui.tabs=[]; state.ui.open=null;
  let n=0;
  for(const {f,rel} of picked){
    try{ state.project.files[rel]=await f.text(); n++; }catch(e){ /* unreadable — skip */ }
  }
  saveProject(); saveChat(); persistCurrentProject();
  renderAll(); restoreChatLog(); showView('preview'); syncPristine();
  setChatOpen(true);
  toast('📂 Imported '+n+' file(s) from “'+root+'” — ask the AI to change anything','ok');
}

/* ─────────────── chat panel collapse ─────────────── */
function setChatOpen(v){
  state.ui.chatOpen=v;
  document.body.classList.toggle('nochat',!v);
  if(v) $id('chatPanel').classList.add('open');   // mobile overlay variant
  $id('chatFab').title = v ? 'Chat with the ANTROR Assistant' : 'Show the chat panel';
}

/* ─────────────── device save: projects land on disk ─────────────── */
function idbSetDir(handle){
  return new Promise((res)=>{ try{
    const r=indexedDB.open('antror',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('kv');
    r.onsuccess=()=>{ const tx=r.result.transaction('kv','readwrite'); tx.objectStore('kv').put(handle,'dirhandle'); tx.oncomplete=res; };
    r.onerror=res;
  }catch(e){ res(); } });
}
function idbGetDir(){
  return new Promise((res)=>{ try{
    const r=indexedDB.open('antror',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('kv');
    r.onsuccess=()=>{ const g=r.result.transaction('kv').objectStore('kv').get('dirhandle'); g.onsuccess=()=>res(g.result||null); g.onerror=()=>res(null); };
    r.onerror=()=>res(null);
  }catch(e){ res(null); } });
}
async function webWriteFile(dirHandle, path, content){
  const parts=String(path).replace(/\\/g,'/').split('/').filter(p=>p && p!=='.' && p!=='..');
  const fname=parts.pop(); if(!fname) return;
  let d=dirHandle;
  for(const p of parts) d=await d.getDirectoryHandle(p,{create:true});
  const fh=await d.getFileHandle(fname,{create:true});
  const w=await fh.createWritable(); await w.write(String(content)); await w.close();
}
async function dsPickFolder(){
  if(window.antrorAPI){
    const dir=await window.antrorAPI.chooseWorkspace();
    if(dir) toast('📁 Projects will save inside '+dir,'ok');
    paintGeneralSettings();
    return;
  }
  if(!window.showDirectoryPicker){ toast('This browser can’t pick folders — use the desktop app, or Export ZIP','err',4500); return; }
  try{
    const h=await window.showDirectoryPicker({ mode:'readwrite' });
    state.ui.saveDirHandle=h;
    await idbSetDir(h);
    toast('📁 Projects auto-save into “'+(h.name||'chosen folder')+'/'+state.project.name+'” after every run','ok',4500);
    paintGeneralSettings();
  }catch(e){ /* user cancelled */ }
}
async function dsAutoSave(){
  if(state.settings.autoSaveDevice===false) return;
  const files=state.project.files;
  if(!files || !Object.keys(files).length) return;
  const name=state.project.name||'untitled';
  /* desktop app: native, silent, always */
  if(window.antrorAPI){
    try{ const r=await window.antrorAPI.writeProject(name, files);
      if(r && r.dir && !state.ui.saveToastShown){ toast('💾 Saved to '+r.dir,'ok',2600); }
      state.ui.saveToastShown=true;
    }catch(e){ /* silent */ }
    return;
  }
  /* browser: write into the folder the user picked once */
  const h=state.ui.saveDirHandle;
  if(!h) return;
  try{
    if(h.queryPermission && await h.queryPermission({mode:'readwrite'})!=='granted') return; // needs re-grant — wait for a click
    let count=0;
    for(const [p,c] of Object.entries(files)){ await webWriteFile(h, name+'/'+p, c); count++; }
    if(count && !state.ui.saveToastShown){ toast('💾 Saved '+count+' file(s) to your folder ('+h.name+')','ok',2400); }
    state.ui.saveToastShown=true;
  }catch(e){ /* silent */ }
}

/* ─────────────── zip export ─────────────── */
async function exportZip(){
  const paths=Object.keys(state.project.files);
  if(!paths.length){ toast('Nothing to export yet — describe something first ✦'); return; }
  const name=(state.project.name||'vibeforge-project').replace(/[^\w.-]+/g,'-');
  try{
    const mod=await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip=new mod.default();
    paths.forEach(p=>zip.file(p, state.project.files[p]));
    const blob=await zip.generateAsync({type:'blob'});
    downloadBlob(name+'.zip', blob);
    toast('⬇ Exported '+name+'.zip ('+paths.length+' files)','ok');
  }catch(e){
    toast('ZIP library unreachable (offline?) — downloading files individually instead','err',4500);
    paths.forEach((p,i)=>setTimeout(()=>downloadBlob(p.split('/').pop(),new Blob([state.project.files[p]],{type:'text/plain'})), i*250));
  }
}

/* ─────────────── samples ─────────────── */
const SAMPLES={
  landing:{
    name:'nebula-landing',
    files:{
      'index.html':`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nebula — ship ideas overnight</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <div class="logo">✦ Nebula</div>
  <nav><a href="#features">Features</a><a href="#pricing">Pricing</a><a class="cta" href="#">Start free</a></nav>
</header>
<section class="hero">
  <h1>Ship your idea<br><em>overnight.</em></h1>
  <p>The calm toolkit for people who build fast. No config. No ceremony. Just vibes.</p>
  <button class="big">Get started — it's free</button>
</section>
<section id="features" class="grid">
  <div class="card"><span>⚡</span><h3>Instant</h3><p>Zero setup, one command, done before your coffee cools.</p></div>
  <div class="card"><span>🌙</span><h3>Calm</h3><p>Sensible defaults so you can stay in flow for hours.</p></div>
  <div class="card"><span>🧩</span><h3>Composable</h3><p>Tiny pieces that snap together any way you like.</p></div>
</section>
<footer>made with ♥ for vibe coders</footer>
</body>
</html>`,
      'style.css':`*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0c0d18;color:#eceef8;line-height:1.6}
header{display:flex;justify-content:space-between;align-items:center;padding:22px 7vw}
.logo{font-weight:800;font-size:19px;color:#fff}
nav a{color:#9aa0bd;text-decoration:none;margin-left:26px;font-size:14px}
nav a:hover{color:#fff}
nav .cta{background:linear-gradient(135deg,#a78bfa,#f472b6);padding:9px 18px;border-radius:99px;color:#fff;font-weight:700}
.hero{text-align:center;padding:12vh 6vw 9vh;background:radial-gradient(600px 320px at 50% 0%,rgba(167,139,250,.22),transparent)}
.hero h1{font-size:clamp(38px,6vw,64px);line-height:1.08;letter-spacing:-1px}
.hero em{font-style:normal;background:linear-gradient(135deg,#a78bfa,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{color:#9aa0bd;max-width:430px;margin:20px auto 30px}
.big{border:none;cursor:pointer;background:linear-gradient(135deg,#a78bfa,#f472b6);color:#fff;font-weight:800;font-size:16px;padding:15px 34px;border-radius:14px;transition:.2s}
.big:hover{transform:translateY(-3px);box-shadow:0 14px 34px rgba(167,139,250,.4)}
.grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));padding:4vh 7vw 8vh}
.card{background:#141628;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:26px;transition:.2s}
.card:hover{transform:translateY(-4px);border-color:rgba(167,139,250,.45)}
.card span{font-size:26px}
.card h3{margin:10px 0 6px}
.card p{color:#9aa0bd;font-size:14px}
footer{text-align:center;color:#565b78;padding:26px}`
    }
  },
  todo:{
    name:'tiny-todo',
    files:{
      'index.html':`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tiny todo</title>
<style>
  body{font-family:system-ui,sans-serif;background:#101120;color:#eef;margin:0;display:flex;justify-content:center;padding-top:9vh}
  .app{width:min(480px,92vw)}
  h1{letter-spacing:-.5px}
  form{display:flex;gap:8px;margin:18px 0}
  input{flex:1;padding:13px 15px;border-radius:12px;border:1px solid #2c2f4d;background:#171932;color:#eef;font-size:15px;outline:none}
  input:focus{border-color:#a78bfa}
  button{cursor:pointer;border:none;border-radius:12px;background:linear-gradient(135deg,#a78bfa,#f472b6);color:#fff;font-weight:800;padding:0 20px}
  ul{list-style:none;padding:0}
  li{display:flex;align-items:center;gap:11px;background:#171932;border:1px solid #232647;border-radius:12px;padding:12px 15px;margin-bottom:8px}
  li.done span.t{text-decoration:line-through;color:#666c92}
  li span.t{flex:1;cursor:pointer}
  li .del{background:none;color:#fb7185;font-size:17px;padding:0 4px}
  .hint{color:#666c92;font-size:13px}
</style>
</head>
<body>
<div class="app">
  <h1>✅ tiny todo</h1>
  <form id="f"><input id="i" placeholder="what needs doing?" autocomplete="off"><button>+</button></form>
  <ul id="list"></ul>
  <p class="hint">click text to toggle · saved locally</p>
</div>
<script>
  var items=[]; var KEY='tinytodo';
  try{ items=JSON.parse(localStorage.getItem(KEY)||'[]'); }catch(e){}
  function persist(){ try{ localStorage.setItem(KEY, JSON.stringify(items)); }catch(e){} }
  function draw(){
    var ul=document.getElementById('list'); ul.innerHTML='';
    items.forEach(function(it,idx){
      var li=document.createElement('li'); if(it.done)li.className='done';
      var chk=document.createElement('input'); chk.type='checkbox'; chk.checked=it.done;
      chk.onchange=function(){ it.done=chk.checked; persist(); draw(); };
      var sp=document.createElement('span'); sp.className='t'; sp.textContent=it.text;
      sp.onclick=function(){ it.done=!it.done; persist(); draw(); };
      var del=document.createElement('button'); del.className='del'; del.textContent='✕';
      del.onclick=function(){ items.splice(idx,1); persist(); draw(); };
      li.append(chk,sp,del); ul.append(li);
    });
  }
  document.getElementById('f').onsubmit=function(ev){
    ev.preventDefault();
    var inp=document.getElementById('i'), v=inp.value.trim();
    if(!v)return; items.unshift({text:v,done:false}); inp.value=''; persist(); draw();
  };
  draw();
</script>
</body>
</html>`
    }
  },
  game:{
    name:'snake',
    files:{
      'index.html':`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>neon snake</title>
<style>
  body{margin:0;background:#0a0b14;color:#dfe3ff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh}
  h1{margin:18px 0 4px;font-weight:800;letter-spacing:-.5px}
  h1 span{background:linear-gradient(135deg,#34d399,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{color:#767ca0;margin:2px 0 14px;font-size:13px}
  canvas{background:#101228;border:1px solid #232647;border-radius:14px;box-shadow:0 0 44px rgba(52,211,153,.16)}
</style>
</head>
<body>
<h1>🐍 neon <span>snake</span></h1>
<p>arrow keys / swipe · eat glow fruit · don't bite yourself</p>
<canvas id="c" width="420" height="420"></canvas>
<script>
  var cv=document.getElementById('c'), cx=cv.getContext('2d');
  var N=21,S=20; // cells, px
  var snake,dir,food,score,dead,timer;
  function reset(){
    snake=[[10,10],[9,10],[8,10]]; dir=[1,0]; placeFood(); score=0; dead=false;
    clearInterval(timer); timer=setInterval(step,105);
  }
  function placeFood(){
    do{ food=[Math.floor(Math.random()*N),Math.floor(Math.random()*N)]; }
    while(snake.some(function(s){return s[0]===food[0]&&s[1]===food[1]}));
  }
  function step(){
    if(dead)return;
    var h=[snake[0][0]+dir[0], snake[0][1]+dir[1]];
    if(h[0]<0||h[1]<0||h[0]>=N||h[1]>=N||snake.some(function(s){return s[0]===h[0]&&s[1]===h[1]})){
      dead=true; setTimeout(reset,1400); draw(true); return;
    }
    snake.unshift(h);
    if(h[0]===food[0]&&h[1]===food[1]){ score++; placeFood(); }
    else snake.pop();
    draw(false);
  }
  function draw(over){
    cx.fillStyle='#101228'; cx.fillRect(0,0,420,420);
    cx.fillStyle='#f472b6';
    cx.shadowColor='#f472b6'; cx.shadowBlur=14;
    cx.fillRect(food[0]*S+3,food[1]*S+3,S-6,S-6);
    cx.shadowBlur=0;
    for(var i=snake.length-1;i>=0;i--){
      var t=1-i/(snake.length+4);
      cx.fillStyle=i===0?'#a7f3d0':'rgba(52,211,153,'+(0.25+t*0.75)+')';
      cx.fillRect(snake[i][0]*S+2,snake[i][1]*S+2,S-4,S-4);
    }
    cx.fillStyle='#eef'; cx.font='bold 15px system-ui';
    cx.fillText('score '+score,10,398);
    if(over){
      cx.fillStyle='rgba(10,11,20,.72)'; cx.fillRect(0,0,420,420);
      cx.fillStyle='#fb7185'; cx.font='bold 27px system-ui'; cx.textAlign='center';
      cx.fillText('ouch. respawning…',210,214); cx.textAlign='left';
    }
  }
  addEventListener('keydown',function(e){
    var m={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[e.key];
    if(m && !(m[0]===-dir[0]&&m[1]===-dir[1])){ dir=m; e.preventDefault(); }
  });
  var tx=null;
  cv.addEventListener('touchstart',function(e){tx=e.touches[0]});
  cv.addEventListener('touchend',function(e){
    var dx=e.changedTouches[0].clientX-tx.clientX, dy=e.changedTouches[0].clientY-tx.clientY;
    var m=Math.abs(dx)>Math.abs(dy)?[Math.sign(dx),0]:[0,Math.sign(dy)];
    if(!(m[0]===-dir[0]&&m[1]===-dir[1]))dir=m;
  });
  reset();
</script>
</body>
</html>`
    }
  }
};
function loadSample(key){
  const s=SAMPLES[key]; if(!s)return;
  persistCurrentProject();                       // never erase running work
  state.project=Object.assign(blankProject(s.name),{files:clone(s.files)});
  saveProject();
  state.chat=[]; $id('chatLog').innerHTML=''; saveChat();
  state.checkpoints=[]; saveChecks();
  state.ui.tabs=['index.html']; state.ui.open='index.html';
  persistCurrentProject();
  renderAll(); openInEditor('index.html'); showView('preview'); syncPristine();
  toast('Sample loaded — edit files or tell the AI what to change','ok');
}

/* ─────────────── settings / hero UI ─────────────── */
function provCards(container, sel, onPick){
  container.innerHTML='';
  PROV_ORDER.forEach(id=>{
    const P=PROVIDERS[id];
    const b=document.createElement('button');
    b.type='button'; b.className='pcard'+(id===sel?' sel':''); b.dataset.prov=id;
    const hasKey=!!state.settings.keys[id];
    b.innerHTML=`<span class="pn">${esc(P.label)}</span><span class="pd">${esc(P.desc)}${hasKey?' · 🔑':''}</span>`;
    b.addEventListener('click',()=>onPick(id));
    container.appendChild(b);
  });
}
function paintProvFields(id){
  const P=PROVIDERS[id];
  state.ui.pickProv=id;
  $id('keyInput').value = state.settings.keys[id] ?? '';
  $id('baseInput').placeholder = P.base || 'http://localhost:xxxx/v1';
  $id('baseInput').value = state.settings.bases[id] ?? '';
  $id('modelInput').placeholder = P.model || 'model-name';
  $id('modelInput').value = state.settings.models[id] ?? '';
  const k=document.getElementById.bind(document);
  let hint;
  if(P.noKey && id==='ollama') hint='No key needed — install Ollama, run <code>ollama serve</code>, pull a model, connect.';
  else if(P.noKey) hint='Point at any OpenAI-compatible /chat/completions endpoint.';
  else hint=`Get a key from <a href="${P.keyUrl}" target="_blank" rel="noopener">${P.keyUrl}</a> — paste it above.`;
  $id('provHint').className='hint'; $id('provHint').innerHTML=hint+' Model names are editable — newer releases usually just work.';
  document.querySelectorAll('#provGrid .pcard').forEach(c=>c.classList.toggle('sel',c.dataset.prov===id));
}
/* ── Providers / Tokens / Usage lists (Settings) ── */
function renderProviders(){
  const el=$id('provList'); if(!el) return;
  el.innerHTML='';
  PROV_ORDER.forEach(id=>{
    const P=PROVIDERS[id];
    const hasKey=!!state.settings.keys[id];
    const active=activeProviderId()===id;
    const row=document.createElement('div'); row.className='plist-row'+(active?' cur':'');
    row.innerHTML='<span class="dot '+(hasKey||P.noKey?'on':'off')+'"></span>'+
      '<span class="pl-name">'+esc(P.label)+'</span>'+
      '<span class="pl-sub">'+(active?'active · ':'')+(state.settings.models[id]||P.model)+'</span>';
    const use=document.createElement('button'); use.className='ghost'; use.textContent=active?'In use':'Use';
    use.addEventListener('click',()=>{ state.settings.provider=id; state.settings.onboarded=true; saveSettings(); renderProviders(); renderStatusChip(); paintProvFields(id); toast('Model: '+P.label,'ok'); });
    row.appendChild(use); el.appendChild(row);
  });
}
function renderTokens(){
  const el=$id('tokenList'); if(!el) return;
  el.innerHTML='';
  const withKeys=PROV_ORDER.filter(id=>state.settings.keys[id]);
  if(!withKeys.length){ el.innerHTML='<p class="hint">No API keys saved yet. Pick a provider above under “Model provider” and paste your key — it never leaves this browser.</p>'; return; }
  withKeys.forEach(id=>{
    const k=state.settings.keys[id];
    const row=document.createElement('div'); row.className='plist-row';
    row.innerHTML='<span class="pl-name">'+esc(PROVIDERS[id].label)+'</span>'+
      '<span class="pl-sub mono">••••'+esc(String(k).slice(-4))+' · '+String(k).length+' chars</span>';
    const forget=document.createElement('button'); forget.className='ghost danger'; forget.textContent='Forget';
    forget.addEventListener('click',()=>{ delete state.settings.keys[id]; saveSettings(); renderTokens(); renderProviders(); renderStatusChip(); toast('Key erased — '+PROVIDERS[id].label); });
    row.appendChild(forget); el.appendChild(row);
  });
}
function renderUsage(){
  const el=$id('usageList'); if(!el) return;
  const u=state.usage||{req:0,tin:0,tout:0,prov:{},day:{}};
  const today=new Date().toISOString().slice(0,10);
  const d=u.day&&u.day[today]||{req:0,tin:0,tout:0};
  const fmt=(n)=>n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(1)+'k':String(n||0);
  let html='<div class="usage-tot"><span><b>'+fmt(u.tin+u.tout)+'</b><small>total tokens</small></span>'+
    '<span><b>'+fmt(u.tin)+'</b><small>in</small></span>'+
    '<span><b>'+fmt(u.tout)+'</b><small>out</small></span>'+
    '<span><b>'+u.req+'</b><small>runs</small></span>'+
    '<span><b>'+fmt(d.tin+d.tout)+'</b><small>today</small></span></div>';
  const provs=Object.entries(u.prov||{}).sort((a,b)=>(b[1].tin+b[1].tout)-(a[1].tin+a[1].tout));
  if(provs.length){
    html+='<div class="usage-rows">';
    provs.forEach(([id,p])=>{
      html+='<div class="plist-row"><span class="pl-name">'+esc(PROVIDERS[id]?.label||id)+'</span>'+
        '<span class="pl-sub mono">'+fmt(p.tin)+' in · '+fmt(p.tout)+' out · '+p.req+' runs</span></div>';
    });
    html+='</div>';
  } else html+='<p class="hint">No runs yet — usage appears here after your first AI build (tokens are counted per provider).</p>';
  el.innerHTML=html;
}

function paintGeneralSettings(){
  // reasoning level
  const lvl=state.settings.thinking ?? 'balanced';
  document.querySelectorAll('#thinkSeg [data-think]').forEach(b=>b.classList.toggle('active',b.dataset.think===lvl));
  // editor font size
  const f=state.settings.editorFont ?? 'm';
  document.querySelectorAll('#fontSeg [data-font]').forEach(b=>b.classList.toggle('active',b.dataset.font===f));
  applyEditorFont();
  // auto-save to device
  const chk=$id('chkAutoSave'); if(chk) chk.checked=state.settings.autoSaveDevice!==false;
  const pickHint=$id('pickHint');
  if(pickHint){
    if(window.antrorAPI){
      window.antrorAPI.getWorkspace().then(dir=>pickHint.textContent='saving into '+dir);
    } else if(state.ui.saveDirHandle){
      pickHint.textContent='saving into “'+(state.ui.saveDirHandle.name||'chosen folder')+'”';
    } else pickHint.textContent=window.showDirectoryPicker?'no folder chosen yet':'desktop app required for silent saving';
  }
  // bridge only matters in the browser
  const bb=$id('bridgeBox'); if(bb) bb.hidden=!!window.antrorAPI;
  const bt=$id('bridgeToken'); if(bt) bt.value=(state.settings.bridge||{}).token||'';
}
function applyEditorFont(){
  const sizes={s:'11.5px', m:'12.5px', l:'14px'};
  const px=sizes[state.settings.editorFont ?? 'm'];
  const ta=$id('codeEditor'), g=$id('gutter');
  if(ta) ta.style.fontSize=px;
  if(g) g.style.fontSize=px;
}
function openSettings(){ go('settings'); }
function renderStatusChip(){
  const cfg=activeConfig();
  const ready = cfg.noKey ? !!cfg.base || !!cfg.model : !!cfg.key;
  $id('provDot').className='dot '+(ready?'on':'off');
  $id('provChipText').textContent = (PROVIDERS[cfg.id]?.label||'no provider') +
    (ready && cfg.model ? ' · '+cfg.model.split('/').pop().slice(0,22) : '');
  const pbDot=$id('pbDot'), pbText=$id('pbModelText');
  if(pbDot) pbDot.className='dot '+(ready?'on':'off');
  if(pbText) pbText.textContent = (PROVIDERS[cfg.id]?.label||'no model') +
    (ready && cfg.model ? ' · '+cfg.model.split('/').pop().slice(0,20) : '');
  document.title = (state.project.name||'untitled')+' — ANTROR Code';
}
function paintThinkChip(){
  const b=$id('pbThink'); if(!b) return;
  const cur=state.settings.thinking??'medium';
  $id('pbThinkText').textContent = THINK_LABEL[cur]||'Medium';
  b.classList.toggle('on', cur!=='off');
  const tp=$id('thinkPop');
  if(tp && !tp.hidden){
    tp.innerHTML='';
    ['off','low','medium','max'].forEach(k=>{
      const o=document.createElement('button'); o.type='button'; o.className='modeopt'+(cur===k?' sel':'');
      o.innerHTML='<span class="mi" style="font-size:13px;padding-top:2px">'+({off:'○',low:'✧',medium:'◈',max:'✦'}[k])+'</span>'+
        '<span><b>'+THINK_LABEL[k]+'</b><small>'+({off:'No reasoning — fastest replies',low:'Light thinking for simple tweaks',medium:'Balanced depth for most builds',max:'Deepest reasoning for hard problems'}[k])+'</small></span>'+
        (cur===k?'<span class="mck">✓</span>':'');
      o.addEventListener('click',()=>{ state.settings.thinking=k; saveSettings(); paintThinkChip(); tp.hidden=true; toast('🧠 Thinking: '+THINK_LABEL[k]); });
      tp.appendChild(o);
    });
  }
}
function heroPaint(sel){
  provCards($id('heroProv'), sel, (id)=>{ state.ui.heroSel=id; heroPaint(id); $id('heroKey').focus(); });
  $id('heroKey').value = state.settings.keys[sel] ?? '';
}
function heroGo(){
  const id=state.ui.heroSel||'zai'; const P=PROVIDERS[id];
  const key=$id('heroKey').value.trim();
  if(id==='custom' && !key.includes('http') && !confirm('Custom endpoint selected but no URL given in the key field. Continue anyway?')) return;
  if(!P.noKey && !key){ const e=$id('heroErr'); e.hidden=false; e.textContent='That provider needs an API key — grab one from '+P.keyUrl; return; }
  state.settings.provider=id;
  if(key) state.settings.keys[id]=key; else delete state.settings.keys[id];
  if(id==='custom'){ state.settings.bases.custom=key; state.settings.models.custom='default'; }
  state.settings.onboarded=true;
  saveSettings(); renderStatusChip();
  $id('welcome').hidden=true;
  toast('✦ Connected to '+P.label+(P.noKey?'':' — happy vibing!'),'ok');
  $id('promptBox').focus();
}

/* ─────────────── projects (multi, non-destructive) ─────────────── */
function switchToProject(p, opts={}){
  persistCurrentProject();                        // snapshot whatever is running now
  state.project = { id:p.id, cloudId:p.cloudId||null, name:p.name, files:p.files||{}, chat:p.chat||[], updatedAt:p.updatedAt||nowTs() };
  state.chat = clone(state.project.chat);
  state.checkpoints=[]; saveChecks();
  state.ui.tabs=[]; state.ui.open=null;
  $id('chatLog').innerHTML='';
  saveProject(); saveChat();
  renderAll(); restoreChatLog();
  showView(opts.view||'preview');
  toast('🗂 Opened “'+state.project.name+'” — your other projects are safe','ok');
  $id('promptBox').focus();
}
function newProject(){
  persistCurrentProject();                        // current work saved, not cleared
  state.project = blankProject();
  state.chat=[]; $id('chatLog').innerHTML='';
  state.checkpoints=[]; saveChecks();
  state.ui.tabs=[]; state.ui.open=null;
  saveProject(); saveChat(); persistCurrentProject();
  renderAll(); syncPristine(); toast('Fresh canvas — describe what to build');
  $id('promptBox').focus();
}
function deleteProjectLocal(id){
  if(!confirm('Delete this project from this browser? (cloud copies, if any, stay)')) return;
  state.projects = state.projects.filter(p=>p.id!==id);
  if(state.project.id===id){ // deleted the open one → open the most recent or blank
    const next = state.projects[0];
    if(next) switchToProject(next);
    else newProject();
  }
  saveProjects(); renderProjectsDrawer();
  toast('Project deleted');
}
async function pushProjectCloud(id){
  if(!window.VF || !VF.configured()){ toast('Connect Supabase in Settings → Account first','err'); return; }
  const p = state.projects.find(x=>x.id===id) || (state.project.id===id ? Object.assign({},state.project,{chat:state.chat}) : null);
  if(!p) return;
  try{
    const cloudId = await VF.pushProject({ name:p.name, files:p.files, chat:p.chat||[], cloudId:p.cloudId||state.project.cloudId||null });
    if(state.project.id===id) state.project.cloudId=cloudId;
    const row = state.projects.find(x=>x.id===id); if(row) row.cloudId=cloudId;
    saveProjects(); renderProjectsDrawer();
    toast('☁ Saved “'+p.name+'” to your cloud','ok');
  }catch(e){ toast('Cloud save failed — '+(e.message||e), 'err', 5000); }
}
function renderProjectsDrawer(){
  const wrap=document.createElement('div');
  // local list
  const local=document.createElement('div');
  local.innerHTML='<div class="set-sec" style="margin-top:0">On this device</div>';
  if(!state.projects.length) local.innerHTML+='<div class="hist-empty">No saved projects yet — everything you build lands here automatically.</div>';
  state.projects.forEach(p=>{
    const d=document.createElement('div'); d.className='proj-item'+(p.id===state.project.id?' cur':'');
    const meta=document.createElement('div'); meta.className='htxt';
    meta.innerHTML='<span class="hl">'+esc(p.name)+(p.id===state.project.id?' · <i>open</i>':'')+'</span>'+
      '<span class="hd">'+Object.keys(p.files||{}).length+' files · '+fmtTime(p.updatedAt||nowTs())+(p.cloudId?' · ☁':'')+'</span>';
    d.appendChild(meta);
    const open=document.createElement('button'); open.className='ghost'; open.textContent='Open';
    open.addEventListener('click',()=>{ if(p.id!==state.project.id){ switchToProject(clone(p)); } $id('projectsDrawer').hidden=true; });
    const cloud=document.createElement('button'); cloud.className='ghost'; cloud.title='Save to your Supabase cloud'; cloud.textContent='☁';
    cloud.addEventListener('click',()=>pushProjectCloud(p.id));
    const del=document.createElement('button'); del.className='ghost danger'; del.textContent='🗑';
    del.addEventListener('click',()=>deleteProjectLocal(p.id));
    d.append(open,cloud,del);
    local.appendChild(d);
  });
  wrap.appendChild(local);
  // cloud list
  const cloudSec=document.createElement('div');
  cloudSec.innerHTML='<div class="set-sec">Cloud (Supabase)</div>';
  const cbox=document.createElement('div');
  cloudSec.appendChild(cbox); wrap.appendChild(cloudSec);
  $id('projList').innerHTML=''; $id('projList').appendChild(wrap);
  if(window.VF && VF.configured()){
    cbox.innerHTML='<div class="hint">loading your cloud projects…</div>';
    VF.listCloud().then(rows=>{
      cbox.innerHTML='';
      if(!rows || !rows.length){ cbox.innerHTML='<div class="hint">Nothing in the cloud yet — hit ☁ on a local project to push it.</div>'; return; }
      rows.forEach(r=>{
        const d=document.createElement('div'); d.className='proj-item';
        d.innerHTML='<div class="htxt"><span class="hl">☁ '+esc(r.name)+'</span><span class="hd">'+Object.keys(r.files||{}).length+' files · '+fmtTime(new Date(r.updatedAt).getTime())+'</span></div>';
        const open=document.createElement('button'); open.className='ghost'; open.textContent='Open';
        open.addEventListener('click',()=>{
          persistCurrentProject();
          state.project=Object.assign(blankProject(r.name),{files:clone(r.files),chat:clone(r.chat||[]),cloudId:r.cloudId});
          state.chat=clone(state.project.chat);
          state.ui.tabs=[]; state.ui.open=null;
          $id('chatLog').innerHTML=''; saveProject(); saveChat(); persistCurrentProject();
          renderAll(); restoreChatLog(); showView('preview');
          $id('projectsDrawer').hidden=true;
          toast('☁ Opened “'+r.name+'” from cloud','ok');
        });
        const del=document.createElement('button'); del.className='ghost danger'; del.textContent='🗑';
        del.addEventListener('click',async()=>{
          if(!confirm('Delete this project from the cloud?')) return;
          try{ await VF.deleteCloud(r.cloudId); toast('Deleted from cloud','ok'); renderProjectsDrawer(); }
          catch(e){ toast('Delete failed — '+(e.message||e),'err'); }
        });
        d.append(open,del); cbox.appendChild(d);
      });
    }).catch(e=>{ cbox.innerHTML='<div class="hint err">Cloud list failed — '+(e.message||e)+'</div>'; });
  } else {
    cbox.innerHTML='<div class="hint">Not connected. Settings → Account → Sign in to sync projects across devices.</div>';
  }
}

/* ─────────────── account box (Settings) ─────────────── */
async function renderAcctBox(){
  const box=$id('acctBox'); if(!box) return;
  if(!window.VF || !VF.configured()){
    box.innerHTML='<div class="acct-soon"><span><b>Accounts</b> — sign in to sync projects across devices (Supabase).</span>'+
      '<button class="ghost" id="acctSetup">Connect</button></div>';
    $id('acctSetup').addEventListener('click',()=>go('login'));
    return;
  }
  const user=await VF.getUser();
  if(!user){
    box.innerHTML='<div class="acct-soon"><span><b>Supabase connected</b> — you are signed out.</span>'+
      '<button class="ghost" id="acctGo2">Sign in / Create account</button></div>';
    $id('acctGo2').addEventListener('click',()=>go('login'));
    return;
  }
  const email=user.email||'user';
  const meta=user.user_metadata||{};
  const display=meta.display_name||meta.full_name||'';
  const initial=(display||email)[0].toUpperCase();
  box.innerHTML='<div class="acct-user"><span class="avatar">'+esc(initial)+'</span>'+
    '<span class="acct-txt"><b>'+esc(display||email)+'</b><small>'+esc(email)+'</small></span>'+
    '<button class="ghost danger" id="acctOut">Sign out</button></div>'+
    '<label class="fld" style="margin-top:10px">Display name <small>(shown on your chip &amp; to the AI)</small>'+
    '<input id="acctName" type="text" maxlength="40" placeholder="e.g. Arpit" value="'+esc(display)+'" autocomplete="off" /></label>'+
    '<div class="data-row"><button class="primary" id="btnSaveName">Save name</button></div>';
  $id('acctOut').addEventListener('click',async()=>{
    await VF.signOut(); toast('Signed out — projects stay on this device');
    renderAcctBox(); renderUserChip();
  });
  $id('btnSaveName').addEventListener('click',async()=>{
    const v=$id('acctName').value.trim();
    if(!v){ toast('Type a name first','err'); return; }
    try{
      await VF.updateName(v);
      toast('✓ Name saved — '+v,'ok');
      renderAcctBox(); renderUserChip();
    }catch(e){ toast('Could not save — '+(e.message||e),'err',4500); }
  });
}

/* ─────────────── sign out: cloud-first, then wipe local ─────────────── */
async function signOutAndWipe(){
  if(!confirm('Sign out?\n\n• Your projects are pushed to your cloud first\n• Then they are erased from this browser\n• Sign back in and everything returns')) return;
  try{ persistCurrentProject(); }catch(e){}
  let pushed=0;
  if(window.VF && VF.configured()){
    for(const p of state.projects){
      try{ await VF.pushProject({name:p.name, files:p.files, chat:p.chat||[], cloudId:p.cloudId}); pushed++; }catch(e){ /* keep going */ }
    }
  }
  if(pushed) toast('☁ Pushed '+pushed+' project(s) to your cloud — signing out…','ok');
  try{ ['vf.v1.project','vf.v1.chat','vf.v1.checkpoints','vf.v1.projects','vf.v1.usage'].forEach(k=>localStorage.removeItem(k)); }catch(e){}
  if(window.VF) await VF.signOut();
  if(window.antrorAPI){ window.antrorAPI.goPage('index'); return; }
  location.href = location.protocol==='file:' ? 'index.html' : '/';
}

/* ─────────────── sign in: restore cloud projects on a fresh browser ─────────────── */
async function restoreCloudOnSignIn(){
  if(!(window.VF && VF.configured())) return;
  let user=null; try{ user=await VF.getUser(); }catch(e){ return; }
  if(!user) return;
  // only when this browser has no local work (e.g. right after a sign-out wipe)
  if(state.projects.length || Object.keys(state.project.files||{}).length) return;
  try{
    const rows=await VF.listCloud();
    if(!rows.length) return;
    state.projects=rows.map(r=>({ id:'p'+r.cloudId, cloudId:r.cloudId, name:r.name, files:r.files||{}, chat:r.chat||[], updatedAt:new Date(r.updatedAt).getTime()||nowTs() }));
    saveProjects();
    const first=state.projects[0];
    state.project={ id:first.id, cloudId:first.cloudId, name:first.name, files:first.files||{}, chat:first.chat||[], updatedAt:first.updatedAt };
    state.chat=clone(state.project.chat);
    saveProject(); saveChat(); persistCurrentProject();
    renderAll(); restoreChatLog();
    toast('☁ Welcome back, '+(user.user_metadata?.display_name||user.email||'friend')+' — '+state.projects.length+' project(s) restored from your cloud','ok',5000);
  }catch(e){ /* silent — local-first still works */ }
}

/* ─────────────── sidebar user chip (footer) ─────────────── */
async function renderUserChip(){
  const av=$id('userAvatar'), name=$id('userName'), sub=$id('userSub');
  if(!av) return;
  let user=null;
  if(window.VF && VF.configured()) user=await VF.getUser();
  state.ui.signedIn=!!user;
  if(user){
    const meta=user.user_metadata||{};
    const display=meta.display_name||meta.full_name||'';
    const email=user.email||'user';
    av.textContent=(display||email)[0].toUpperCase();
    name.textContent=display||email.split('@')[0];
    sub.textContent='synced via Supabase';
  }else{
    av.textContent='?';
    name.textContent='Sign in';
    sub.textContent=(window.VF&&VF.configured())?'supabase ready · not signed in':'local only · no account';
  }
}
function bindUserChip(){
  const menu=$id('userMenu');
  if(!$id('userChip')) return;
  $id('userChip').addEventListener('click',()=>{
    menu.hidden=!menu.hidden;
    if(!menu.hidden){
      $id('umAccount').textContent = state.ui.signedIn ? 'Account & sync' : 'Sign in / Create account';
      $id('umSignout').hidden = !state.ui.signedIn;
    }
  });
  $id('umAccount').addEventListener('click',()=>{ menu.hidden=true; go('login'); });
  $id('umSettings').addEventListener('click',()=>{ menu.hidden=true; openSettings(); });
  $id('umSignout').addEventListener('click',async()=>{
    menu.hidden=true;
    await signOutAndWipe();
  });
  document.addEventListener('click',(e)=>{
    if(!menu.hidden && !$id('userRow').contains(e.target)) menu.hidden=true;
  });
}

/* ─────────────── wiring / init ─────────────── */
function autoGrow(){
  const tb=$id('promptBox'); tb.style.height='auto';
  tb.style.height=Math.min(tb.scrollHeight,220)+'px';
}
function renderAll(){
  renderTree(); renderTabs(); loadEditor(); renderStatusChip(); refreshPreview();
  $id('projName').textContent = state.project.name||'untitled';
}
function restoreChatLog(){
  state.chat.forEach(m=>{
    if(m.role==='user') addUserMsg(m.text);
    else{
      const ui=newAiMsg(); ui.caret.remove(); ui.root.classList.remove('stream');
      ui.bubble.innerHTML = m.display?.trim()?renderRich(m.display):'<p class="typeline">(no message)</p>';
      (m.files||[]).forEach(p=>{ const c=state.project.files[p]; fcard(ui.root,p,c?linesOf(c):0); });
      if(m.error) { /* historical errors collapse silently */ }
    }
  });
  const l=$id('chatLog'); l.scrollTop=l.scrollHeight;
}
function bind(){
  // composer
  $id('composerForm').addEventListener('submit',(e)=>{ e.preventDefault(); sendPrompt($id('promptBox').value); });
  $id('promptBox').addEventListener('keydown',(e)=>{
    if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendPrompt($id('promptBox').value); }
  });
  $id('promptBox').addEventListener('input',()=>{ autoGrow(); try{ localStorage.setItem('vf.v1.draft',$id('promptBox').value); }catch(e){} });
  $id('stopBtn').addEventListener('click',()=>{
    if(!controller) return;
    try{ controller.abort(); }catch(e){}
    setBusy(false);
    if($id('promptBox').value.trim()==='' && sendPrompt.lastPrompt){
      $id('promptBox').value=sendPrompt.lastPrompt; autoGrow(); $id('promptBox').focus();
      toast('⏹ Stopped — your prompt is back in the box, edit it and resend','ok');
    } else toast('⏹ Stopped');
  });
  document.querySelectorAll('.chip[data-fill]').forEach(c=>{
    c.addEventListener('click',()=>{
      const tb=$id('promptBox'); tb.value=c.dataset.fill; tb.focus();
      tb.setSelectionRange(tb.value.length,tb.value.length); autoGrow();
    });
  });
  $id('btnClearChat').addEventListener('click',()=>{
    if(!state.chat.length) return;
    if(!confirm('Clear the conversation? Files stay.')) return;
    state.chat=[]; $id('chatLog').innerHTML=''; saveChat();
  });
  // sidebar (New + Import live inside the Projects drawer now)
  $id('btnNew2').addEventListener('click',()=>{ $id('projectsDrawer').hidden=true; newProject(); });
  $id('btnImport2').addEventListener('click',()=>{ $id('projectsDrawer').hidden=true; importFolder(); });
  $id('btnZip').addEventListener('click',exportZip);
  $id('btnGetApp').addEventListener('click',()=>go('download'));
  if(window.antrorAPI){ $id('btnGetApp').style.display='none'; }   // already in the app
  $id('importInput').addEventListener('change',(e)=>{ handleImportFiles(e.target.files); e.target.value=''; });
  $id('btnHistory').addEventListener('click',()=>{ renderHistory(); $id('historyDrawer').hidden=false; });
  $id('histClose').addEventListener('click',()=>$id('historyDrawer').hidden=true);
  $id('btnProjects').addEventListener('click',()=>{ persistCurrentProject(); renderProjectsDrawer(); $id('projectsDrawer').hidden=false; });
  $id('btnTasks').addEventListener('click',()=>{ renderTasks(); $id('tasksDrawer').hidden=false; });
  // sidebar minimize / expand (persisted)
  const applySb=()=>{ document.body.classList.toggle('sbmin',!!state.settings.sbMin);
    $id('sbToggle').textContent=state.settings.sbMin?'»':'«';
    $id('sbToggle').title=state.settings.sbMin?'Expand sidebar':'Minimize sidebar'; };
  $id('sbToggle').addEventListener('click',()=>{ state.settings.sbMin=!state.settings.sbMin; saveSettings(); applySb(); });
  applySb();
  $id('tasksClose').addEventListener('click',()=>$id('tasksDrawer').hidden=true);
  ['projectsDrawer','tasksDrawer','historyDrawer'].forEach(id=>{
    const el=$id(id);
    el.addEventListener('click',(e)=>{ if(e.target===el) el.hidden=true; });   // backdrop click
  });
  $id('projClose').addEventListener('click',()=>$id('projectsDrawer').hidden=true);
  $id('btnSettings').addEventListener('click',openSettings);
  $id('provChip').addEventListener('click',openSettings);
  // projName editable
  const pn=$id('projName');
  pn.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){e.preventDefault();pn.blur();} });
  pn.addEventListener('blur',()=>{
    let v=pn.textContent.replace(/\n/g,' ').trim().slice(0,40)||'untitled';
    pn.textContent=v; state.project.name=v; persistCurrentProject(); renderStatusChip();
  });
  // stage
  $id('segPreview').addEventListener('click',()=>showView('preview'));
  $id('segCode').addEventListener('click',()=>showView('code'));
  $id('btnRefresh').addEventListener('click',()=>refreshPreview());
  $id('btnOpenTab').addEventListener('click',()=>{
    const doc=buildPreviewDoc();
    if(doc==null){ toast('Nothing to open yet — the workspace is empty','err'); return; }
    const url=URL.createObjectURL(new Blob([SHIM+doc],{type:'text/html'}));
    window.open(url,'_blank');
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  // preview width
  const setW=(phone)=>{
    state.ui.phoneW=phone;
    $id('frameHolder').classList.toggle('phone',phone);
    $id('wFull').classList.toggle('active',!phone);
    $id('wPhone').classList.toggle('active',phone);
    refreshPreview();
  };
  $id('wFull').addEventListener('click',()=>setW(false));
  $id('wPhone').addEventListener('click',()=>setW(true));
  // prompt-box chips
  $id('pbModel').addEventListener('click',openSettings);
  // build mode picker
  const modePop=$id('modePop');
  const paintMode=()=>{
    const m=MODES[state.settings.mode]||MODES.web;
    $id('pbModeIcon').textContent=m.icon; $id('pbModeText').textContent=m.label;
  };
  const renderModePop=()=>{
    modePop.innerHTML='';
    MODE_ORDER.forEach(k=>{
      const M=MODES[k];
      const b=document.createElement('button'); b.type='button'; b.className='modeopt'+((state.settings.mode||'web')===k?' sel':'');
      b.innerHTML='<span class="mi">'+M.icon+'</span><span><b>'+esc(M.label)+'</b><small>'+esc(M.hint)+'</small></span>'+
        ((state.settings.mode||'web')===k?'<span class="mck">✓</span>':'');
      b.addEventListener('click',()=>{
        state.settings.mode=k; saveSettings(); paintMode();
        modePop.hidden=true;
        toast(M.icon+' '+M.label+' mode — the AI now builds for this');
      });
      modePop.appendChild(b);
    });
  };
  // starter cards on the empty chat
  document.querySelectorAll('.ce-grid button').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.mode){ state.settings.mode=b.dataset.mode; saveSettings(); paintMode(); }
    const tb=$id('promptBox'); tb.value=b.dataset.ce; autoGrow(); tb.focus();
    tb.setSelectionRange(tb.value.length,tb.value.length);
  }));
  const paintCeName=async()=>{
    let name='friend';
    try{ if(window.VF&&VF.configured()){ const u=await VF.getUser(); if(u) name=(u.user_metadata?.display_name||u.email||'friend').split('@')[0]; } }catch(e){}
    const el=$id('ceName'); if(el) el.textContent=name;
  };
  paintCeName();
  $id('pbMode').addEventListener('click',()=>{
    if(modePop.hidden){ renderModePop(); modePop.hidden=false; }
    else modePop.hidden=true;
  });
  document.addEventListener('click',(e)=>{
    if(!modePop.hidden && !modePop.contains(e.target) && e.target!==$id('pbMode') && !$id('pbMode').contains(e.target)) modePop.hidden=true;
  });
  paintMode();
  // thinking dropdown (opens upward, anchored like the image)
  $id('pbThink').addEventListener('click',()=>{
    const tp=$id('thinkPop');
    if(tp.hidden){ tp.hidden=false; paintThinkChip(); }
    else tp.hidden=true;
  });
  document.addEventListener('click',(e)=>{
    const tp=$id('thinkPop');
    if(!tp.hidden && !tp.contains(e.target) && !$id('pbThink').contains(e.target)) tp.hidden=true;
  });
  // preview show/hide from the chat header
  $id('btnPrevToggle').addEventListener('click',()=>{
    if(document.body.classList.contains('pristine')) syncPristine(true);
    else { document.body.classList.add('pristine'); showView('preview'); }
  });
  // image attach (+) — images land in assets/ and can be used by the preview & AI
  $id('btnAttach').addEventListener('click',()=>$id('attachInput').click());
  $id('attachInput').addEventListener('change',async(e)=>{
    const files=[...e.target.files]; e.target.value='';
    for(const f of files){
      if(!/^image\//.test(f.type)) continue;
      if(f.size>1200000){ toast('🖼 '+f.name+' is over 1.2 MB — skipped','err'); continue; }
      const dataUrl=await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(f); });
      pendingAttach.push({ name:f.name.replace(/[^\w.-]+/g,'-'), dataUrl });
    }
    renderAttachTray();
  });
  $id('consBadgeBtn').addEventListener('click',()=>{
    let pop=$id('consPop');
    if(pop){ pop.remove(); return; }
    pop=document.createElement('div'); pop.id='consPop';
    pop.innerHTML='<b style="color:#ffd9a8">runtime output</b>\n'+(consErrors.join('\n')||'silent — no errors!');
    pop.addEventListener('click',()=>pop.remove());
    $id('stage').appendChild(pop);
  });
  document.querySelectorAll('[data-sample]').forEach(b=>b.addEventListener('click',()=>loadSample(b.dataset.sample)));
  // onboarding wizard
  state.ui.heroSel=activeProviderId();
  heroPaint(state.ui.heroSel);
  const showStep=(n)=>{
    $id('hstep1').hidden = n!==1;
    $id('hstep2').hidden = n!==2;
    $id('hd1').classList.toggle('on', n===1);
    $id('hd2').classList.toggle('on', n>=2);
  };
  state.ui.heroStep=showStep;
  $id('btnHeroNext').addEventListener('click',()=>{ showStep(2); $id('heroKey').focus(); });
  $id('heroBack').addEventListener('click',()=>showStep(1));
  $id('heroSignin').addEventListener('click',(e)=>{ e.preventDefault(); go('login'); });
  $id('heroStart').addEventListener('click',heroGo);
  $id('heroKey').addEventListener('keydown',(e)=>{ if(e.key==='Enter')heroGo(); });
  $id('heroSkip').addEventListener('click',()=>{ $id('welcome').hidden=true; state.settings.onboarded=true; saveSettings(); toast('Explore freely — connect a model anytime from the ⚙ chip below'); });
  // chat head: collapse + clear
  // mobile fab — toggles the chat overlay on small screens
  $id('chatFab').addEventListener('click',()=>$id('chatPanel').classList.toggle('open'));
  // focus mode — chat takes over, everything else dims
  // drag the left edge to resize the chat panel (persisted)
  const rz=$id('chatResizer'); let rx=null;
  rz.addEventListener('pointerdown',(e)=>{ rx=e.clientX; document.body.style.cursor='col-resize'; try{rz.setPointerCapture(e.pointerId);}catch(_){} });
  rz.addEventListener('pointermove',(e)=>{
    if(rx==null) return;
    const w=Math.min(Math.max(300, window.innerWidth-e.clientX), window.innerWidth-380);
    document.documentElement.style.setProperty('--chatw', w+'px');
  });
  const endDrag=()=>{
    if(rx==null) return;
    rx=null; document.body.style.cursor='';
    const w=getComputedStyle(document.documentElement).getPropertyValue('--chatw').trim();
    if(w){ state.settings.chatWidth=w; saveSettings(); }
  };
  rz.addEventListener('pointerup',endDrag);
  rz.addEventListener('pointercancel',endDrag);
  if(state.settings.chatWidth) document.documentElement.style.setProperty('--chatw', state.settings.chatWidth);
  // esc closes overlays
  addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){ ['historyDrawer','diffModal','tasksDrawer'].forEach(id=>{ const el=$id(id); if(el) el.hidden=true; }); const mp=$id('modePop'); if(mp) mp.hidden=true; $id('chatPanel').classList.remove('open'); }
  });
}

function init(){
  bind(); bindEditor(); bindChatScroll(); bindUserChip();
  // adopt the most recent project as the open one (multi-project era)
  if(state.projects.length && (!state.project.id || !state.project.files || !Object.keys(state.project.files).length)){
    const last = state.projects[0];
    state.project = { id:last.id, cloudId:last.cloudId||null, name:last.name, files:last.files||{}, chat:last.chat||[], updatedAt:last.updatedAt||nowTs() };
    state.chat = clone(state.project.chat);
  }
  renderAll();
  restoreChatLog();
  document.body.classList.add('pristine');   // fresh load: chat first — the ▤ Preview button opens it
  applyEditorFont();
  if(state.settings.thinking==='balanced') state.settings.thinking='medium';
  if(state.settings.thinking==='deep') state.settings.thinking='max';
  paintThinkChip();
  updateCtxPill(ctxOfConversation(''));
  if(!window.antrorAPI) idbGetDir().then(h=>{ if(h) state.ui.saveDirHandle=h; });
  restoreCloudOnSignIn();
  if(!state.settings.onboarded) $id('welcome').hidden=false;
  try{ const d=localStorage.getItem('vf.v1.draft'); if(d){ $id('promptBox').value=d; } }catch(e){}
  autoGrow();
  renderAcctBox();
  renderUserChip();
  if(location.search.includes('vfdebug')){
    const files=state.project.files;
    const inv=Object.keys(files).map(p=>p+' ('+files[p].length+' B)').join(' | ')||'(none)';
    const d=buildPreviewDoc();
    const pre=document.createElement('pre');
    pre.style.cssText='position:fixed;inset:0;z-index:9999;background:#111;color:#8f8;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-all';
    pre.textContent='FILES: '+inv+'\n\nDOC LENGTH: '+(d==null?'null':d.length)+'\n\n'+(d==null?'(null)':d.slice(0,6000));
    document.body.appendChild(pre);
  }
}
init();

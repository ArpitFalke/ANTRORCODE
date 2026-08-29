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
const LS = { s:'vf.v1.settings', p:'vf.v1.project', c:'vf.v1.chat', h:'vf.v1.checkpoints', pr:'vf.v1.projects' };
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
  ui: { tabs:[], open:null, view:'preview', busy:false, chatSticky:true, phoneW:false },
};
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
  ollama:    { label:'Ollama · local',  desc:'Free & private — run “ollama serve” first',         kind:'openai', noKey:true,
               base:'http://localhost:11434/v1',                       model:'qwen2.5-coder:7b', keyUrl:'' },
  custom:    { label:'Custom endpoint', desc:'Any OpenAI-compatible URL (LM Studio, proxy…)',     kind:'openai', noKey:true,
               base:'',                                                model:'',                 keyUrl:'' },
};
const PROV_ORDER = ['zai','anthropic','openai','openrouter','gemini','groq','ollama','custom'];

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
function fcard(root, path, n){
  let wrap=root.querySelector('.fcards');
  if(!wrap){ wrap=document.createElement('div'); wrap.className='fcards'; root.appendChild(wrap); }
  const c=document.createElement('div'); c.className='fcard';
  c.innerHTML=`📄 <b>${esc(path)}</b><span class="ln">${n} lines</span>`;
  c.addEventListener('click',()=>openInEditor(path));
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

function makeAdapter(cfg, msgs, sys, opts={}){
  if(cfg.kind==='anthropic'){
    return {
      url: joinUrl(cfg.base,'/v1/messages'),
      headers:{
        'x-api-key':cfg.key,
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true',
      },
      body:{
        model:cfg.model, max_tokens:opts.maxTokens??16000, stream:true, system:sys,
        messages: msgs.map(m=>({role:m.role, content:[{type:'text',text:m.text}]})),
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
      body:{
        systemInstruction:{parts:[{text:sys}]},
        contents: msgs.map(m=>({role: m.role==='assistant'?'model':'user', parts:[{text:m.text}]})),
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
    body:{
      model:cfg.model, stream:true,
      messages:[{role:'system',content:sys}, ...msgs.map(m=>({role:m.role,content:m.text}))],
    },
    pick(j){
      if(j.error) throw new Error(j.error.message||String(j.error));
      return j.choices?.[0]?.delta?.content || j.choices?.[0]?.text || '';
    },
  };
}
async function sseStream(adt, signal, onDelta){
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

  state.chat.push({role:'user',text,t:nowTs()});
  addUserMsg(text); saveChat();
  $id('promptBox').value=''; autoGrow();

  pushCheckpoint(text);
  const ui=newAiMsg();
  setBusy(true);
  controller=new AbortController();
  persistCurrentProject(); // user turn is never lost, even mid-run

  let raw=''; let stopped=false; const written=[]; const carded=new Set();
  const onDelta=(chunk)=>{
    raw+=chunk;
    ui.txt.textContent = stripTags(raw);
    softScroll();
    const fresh=extractWritten(raw, written);   // files land (and preview refreshes) as they finish streaming
    if(fresh.length){
      renderTreeSoon(); refreshSoon();
      fresh.forEach(w=>{ if(!carded.has(w.path)){ carded.add(w.path); fcard(ui.root,w.path,w.lines); } });
    }
    const ts=window.__vfTermSink; if(ts&&ts.delta) try{ts.delta(raw,written.length);}catch(e){}
  };
  try{
    const sys=VIBE_SYSTEM+'\n\n=====\n'+manifestBlock();
    const msgs=buildMessages();
    const adt=makeAdapter(cfg,msgs,sys,{});
    await sseStream(adt,controller.signal,onDelta);
  }catch(err){
    if(err.name==='AbortError'){ stopped=true; }
    else{
      const disp=stripTags(raw);
      ui.txt.textContent=disp;
      finalizeBubble(ui,disp,written,stopped);
      state.chat.push({role:'assistant',display:disp,files:written.map(w=>w.path),error:true,t:nowTs()});
      saveChat(); saveProject(); renderTree(); persistCurrentProject();
      errorCard(ui,friendlyError(err,cfg));
      const te=window.__vfTermSink; if(te&&te.error) try{te.error(err);}catch(e){}
      setBusy(false); return;
    }
  }

  const disp=stripTags(raw);
  extractWritten(raw, written);
  finalizeBubble(ui,disp,written,stopped);
  state.chat.push({role:'assistant',display:disp,files:written.map(w=>w.path),stopped,t:nowTs()});
  saveChat();
  saveProject(); renderTreeSoon(); persistCurrentProject();
  if(written.length) refreshPreview();
  const td=window.__vfTermSink; if(td&&td.done) try{td.done(written);}catch(e){}
  setBusy(false);
}
function finalizeBubble(ui,disp,written,stopped){
  ui.caret.remove(); ui.root.classList.remove('stream');
  ui.bubble.innerHTML = disp.trim() ? renderRich(disp) : '<p class="typeline">(no message — just code)</p>';
  written.forEach(w=>fcard(ui.root,w.path,w.lines));
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
  renderAll(); restoreChatLog(); showView('preview');
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
  renderAll(); openInEditor('index.html'); showView('preview');
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
function openSettings(){
  state.ui.pickProv=activeProviderId();
  paintProvFields(activeProviderId());
  renderAcctBox();
  $id('settingsModal').hidden=false;
}
function renderStatusChip(){
  const cfg=activeConfig();
  const ready = cfg.noKey ? !!cfg.base || !!cfg.model : !!cfg.key;
  $id('provDot').className='dot '+(ready?'on':'off');
  $id('provChipText').textContent = (PROVIDERS[cfg.id]?.label||'no provider') +
    (ready && cfg.model ? ' · '+cfg.model.split('/').pop().slice(0,22) : '');
  document.title = (state.project.name||'untitled')+' — ANTROR Code';
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
  renderAll(); toast('Fresh canvas — describe what to build');
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
  const add=document.createElement('button'); add.className='primary'; add.style.marginTop='8px'; add.textContent='+ New project';
  add.addEventListener('click',()=>{ $id('projectsDrawer').hidden=true; newProject(); });
  local.appendChild(add);
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
    $id('acctSetup').addEventListener('click',()=>location.href='login.html');
    return;
  }
  const user=await VF.getUser();
  if(!user){
    box.innerHTML='<div class="acct-soon"><span><b>Supabase connected</b> — you are signed out.</span>'+
      '<button class="ghost" id="acctGo2">Sign in / Create account</button></div>';
    $id('acctGo2').addEventListener('click',()=>location.href='login.html');
    return;
  }
  const email=user.email||'user';
  const initial=email[0].toUpperCase();
  box.innerHTML='<div class="acct-user"><span class="avatar">'+esc(initial)+'</span>'+
    '<span class="acct-txt"><b>'+esc(email)+'</b><small>signed in via Supabase</small></span>'+
    '<button class="ghost danger" id="acctOut">Sign out</button></div>';
  $id('acctOut').addEventListener('click',async()=>{
    await VF.signOut(); toast('Signed out — projects stay on this device');
    renderAcctBox();
  });
}

/* ─────────────── sidebar user chip (footer) ─────────────── */
async function renderUserChip(){
  const av=$id('userAvatar'), name=$id('userName'), sub=$id('userSub');
  if(!av) return;
  let user=null;
  if(window.VF && VF.configured()) user=await VF.getUser();
  state.ui.signedIn=!!user;
  if(user){
    const email=user.email||'user';
    av.textContent=email[0].toUpperCase();
    name.textContent=email.split('@')[0];
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
  $id('umAccount').addEventListener('click',()=>{ menu.hidden=true; location.href='login.html'; });
  $id('umSettings').addEventListener('click',()=>{ menu.hidden=true; openSettings(); });
  $id('umSignout').addEventListener('click',async()=>{
    menu.hidden=true;
    if(window.VF && VF.configured()){
      await VF.signOut();
      toast('Signed out — projects stay on this device');
      renderUserChip(); renderAcctBox();
    }
  });
  document.addEventListener('click',(e)=>{
    if(!menu.hidden && !$id('userRow').contains(e.target)) menu.hidden=true;
  });
}

/* ─────────────── wiring / init ─────────────── */
function autoGrow(){
  const tb=$id('promptBox'); tb.style.height='auto';
  tb.style.height=Math.min(tb.scrollHeight,180)+'px';
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
  $id('promptBox').addEventListener('input',autoGrow);
  $id('stopBtn').addEventListener('click',()=>{ if(controller) controller.abort(); });
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
  // sidebar
  $id('btnNew').addEventListener('click',newProject);
  $id('btnZip').addEventListener('click',exportZip);
  $id('btnImport').addEventListener('click',importFolder);
  $id('importInput').addEventListener('change',(e)=>{ handleImportFiles(e.target.files); e.target.value=''; });
  $id('btnHistory').addEventListener('click',()=>{ renderHistory(); $id('historyDrawer').hidden=false; });
  $id('histClose').addEventListener('click',()=>$id('historyDrawer').hidden=true);
  $id('btnProjects').addEventListener('click',()=>{ persistCurrentProject(); renderProjectsDrawer(); $id('projectsDrawer').hidden=false; });
  $id('projClose').addEventListener('click',()=>$id('projectsDrawer').hidden=true);
  $id('btnSettings').addEventListener('click',openSettings);
  $id('provChip').addEventListener('click',openSettings);
  $id('setClose').addEventListener('click',()=>{ $id('settingsModal').hidden=true; renderStatusChip(); });
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
  // workspace data (Settings)
  $id('btnExpAll').addEventListener('click',exportZip);
  $id('btnWipeChat').addEventListener('click',()=>{
    if(!state.chat.length || !confirm('Clear this project’s conversation?')) return;
    state.chat=[]; $id('chatLog').innerHTML=''; saveChat(); persistCurrentProject(); toast('Conversation cleared');
  });
  $id('btnWipeProj').addEventListener('click',()=>{
    if(!confirm('Delete all FILES of the current project? The chat stays.')) return;
    state.project.files={}; saveProject(); persistCurrentProject();
    state.ui.tabs=[]; state.ui.open=null; renderTabs(); loadEditor(); renderTree(); refreshPreview();
    toast('Files deleted');
  });
  $id('btnWipeAll').addEventListener('click',()=>{
    if(!confirm('Erase EVERYTHING — keys, all projects, chat and history? This cannot be undone.')) return;
    if(!confirm('Really sure? Last chance.')) return;
    try{ ['vf.v1.settings','vf.v1.project','vf.v1.chat','vf.v1.checkpoints','vf.v1.projects','vf.v1.supabase'].forEach(k=>localStorage.removeItem(k)); }catch(e){}
    location.reload();
  });
  $id('btnPopOut').addEventListener('click',()=>{
    const doc=buildPreviewDoc();
    if(doc==null){ toast('Nothing to pop out yet'); return; }
    const url=URL.createObjectURL(new Blob([SHIM+doc],{type:'text/html'}));
    const w=window.open(url,'_blank');
    if(!w){ toast('Pop-up blocked 😅','err'); return; }
    setTimeout(()=>URL.revokeObjectURL(url), 20000);
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
  // settings modal internals
  provCards($id('provGrid'), activeProviderId(), paintProvFields);
  $id('btnSaveSet').addEventListener('click',()=>{
    const cfg=configFromUI();
    state.settings.provider=cfg.id;
    if(cfg.noKey){ delete state.settings.keys[cfg.id]; }
    else{
      if(!cfg.key){ const h=$id('provHint'); h.className='hint err'; h.textContent='A key is required for this provider.'; return; }
      state.settings.keys[cfg.id]=cfg.key;
    }
    if(cfg.base && cfg.base!==PROVIDERS[cfg.id].base) state.settings.bases[cfg.id]=cfg.base; else delete state.settings.bases[cfg.id];
    if(cfg.model && cfg.model!==PROVIDERS[cfg.id].model) state.settings.models[cfg.id]=cfg.model; else delete state.settings.models[cfg.id];
    state.settings.onboarded=true;
    saveSettings(); renderStatusChip();
    $id('settingsModal').hidden=true;
    toast('⚙ Saved — '+PROVIDERS[cfg.id].label+(cfg.model?' · '+cfg.model:''),'ok');
  });
  $id('btnForget').addEventListener('click',()=>{
    const id=state.ui.pickProv;
    delete state.settings.keys[id]; saveSettings();
    paintProvFields(id); renderStatusChip();
    toast('Key erased for '+PROVIDERS[id].label);
  });
  $id('btnTestKey').addEventListener('click',async ()=>{
    const cfg=configFromUI();
    const h=$id('provHint'); h.className='hint'; h.textContent='pinging '+PROVIDERS[cfg.id].label+' …';
    try{
      await probe(cfg);
      h.className='hint ok'; h.textContent='✓ connected — the model answered!';
    }catch(err){
      h.className='hint err'; h.innerHTML=friendlyError(err,cfg);
    }
  });
  // hero
  state.ui.heroSel=activeProviderId();
  heroPaint(state.ui.heroSel);
  $id('heroStart').addEventListener('click',heroGo);
  $id('heroKey').addEventListener('keydown',(e)=>{ if(e.key==='Enter')heroGo(); });
  $id('heroSkip').addEventListener('click',()=>{ $id('welcome').hidden=true; state.settings.onboarded=true; saveSettings(); });
  // chat head: collapse + clear
  $id('btnChatToggle').addEventListener('click',()=>setChatOpen(false));
  // mobile fab — reopens the panel when collapsed, toggles the overlay on small screens
  $id('chatFab').addEventListener('click',()=>{
    if(document.body.classList.contains('nochat')) setChatOpen(true);
    else $id('chatPanel').classList.toggle('open');
  });
  if(state.ui.chatOpen===false) setChatOpen(false);
  // esc closes overlays
  addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){ ['settingsModal','historyDrawer'].forEach(id=>$id(id).hidden=true); $id('chatPanel').classList.remove('open'); }
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
  if(!state.settings.onboarded) $id('welcome').hidden=false;
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

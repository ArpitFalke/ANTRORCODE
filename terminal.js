/* ════════════════════════════════════════════════════════════════
   ANTROR Code — "antror cli": a real terminal over the project.
   Shell commands run on the virtual filesystem; anything that is
   not a command goes straight to the AI (like Claude Code / Codex).
   Loaded after app.js — uses its globals deliberately.
   ════════════════════════════════════════════════════════════════ */
'use strict';
(function(){

const HIST_KEY = 'vf.v1.termhist';
const out   = () => $id('termOut');
const input = () => $id('termIn');
let hist = loadJSON(HIST_KEY, []);
let hIdx = null;
let open = false;
let aiBusy = false;
let bannerShown = false;

/* ── output helpers ── */
function line(text, cls){
  const d=document.createElement('div');
  d.className='tl'+(cls?' '+cls:'');
  d.textContent=text;
  out().appendChild(d);
  out().scrollTop=out().scrollHeight;
  return d;
}
function lineHTML(html, cls){
  const d=document.createElement('div');
  d.className='tl'+(cls?' '+cls:'');
  d.innerHTML=html;
  out().appendChild(d);
  out().scrollTop=out().scrollHeight;
  return d;
}
function preBlock(text){
  const d=document.createElement('div');
  d.className='tl pre';
  d.textContent=text;
  out().appendChild(d); out().scrollTop=out().scrollHeight;
  return d;
}
function promptText(){ return 'antror ~ '+(state.project.name||'untitled')+' $'; }
function echoCmd(l){ lineHTML('<b>'+esc(promptText())+'</b> '+esc(l), 'cmd'); }

/* ── tiny levenshtein for "did you mean" ── */
function lev(a,b){
  const m=[...Array(a.length+1)].map((_,i)=>[i,...Array(b.length).fill(0)]);
  for(let j=0;j<=b.length;j++) m[0][j]=j;
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++)
    m[i][j]=Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return m[a.length][b.length];
}

/* ── AI run (bridges into app.js sendPrompt via __vfTermSink) ── */
const SPIN=['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
async function aiRun(promptText){
  if(aiBusy){ line('antror cli is already building — stop it first with Ctrl+C.', 'err'); return; }
  const cfg = ensureConfigured();
  if(!cfg){ line('No model connected. Open ⚙ Settings and paste an API key (or pick Ollama).', 'err'); return; }
  aiBusy=true;
  let spin=null, status=null, frame=0, chars=0, writtenCount=0;
  status=line('', 'dim');
  spin=setInterval(()=>{
    status.textContent=SPIN[frame++%SPIN.length]+' building… '+chars+' chars from '+cfg.model+(writtenCount?' · '+writtenCount+' file(s) written':'');
  },90);
  window.__vfTermSink={
    delta(raw, n){ chars=raw.length; writtenCount=n; },
    error(err){ clearInterval(spin); status.remove();
      lineHTML(friendlyError(err,cfg), 'err');
      line('full details are in the chat panel →', 'dim'); },
    done(written){ clearInterval(spin); status.remove();
      if(written.length){
        line('✓ wrote '+written.length+' file(s): '+written.map(w=>w.path).join(', '), 'ok');
        line('preview refreshed — watch the stage ◀  (full reply in chat →)', 'dim');
      } else line('✓ done — no files changed (reply is in the chat panel →)', 'ok'); },
  };
  try{ await sendPrompt(promptText); }
  catch(e){ clearInterval(spin); try{status.remove();}catch(_){ } line('failed — '+(e.message||e), 'err'); }
  finally{ window.__vfTermSink=null; aiBusy=false; }
}

/* ── commands ── */
const FILES_WITH = ['cat','open','rm','mv','cp','touch','grep'];
const COMMANDS = {
  help(){
    lineHTML('<b>antror cli</b> — shell over your project + AI in the loop. Commands:');
    const rows=[
      ['ls', 'list project files'],
      ['cat <file>', 'print a file'],
      ['open <file>', 'open a file in the code editor'],
      ['touch <file>', 'create an empty file'],
      ['echo text > file', 'write text to a file'],
      ['rm <file>', 'delete a file'],
      ['cp / mv <a> <b>', 'copy / rename a file'],
      ['grep <text>', 'search all files'],
      ['preview · code · run', 'switch stage view / re-run preview'],
      ['zip', 'export the project as .zip'],
      ['new [name]', 'start a fresh project (current one is kept)'],
      ['projects', 'list saved projects'],
      ['sample landing|todo|game', 'load a sample project'],
      ['history', 'list checkpoints'],
      ['restore <n>', 'restore checkpoint n'],
      ['ai <prompt>', 'ask the AI to build/change things'],
      ['(free text)', 'anything unknown goes to the AI too'],
      ['!<command>', 'run a REAL command on this device — asks permission (node bridge/bridge.js)'],
      ['git …', 'snapshots + GitHub: init/commit/log, clone/push/pull — git help'],
      ['provider · key', 'show / set the active model + key'],
      ['whoami · login · logout', 'account status / open login / sign out'],
      ['clear · date · about', 'housekeeping'],
    ];
    rows.forEach(([c,d])=>lineHTML('<span style="color:#fff">'+esc(c.padEnd(26,' '))+'</span><span style="color:#5c5c5c">'+esc(d)+'</span>','pre'));
    line('shortcuts: ↑/↓ history · Tab complete · Ctrl+L clear · Ctrl+C stop AI · Ctrl+` toggle terminal', 'dim');
  },
  clear(){ out().innerHTML=''; },
  date(){ line(new Date().toString()); },
  about(){
    line('ANTROR Code v1.0 — describe it. ship it.');
    line('a product by ANTROR © 2026 — browser-only, keys stay local.', 'dim');
  },
  ls(){
    const paths=Object.keys(state.project.files).sort();
    if(!paths.length){ line('(empty — nothing built yet. try: ai a neon todo app)', 'dim'); return; }
    paths.forEach(p=>line(p.padEnd(34,' ')+' '+fmtBytes(state.project.files[p].length)));
  },
  cat(args){
    const p=args[0]; if(!p){ line('usage: cat <file>', 'err'); return; }
    if(!(p in state.project.files)){ line('cat: no such file: '+p, 'err'); return; }
    preBlock(state.project.files[p]);
  },
  open(args){
    const p=args[0];
    if(!p || !(p in state.project.files)){ line('open: no such file: '+(p||''), 'err'); return; }
    openInEditor(p); line('opened '+p+' in the editor ✓', 'ok');
  },
  touch(args){
    const p=args[0];
    if(!p){ line('usage: touch <file>', 'err'); return; }
    if(p in state.project.files){ line('touch: '+p+' already exists', 'dim'); return; }
    applyFile(p, '');
    saveProject(); renderTree(); refreshPreview();
    line('created '+p, 'ok');
  },
  rm(args){
    const p=args[0];
    if(!p || !(p in state.project.files)){ line('rm: no such file: '+(p||''), 'err'); return; }
    delete state.project.files[p];
    state.ui.tabs=state.ui.tabs.filter(t=>t!==p);
    if(state.ui.open===p){ state.ui.open=state.ui.tabs[state.ui.tabs.length-1]||null; loadEditor(); }
    renderTabs(); saveProject(); persistCurrentProject(); renderTree(); refreshPreview();
    line('deleted '+p, 'ok');
  },
  cp(args){
    const [a,b]=args;
    if(!a||!b||!(a in state.project.files)){ line('usage: cp <src> <dst>', 'err'); return; }
    applyFile(b, state.project.files[a]);
    saveProject(); renderTree(); refreshPreview();
    line('copied '+a+' → '+b, 'ok');
  },
  mv(args){
    const [a,b]=args;
    if(!a||!b||!(a in state.project.files)){ line('usage: mv <src> <dst>', 'err'); return; }
    applyFile(b, state.project.files[a]);
    delete state.project.files[a];
    const ti=state.ui.tabs.indexOf(a); if(ti>=0) state.ui.tabs[ti]=b;
    if(state.ui.open===a) state.ui.open=b;
    renderTabs(); loadEditor(); saveProject(); persistCurrentProject(); renderTree(); refreshPreview();
    line('moved '+a+' → '+b, 'ok');
  },
  echo(args, raw){
    const m=raw.match(/^echo\s+([\s\S]*?)\s*>\s*(\S+)\s*$/);
    if(m){ applyFile(m[2], m[1].replace(/^["']|["']$/g,'')+'\n');
      saveProject(); renderTree(); refreshPreview();
      line('wrote '+m[2], 'ok'); return; }
    line(args.join(' '));
  },
  tree(){
    const paths=Object.keys(state.project.files).sort();
    if(!paths.length){ line('(empty project)','dim'); return; }
    const dirs={};
    paths.forEach(p=>{
      const parts=p.split('/');
      let prefix='';
      parts.forEach((seg,i)=>{
        const parent=prefix; prefix=prefix?prefix+'/'+seg:seg;
        if(i<parts.length-1) dirs[parent]=dirs[parent]||new Set(), dirs[parent].add(seg);
      });
    });
    const drawn=new Set();
    const walk=(prefix,depth)=>{
      Object.keys(state.project.files).filter(p=>p.startsWith(prefix?prefix+'/':'')).sort().forEach(p=>{
        const rest=p.slice(prefix?prefix.length+1:0);
        const top=rest.split('/')[0];
        const isDir=rest.includes('/');
        const key=(prefix?prefix+'/':'')+top;
        if(isDir){ if(!drawn.has(key)){ drawn.add(key); line('  '.repeat(depth)+'📁 '+top+'/'); walk(key,depth+1); } }
        else line('  '.repeat(depth)+'  '+top+'  '+fmtBytes(state.project.files[p].length));
      });
    };
    walk('',0);
    line(paths.length+' file(s)','dim');
  },
  grep(args){
    const q=args.join(' ').toLowerCase();
    if(!q){ line('usage: grep <text>', 'err'); return; }
    let hits=0;
    Object.keys(state.project.files).forEach(p=>{
      state.project.files[p].split('\n').forEach((l,i)=>{
        if(l.toLowerCase().includes(q)){ hits++; lineHTML('<span style="color:#fff">'+esc(p)+':'+(i+1)+'</span> '+esc(l.trim().slice(0,160))); }
      });
    });
    if(!hits) line('no matches for “'+q+'”', 'dim');
  },
  preview(){ showView('preview'); line('preview ◀', 'ok'); },
  code(){ showView('code'); line('code editor ◀', 'ok'); },
  run(){ showView('preview'); refreshPreview(); line('re-ran the preview ✓', 'ok'); },
  zip(){ exportZip(); line('exporting zip… (check your downloads)', 'dim'); },
  new(args){
    newProject();
    const name=args.join(' ').trim();
    if(name){ state.project.name=name.slice(0,40); persistCurrentProject();
      $id('projName').textContent=state.project.name; renderStatusChip(); }
    line('fresh project: '+(state.project.name||'untitled')+' — previous one is safe in Projects', 'ok');
  },
  projects(){
    if(!state.projects.length){ line('no saved projects yet', 'dim'); return; }
    state.projects.forEach(p=>{
      const cur=p.id===state.project.id;
      line((cur?'▶ ':'  ')+p.name.padEnd(24,' ')+Object.keys(p.files||{}).length+' files  '+fmtTime(p.updatedAt||nowTs())+(p.cloudId?'  ☁':''));
    });
    line('switch from the Projects drawer (🗂 in the sidebar) — nothing is ever erased', 'dim');
  },
  sample(args){
    const k=(args[0]||'').toLowerCase();
    if(!SAMPLES[k]){ line('usage: sample landing|todo|game', 'err'); return; }
    loadSample(k); line('loaded sample: '+SAMPLES[k].name, 'ok');
  },
  history(){
    if(!state.checkpoints.length){ line('no checkpoints yet — one is captured before every AI run', 'dim'); return; }
    state.checkpoints.forEach((c,i)=>{
      line(('#'+i).padEnd(5)+' '+fmtTime(c.t)+'  '+String(c.label||'(untitled)').slice(0,44).padEnd(46)+' '+Object.keys(c.files).length+' files');
    });
    line('restore with: restore <n>', 'dim');
  },
  restore(args){
    const n=parseInt(args[0],10);
    const cp=state.checkpoints[n];
    if(!cp){ line('usage: restore <n> — see history', 'err'); return; }
    pushCheckpoint('before restore (cli)');
    state.project.files=clone(cp.files); saveProject();
    state.ui.tabs=[]; state.ui.open=null; renderTabs(); loadEditor();
    renderTree(); showView('preview'); persistCurrentProject();
    line('restored checkpoint #'+n+' ✓', 'ok');
  },
  provider(){
    const c=activeConfig();
    line('provider  '+(PROVIDERS[c.id]?.label||c.id));
    line('model     '+c.model);
    line('endpoint  '+c.base);
    line('api key   '+(c.noKey?'(not needed)':(c.key?'✓ saved ('+c.key.slice(0,4)+'…'+c.key.slice(-3)+')':'✗ none — open ⚙ Settings')), c.noKey||c.key?'':'err');
  },
  key(args, raw){
    const sub=args[0];
    const id=activeProviderId();
    if(sub==='clear'){ delete state.settings.keys[id]; saveSettings(); renderStatusChip(); line('key erased for '+PROVIDERS[id].label, 'ok'); return; }
    if(sub==='set'){
      const k=raw.replace(/^key\s+set\s+/,'').trim();
      if(!k){ line('usage: key set <api-key>', 'err'); return; }
      state.settings.keys[id]=k; saveSettings(); renderStatusChip();
      line('key saved for '+PROVIDERS[id].label+' ✓ (stored only in this browser)', 'ok'); return;
    }
    COMMANDS.provider();
    line('set with: key set <api-key>   ·   remove with: key clear', 'dim');
  },
  async whoami(){
    if(window.VF && VF.configured()){
      const u=await VF.getUser();
      line(u ? ('signed in as '+(u.email||u.id)+' (Supabase)')
             : 'supabase connected, signed out — anonymous (local only)');
    } else line('anonymous — local only. sign in: login', 'dim');
  },
  login(){ go('login'); },
  register(){ go('register'); },
  logout(){
    if(window.VF && VF.configured()){ VF.signOut(); line('signed out — projects stay on this device', 'ok'); }
    else line('not signed in', 'dim');
  },
  ai(args, raw){
    const p=raw.replace(/^ai\s+/,'').trim();
    if(!p){ line('usage: ai <what to build or change>', 'err'); return; }
    return aiRun(p);
  },
  sh(args, raw){
    const c=raw.replace(/^(!|sh)\s?/,'').trim();
    if(!c){ line('usage: !<command>  — runs a REAL command on this device (asks permission first). e.g.  !npm install', 'err'); return; }
    return bridgeRun(c);
  },
  git(args, raw){
    const sub=args[0];
    if(!sub || sub==='help' || sub==='--help'){
      GIT_HELP.forEach(([c,d])=>lineHTML('<span style="color:#fff">'+esc(('git '+c).padEnd(30,' '))+'</span><span style="color:#5c5c5c">'+esc(d)+'</span>','pre'));
      return;
    }
    const r=gitRepo(true);
    const ch=gitChanges(r);
    const nChanged=ch.added.length+ch.modified.length+ch.deleted.length;
    switch(sub){
      case 'init':
        line('✓ tracking “'+(state.project.name||'untitled')+'” — snapshots live in this browser','ok'); return;
      case 'add': {
        const what=args[1];
        if(!what){ line('usage: git add .  or  git add <file>','err'); return; }
        if(what==='.'){ r.staged=[...new Set([...r.staged,...ch.added,...ch.modified,...ch.deleted])]; }
        else{
          if(!(what in state.project.files) && !ch.deleted.includes(what)){ line('git add: no such file: '+what,'err'); return; }
          r.staged=[...new Set([...r.staged,what])];
        }
        gitSaveRepo(r);
        line('staged '+r.staged.length+' path(s)','ok'); return;
      }
      case 'status': {
        line('on '+(r.remote?'remote '+r.remote.repo+'#'+r.remote.branch:'local only (no remote)'));
        if(r.staged.length) line('staged:  '+r.staged.join(', '),'ok');
        if(ch.added.length) line('new:     '+ch.added.join(', '));
        if(ch.modified.length) line('changed: '+ch.modified.join(', '));
        if(ch.deleted.length) line('deleted: '+ch.deleted.join(', '));
        if(!nChanged && !r.staged.length) line('clean — nothing to commit','dim');
        return;
      }
      case 'commit': {
        if(!nChanged && !r.staged.length){ line('nothing to commit — working tree clean','dim'); return; }
        let msg=(raw.match(/-m\s+["']([\s\S]*?)["']/)||[])[1];
        if(!msg) msg=args.slice(1).join(' ').replace(/^-m\s*/,'').replace(/^["\']|["\']$/g,'').trim();
        if(!msg) msg='update — '+new Date().toLocaleString();
        const target=(r.staged.length? r.staged : [...ch.added,...ch.modified,...ch.deleted]);
        const files=clone(gitHead(r));
        target.forEach(p=>{
          if(p in state.project.files) files[p]=state.project.files[p];
          else delete files[p];
        });
        const h=gitHash();
        r.commits.push({h,m:msg,t:nowTs(),files});
        while(r.commits.length>25) r.commits.shift();
        r.staged=[]; gitSaveRepo(r);
        line('['+h+'] '+msg+'  ('+target.length+' path(s))','ok'); return;
      }
      case 'log': {
        if(!r.commits.length){ line('no commits yet — git add . && git commit -m "first"','dim'); return; }
        r.commits.forEach((c,i)=>line(('#'+i).padEnd(4)+c.h+'  '+fmtTime(c.t)+'  '+c.m));
        return;
      }
      case 'checkout': {
        const n=parseInt(args[1],10);
        const c=r.commits[n];
        if(!c){ line('usage: git checkout <n> — see git log','err'); return; }
        pushCheckpoint('before git checkout #'+n);
        state.project.files=clone(c.files); saveProject();
        state.ui.tabs=[]; state.ui.open=null; renderTabs(); loadEditor();
        renderTree(); showView('preview'); persistCurrentProject();
        line('HEAD is now at '+c.h+' — '+c.m,'ok'); return;
      }
      case 'connect': {
        const m=String(args[1]||'').replace(/^https:\/\/github\.com\//,'').replace(/\.git$/,'');
        if(!/^[\w.-]+\/[\w.-]+$/.test(m)){ line('usage: git connect <owner/repo>','err'); return; }
        line('checking '+m+' …','dim');
        return gh('/repos/'+m,{},gitToken()).then(meta=>{
          r.remote={repo:m,branch:meta.default_branch||'main'}; gitSaveRepo(r);
          line('✓ remote set: '+m+' ('+r.remote.branch+')','ok');
          if(!gitToken()) line('push will need a token: git token <pat> — clone/pull work without one for public repos','dim');
        }).catch(e=>line('could not reach that repo — '+(e.message||e),'err'));
      }
      case 'clone': return gitClone(args[1]).catch(e=>line('clone failed — '+(e.message||e),'err'));
      case 'push': return gitPush(args, raw).catch(e=>line('push failed — '+(e.message||e),'err'));
      case 'pull': return gitPull().catch(e=>line('pull failed — '+(e.message||e),'err'));
      case 'token': {
        if(args[1]==='clear'){ delete state.settings.gitToken; saveSettings(); line('token erased','ok'); return; }
        const t=String(args[1]||'');
        if(!t){ line('usage: git token <personal-access-token>   ·   remove: git token clear','err'); return; }
        state.settings.gitToken=t; saveSettings();
        line('✓ token saved — stored only in this browser, used only for api.github.com','ok'); return;
      }
      case 'remote':
        line(r.remote ? (r.remote.repo+'  ·  branch '+r.remote.branch) : 'no remote — git connect <owner/repo>','dim'); return;
      default:
        line('unknown git subcommand “'+sub+'” — git help','err');
    }
  },
};
COMMANDS.build=COMMANDS.ai;
COMMANDS.make=COMMANDS.ai;

/* ── git: snapshots in this browser + real GitHub remotes over the REST API ── */
const GIT_KEY='vf.v1.git';
const GIT_EXTS=['html','htm','css','js','mjs','cjs','jsx','ts','tsx','json','md','svg','txt','xml','yml','yaml','csv','webmanifest'];
function gitRepo(create){
  const s=loadJSON(GIT_KEY,{});
  const id=state.project.id||'local';
  if(!s[id] && create){ s[id]={commits:[],staged:[],remote:null}; save(GIT_KEY,s); }
  return s[id]||null;
}
function gitSaveRepo(r){
  const s=loadJSON(GIT_KEY,{});
  s[state.project.id||'local']=r;
  save(GIT_KEY,s);
}
function gitHead(r){ const c=r&&r.commits[r.commits.length-1]; return c?c.files:{}; }
function gitHash(){ let h=''; for(let i=0;i<7;i++) h+='0123456789abcdef'[Math.floor(Math.random()*16)]; return h; }
function gitChanges(r){
  const head=gitHead(r), work=state.project.files;
  const ch={added:[],modified:[],deleted:[]};
  Object.keys(work).forEach(p=>{
    if(!(p in head)) ch.added.push(p);
    else if(work[p]!==head[p]) ch.modified.push(p);
  });
  Object.keys(head).forEach(p=>{ if(!(p in work)) ch.deleted.push(p); });
  return ch;
}
function gh(path, opts={}, token){
  return fetch('https://api.github.com'+path, Object.assign({},opts,{
    headers:Object.assign({'Accept':'application/vnd.github+json'}, opts.headers||{}, token?{Authorization:'Bearer '+token}:{})
  })).then(async r=>{
    if(!r.ok){ let d=''; try{ d=(await r.json()).message||''; }catch(e){}
      throw new Error('GitHub '+r.status+(d?' — '+d:'')); }
    return r.json();
  });
}
function b64ToText(b64){ return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g,'')), c=>c.charCodeAt(0))); }
function gitToken(){ return state.settings.gitToken||''; }

const GIT_HELP=[
  ['git init','start tracking this project (browser snapshots)'],
  ['git add . | <file>','stage changes'],
  ['git status','what changed vs the last commit'],
  ['git commit -m "msg"','commit staged (or all) changes'],
  ['git log','history of commits'],
  ['git checkout <n>','restore commit #n'],
  ['git connect <owner/repo>','link a GitHub repo as remote'],
  ['git clone <owner/repo>','open a GitHub repo as a new project'],
  ['git push [-m "msg"]','push the project to GitHub (needs token)'],
  ['git pull','fetch + apply remote changes here'],
  ['git token <pat>','save a GitHub personal access token (stays local)'],
  ['git remote','show the linked repo'],
];

async function gitClone(arg){
  const m=String(arg||'').replace(/^https:\/\/github\.com\//,'').replace(/\.git$/,'').replace(/\/+$/,'');
  if(!/^[\w.-]+\/[\w.-]+$/.test(m)){ line('usage: git clone <owner/repo>  (or a github.com URL)','err'); return; }
  line('cloning '+m+' …','dim');
  const token=gitToken();
  const meta=await gh('/repos/'+m,{},token);
  const branch=meta.default_branch||'main';
  const tree=await gh('/repos/'+m+'/git/trees/'+branch+'?recursive=1',{},token);
  const blobs=(tree.tree||[]).filter(t=>t.type==='blob');
  if(!blobs.length){ line('repo has no files on branch '+branch,'err'); return; }
  persistCurrentProject();
  state.project=blankProject(m.split('/')[1]||m);
  state.chat=[]; $id('chatLog').innerHTML='';
  state.checkpoints=[]; saveChecks();
  state.ui.tabs=[]; state.ui.open=null;
  let n=0, skipped=0;
  for(const t of blobs){
    if(!GIT_EXTS.includes(t.path.split('.').pop().toLowerCase()) || t.size>300000){ skipped++; continue; }
    try{ const b=await gh('/repos/'+m+'/git/blobs/'+t.sha,{},token); state.project.files[t.path]=b64ToText(b.content); n++; }
    catch(e){ skipped++; }
    if(n>=80) break;
  }
  if(!n){ line('no readable text files found (binaries skipped)','err'); return; }
  saveProject(); saveChat(); persistCurrentProject();
  renderAll(); restoreChatLog(); showView('preview'); setChatOpen(true);
  const r=gitRepo(true);
  r.remote={repo:m,branch};
  r.commits=[{h:gitHash(),m:'clone '+m+'#'+branch,t:nowTs(),files:clone(state.project.files)}];
  r.staged=[]; gitSaveRepo(r);
  line('✓ cloned '+n+' file(s) from '+m+' ('+branch+')'+(skipped?' · skipped '+skipped+' binary/large':''),'ok');
}

async function gitPush(args, raw){
  const r=gitRepo(true);
  if(!r.remote){ line('no remote — first: git connect <owner/repo>','err'); return; }
  const token=gitToken();
  if(!token){ line('push needs a GitHub token (classic, with repo scope). run: git token <pat>\ncreate one: https://github.com/settings/tokens/new','err'); return; }
  const {repo,branch}=r.remote;
  // auto-commit pending work first
  const ch=gitChanges(r);
  const pending=ch.added.length+ch.modified.length+ch.deleted.length;
  if(pending){
    let msg=(raw.match(/-m\s+["']([\s\S]*?)["']/)||[])[1] || 'ANTROR Code update — '+new Date().toLocaleString();
    r.commits.push({h:gitHash(),m:msg,t:nowTs(),files:clone(state.project.files)});
    while(r.commits.length>25) r.commits.shift();
    r.staged=[];
  }
  gitSaveRepo(r);
  line('pushing '+repo+'@'+branch+' …','dim');
  const ref=await gh('/repos/'+repo+'/git/ref/heads/'+encodeURIComponent(branch),{},token);
  const baseSha=ref.object.sha;
  const baseCommit=await gh('/repos/'+repo+'/git/commits/'+baseSha,{},token);
  const entries=Object.entries(state.project.files);
  if(!entries.length){ line('project is empty — nothing to push','dim'); return; }
  if(entries.length>60) line('large project — pushing first 60 files','dim');
  const treeItems=[];
  for(const [p,c] of entries.slice(0,60)){
    const b=await gh('/repos/'+repo+'/git/blobs',{method:'POST',body:JSON.stringify({content:c,encoding:'utf-8'})},token);
    treeItems.push({path:p,mode:'100644',type:'blob',sha:b.sha});
  }
  const tree=await gh('/repos/'+repo+'/git/trees',{method:'POST',body:JSON.stringify({base_tree:baseCommit.tree.sha,tree:treeItems})},token);
  const msg=r.commits[r.commits.length-1].m||'ANTROR Code push';
  const c=await gh('/repos/'+repo+'/git/commits',{method:'POST',body:JSON.stringify({message:msg,tree:tree.sha,parents:[baseSha]})},token);
  await gh('/repos/'+repo+'/git/refs/heads/'+encodeURIComponent(branch),{method:'PATCH',body:JSON.stringify({sha:c.sha})},token);
  gitSaveRepo(r);
  line('✓ pushed '+treeItems.length+' file(s) to '+repo+'@'+branch+' — commit '+c.sha.slice(0,7),'ok');
  line('view it: https://github.com/'+repo+'/tree/'+branch,'dim');
}

async function gitPull(){
  const r=gitRepo(true);
  if(!r.remote){ line('no remote — first: git connect <owner/repo>','err'); return; }
  const {repo,branch}=r.remote;
  line('pulling '+repo+'@'+branch+' …','dim');
  const token=gitToken();
  const tree=await gh('/repos/'+repo+'/git/trees/'+encodeURIComponent(branch)+'?recursive=1',{},token);
  const blobs=(tree.tree||[]).filter(t=>t.type==='blob');
  let n=0, skipped=0;
  for(const t of blobs){
    if(!GIT_EXTS.includes(t.path.split('.').pop().toLowerCase()) || t.size>300000){ skipped++; continue; }
    try{ const b=await gh('/repos/'+repo+'/git/blobs/'+t.sha,{},token); state.project.files[t.path]=b64ToText(b.content); n++; }
    catch(e){ skipped++; }
    if(n>=80) break;
  }
  saveProject(); renderTree(); refreshPreview(); persistCurrentProject();
  if(n) pushCheckpoint('git pull '+repo);
  const last=r.commits[r.commits.length-1];
  r.commits.push({h:gitHash(),m:'pull '+repo+'#'+branch,t:nowTs(),files:clone(state.project.files)});
  while(r.commits.length>25) r.commits.shift();
  gitSaveRepo(r);
  line('✓ pulled '+n+' file(s)'+(skipped?' (skipped '+skipped+')':'')+' — local extras kept','ok');
}

/* ── device bridge: run REAL commands on this machine (with permission) ── */
async function bridgeRun(cmd){
  /* desktop app → native, permission via the OS dialog, no bridge needed */
  if(window.antrorAPI){
    line('$ '+cmd, 'cmd');
    let status=line('… running (2 min timeout)', 'dim');
    try{
      const j=await window.antrorAPI.runCommand(cmd);
      status.remove();
      if(j.denied){ line('denied — nothing ran', 'dim'); return; }
      if(j.stdout) preBlock(j.stdout);
      if(j.stderr){ const e=preBlock(j.stderr); e.className='tl pre err'; }
      line(j.code===0?'✓ exit 0':'exit '+j.code, j.code===0?'ok':'err');
    }catch(e){ status.remove(); line('failed — '+(e.message||e), 'err'); }
    return;
  }
  const tok=(state.settings.bridge||{}).token;
  if(!tok){
    line('device bridge not set up:', 'err');
    line('  1. in a terminal run:  node bridge/bridge.js');
    line('  2. paste its token into ⚙ Settings → Device bridge', 'dim');
    return;
  }
  if(!confirm('ANTROR Code wants to run this command on YOUR device:\n\n  '+cmd+'\n\nAllow?')){
    line('denied — nothing ran', 'dim'); return;
  }
  line('$ '+cmd, 'cmd');
  let status=line('… running (2 min timeout)', 'dim');
  try{
    const r=await fetch('http://127.0.0.1:8765/run',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
      body:JSON.stringify({cmd}),
    });
    const j=await r.json();
    status.remove();
    if(j.error){ line('bridge: '+j.error, 'err'); return; }
    if(j.stdout) preBlock(j.stdout);
    if(j.stderr) { const e=preBlock(j.stderr); e.className='tl pre err'; }
    line(j.code===0?'✓ exit 0':'exit '+j.code, j.code===0?'ok':'err');
    line('note: the bridge runs commands in its own folder — files it changes are not auto-imported (use 📂 Import folder if needed)', 'dim');
  }catch(e){
    status.remove();
    line('bridge unreachable — start it:  node bridge/bridge.js  (⚙ Settings → Device bridge to test)', 'err');
  }
}

/* ── dispatch ── */
function exec(raw){
  echoCmd(raw);
  const l=raw.trim();
  if(!l) return;
  hist.push(l); while(hist.length>80) hist.shift(); hIdx=null;
  try{ localStorage.setItem(HIST_KEY, JSON.stringify(hist)); }catch(e){}
  const parts=l.split(/\s+/);
  const cmd=parts[0], rest=parts.slice(1);
  if(cmd.startsWith('!')){                       // !npm install … → device
    const c=l.slice(1).trim();
    if(!c){ line('usage: !<command> — e.g.  !npm install', 'err'); return; }
    const r=bridgeRun(c); if(r&&r.catch) r.catch(e=>line('error — '+(e.message||e),'err'));
    return;
  }
  if(Object.prototype.hasOwnProperty.call(COMMANDS, cmd)){
    try{ const r=COMMANDS[cmd](rest, l); if(r&&r.catch) r.catch(e=>line('error — '+(e.message||e),'err')); }
    catch(e){ line('error — '+(e.message||e), 'err'); }
    return;
  }
  // not a command → closest suggestion or straight to the AI
  let best=null, bd=4;
  Object.keys(COMMANDS).forEach(k=>{ const d=lev(cmd,k); if(d<bd){ bd=d; best=k; } });
  if(best && bd<=2){ line('unknown command “'+cmd+'” — did you mean “'+best+'”? (or send it to the AI: ai …)', 'err'); return; }
  line('(not a command — sending to the AI…)', 'dim');
  aiRun(l);
}

/* ── completion ── */
function complete(){
  const v=input().value;
  const parts=v.split(/\s+/);
  if(parts.length<=1){
    const names=Object.keys(COMMANDS).filter(k=>k.startsWith(parts[0]||''));
    if(names.length===1){ input().value=names[0]+' '; return; }
    if(names.length>1) line(names.join('  '), 'dim');
    return;
  }
  const fileCmds=FILES_WITH.includes(parts[0]);
  if(!fileCmds) return;
  const frag=parts[parts.length-1];
  const cands=Object.keys(state.project.files).filter(p=>p.startsWith(frag));
  if(cands.length===1){
    parts[parts.length-1]=cands[0];
    input().value=parts.join(' ');
  } else if(cands.length>1) line(cands.join('  '), 'dim');
}

/* ── input bindings ── */
function bindTerm(){
  $id('btnTerm').addEventListener('click',toggle);
  $id('termClose').addEventListener('click',toggle);
  $id('termForm').addEventListener('submit',(e)=>{
    e.preventDefault();
    const v=input().value;
    input().value='';
    exec(v);
  });
  input().addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){ e.preventDefault(); toggle(); return; }
    if(e.key==='Tab'){ e.preventDefault(); complete(); return; }
    if(e.key==='ArrowUp'){ e.preventDefault();
      if(!hist.length) return;
      hIdx = hIdx==null ? hist.length-1 : Math.max(0,hIdx-1);
      input().value=hist[hIdx]||''; return; }
    if(e.key==='ArrowDown'){ e.preventDefault();
      if(hIdx==null) return;
      hIdx++;
      if(hIdx>=hist.length){ hIdx=null; input().value=''; }
      else input().value=hist[hIdx];
      return; }
    if(e.key==='l' && e.ctrlKey){ e.preventDefault(); COMMANDS.clear(); return; }
    if(e.key==='c' && e.ctrlKey){
      if(aiBusy && controller){ controller.abort(); line('^C — stopping the AI…', 'dim'); }
      else { line('^C', 'dim'); input().value=''; }
      return;
    }
  });
  // Ctrl+` toggles the terminal from anywhere in the app
  addEventListener('keydown',(e)=>{
    if(e.ctrlKey && e.key==='`'){ e.preventDefault(); toggle(); }
  });
}

function banner(){
  if(bannerShown) return;
  bannerShown=true;
  line('antror cli v1.0 — a product by ANTROR', 'cmd');
  line('type help for commands · any free text goes straight to the AI', 'dim');
  line('');
}
function toggle(){
  open=!open;
  $id('termPanel').hidden=!open;
  $id('btnTerm').classList.toggle('accent',open);
  if(open){ banner(); refreshPrompt(); setTimeout(()=>input().focus(),30); }
}
function refreshPrompt(){ $id('termPrompt').innerHTML='<b>'+esc('antror ~ '+state.project.name+' $')+'</b>'; }
setInterval(()=>{ if(open) refreshPrompt(); }, 1200);

/* boot after app.js init */
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bindTerm);
else bindTerm();

window.TermCLI={ toggle, isOpen:()=>open, exec };
window.__gitRepo=()=>gitRepo(false);
window.__gitPush=(args,raw)=>gitPush(args,raw);
})();

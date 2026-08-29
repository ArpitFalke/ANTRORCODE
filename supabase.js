/* ════════════════════════════════════════════════════════════════
   ANTROR Code — Supabase connector (auth + cloud projects)
   Requires the Supabase JS SDK (UMD) loaded before this script.
   Config is stored locally: vf.v1.supabase = {url, anon}
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.VF = (function () {
  const CFG_KEY = 'vf.v1.supabase';
  let _client = undefined; // undefined=not built, null=unavailable

  const PROJECTS_SQL = `-- Run once in Supabase → SQL Editor:
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table public.projects enable row level security;
create policy "own rows" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;

  function cfg() {
    try {
      const saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (saved && saved.url && saved.anon) return saved;
      return window.__VF_SB_DEFAULT || null;   // pre-wired install default
    } catch (e) { return window.__VF_SB_DEFAULT || null; }
  }
  function configured() {
    const c = cfg();
    return !!(c && c.url && c.anon && /^https?:\/\//.test(c.url));
  }
  function saveCfg(c) {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
    _client = undefined; // rebuild next time
  }
  function clearCfg() { localStorage.removeItem(CFG_KEY); _client = undefined; }

  function client() {
    if (_client !== undefined) return _client;
    const c = cfg();
    if (!c || !window.supabase || !c.url || !c.anon) { _client = null; return null; }
    try { _client = window.supabase.createClient(c.url, c.anon, { auth: { persistSession: true } }); }
    catch (e) { _client = null; }
    return _client;
  }

  /* Where auth flows send the user back to. Live hosts (Vercel cleanUrls)
     get the bare path — no "index.html" in the address bar; plain local
     servers keep the filename. */
  function redirectTarget() {
    const dir = location.pathname.replace(/[^/]*$/, '');
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
    return location.origin + dir + (local ? 'index.html' : '');
  }

  /* ── auth ── */
  async function getSession() {
    const cl = client(); if (!cl) return null;
    try { const { data } = await cl.auth.getSession(); return data.session; } catch (e) { return null; }
  }
  async function getUser() {
    const s = await getSession();
    return s ? s.user : null;
  }
  async function signUp(email, password) {
    const cl = client(); if (!cl) throw new Error('Supabase not configured');
    const { data, error } = await cl.auth.signUp({ email, password }, { emailRedirectTo: redirectTarget() });
    if (error) throw error;
    return data; // data.session may be null if email confirmation is on
  }
  async function resend(email) {
    const cl = client(); if (!cl) throw new Error('Supabase not configured');
    const { error } = await cl.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTarget() } });
    if (error) throw error;
    return true;
  }
  async function signIn(email, password) {
    const cl = client(); if (!cl) throw new Error('Supabase not configured');
    const { data, error } = await cl.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }
  async function oauth(provider) {
    const cl = client(); if (!cl) throw new Error('Supabase not configured');
    const { error } = await cl.auth.signInWithOAuth({
      provider, options: { redirectTo: redirectTarget() },
    });
    if (error) throw error;
  }
  async function signOut() {
    const cl = client(); if (!cl) return;
    try { await cl.auth.signOut(); } catch (e) { /* ignore */ }
  }
  async function updateName(name) {
    const cl = client(); if (!cl) throw new Error('Supabase not configured');
    const { data, error } = await cl.auth.updateUser({ data: { display_name: String(name || '').trim().slice(0, 40) } });
    if (error) throw error;
    return data;
  }
  function onAuthChange(fn) {
    const cl = client(); if (!cl) return () => {};
    const { data } = cl.auth.onAuthStateChange((_e, sess) => { try { fn(sess); } catch (err) {} });
    return () => { try { data.subscription.unsubscribe(); } catch (e) {} };
  }

  /* ── cloud projects (table: public.projects) ── */
  async function pushProject(proj) {
    const cl = client(); if (!cl) throw new Error('Supabase not configured');
    const user = await getUser(); if (!user) throw new Error('Sign in first');
    const row = {
      user_id: user.id,
      name: proj.name,
      data: { files: proj.files, chat: (proj.chat || []).slice(-30) },
      updated_at: new Date().toISOString(),
    };
    let resp, err;
    if (proj.cloudId) {
      ({ error: err } = await cl.from('projects').update(row).eq('id', proj.cloudId));
      if (!err) return proj.cloudId;
    }
    ({ data: resp, error: err } = await cl.from('projects').insert(row).select('id').single());
    if (err) throw new Error(err.message || String(err));
    return resp.id;
  }
  async function listCloud() {
    const cl = client(); if (!cl) throw new Error('Supabase not configured');
    const user = await getUser(); if (!user) return [];
    const { data, error } = await cl.from('projects')
      .select('id,name,updated_at,data').order('updated_at', { ascending: false }).limit(50);
    if (error) throw new Error(error.message || String(error));
    return (data || []).map(r => ({
      cloudId: r.id, name: r.name, updatedAt: r.updated_at,
      files: r.data?.files || {}, chat: r.data?.chat || [],
    }));
  }
  async function deleteCloud(cloudId) {
    const cl = client(); if (!cl) throw new Error('Supabase not configured');
    const { error } = await cl.from('projects').delete().eq('id', cloudId);
    if (error) throw new Error(error.message || String(error));
  }

  return {
    PROJECTS_SQL, cfg, configured, saveCfg, clearCfg, client,
    getSession, getUser, signUp, resend, signIn, oauth, signOut, onAuthChange, updateName,
    pushProject, listCloud, deleteCloud,
  };
})();

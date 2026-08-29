/* ════════════════════════════════════════════════════════════════
   ANTROR Code — Supabase connection for THIS browser install.
   The anon (public) key is safe to ship in browser code; it only
   grants access to rows the signed-in user owns (RLS enforced).
   Saved values in localStorage (vf.v1.supabase) always win.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.__VF_WEB_ORIGIN = 'https://antrorcode.vercel.app';   // OAuth popup landing (tokens captured, never shown)
window.__VF_SB_DEFAULT = {
  url:  'https://fsjzlfnrasisxmcxrxaa.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzanpsZm5yYXNpc3htY3hyeGFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MzY2NzgsImV4cCI6MjEwMzUxMjY3OH0.8djqOKsK2R68bXWaEG78MU2A4AUIJ-H0MkFFTUdzg6Q',
};

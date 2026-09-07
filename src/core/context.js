/* ════════════════════════════════════════════════════════════════
   ANTRORCODE Agent Core — context.js
   Phase 1 context builder (intentionally simple): project structure,
   manifest, ANTROR.md memory, goal-relevant files, entry points.
   A future repository-intelligence index can replace this module.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.AC = window.AC || {};

window.AC.ContextBuilder = function () {};

/* System-prompt composition: base rules + plugins + skills + MCP + project memory.
   Lives here so the agent loop stays provider- and feature-agnostic. */
window.AC.buildSystem = function (mode) {
  const S = (window.state && state.settings) || {};
  let sys = window.AC.AgentSystem ? window.AC.AgentSystem(mode) : '';
  const P = S.plugins || {};
  if (P.tailwind) sys += '\n\nPLUGIN — TAILWIND: Style everything with Tailwind CSS via <script src="https://cdn.tailwindcss.com"></script> and utility classes; keep a <style> block only for custom keyframes.';
  if (P.motion) sys += '\n\nPLUGIN — MOTION: Add tasteful life to the UI — transitions on every interactive element, keyframe entrances, scroll reveals, micro-interactions. Smooth, never gimmicky.';
  if (P.seo) sys += '\n\nPLUGIN — SEO: Include complete meta tags (description, Open Graph, Twitter card), semantic HTML5 landmarks and descriptive page titles.';
  if (P.strictjs) sys += '\n\nPLUGIN — STRICT JS: Write modern strict-mode JavaScript — no globals, small pure functions, defensive error handling, meaningful names.';
  (S.skills || []).filter(s => s.on).forEach(sk => { sys += '\n\nSKILL — ' + sk.name + ':\n' + sk.text; });
  const T = S.mcpTools || {};
  Object.keys(T).forEach(server => {
    sys += '\n\nMCP SERVER CONNECTED — "' + server + '". Available tools:';
    (T[server].tools || []).forEach(t => {
      sys += '\n   • ' + server + '.' + t.name + ' — ' + (t.description || '') + ' | call: <mcp server="' + server + '" tool="' + t.name + '" args=\'{"param":"value"}\'/>';
    });
  });
  const mem = (window.state && state.project.files && state.project.files['ANTROR.md']);
  if (mem) sys += '\n\nPROJECT MEMORY — ANTROR.md (durable facts; keep updated):\n' + mem;
  return sys;
};

window.AC.ContextBuilder.prototype = {
  build(goal, opts) {
    opts = opts || {};
    const files = (window.state && state.project.files) || {};
    const structure = this.structure(files);
    const memory = files['ANTROR.md'] || '';
    const relevant = this.relevantFiles(files, goal, opts.openFile);
    return {
      goal,
      structure,
      memory,
      relevant,
      systemExtra: this.systemExtra(structure, relevant, memory),
      manifestText: this.manifest(files),
    };
  },

  structure(files) {
    return Object.keys(files).map((p) => p + ' (' + files[p].length + 'B)');
  },

  /* relevance: entry point, goal-mentioned files, ANTROR.md, open file */
  relevantFiles(files, goal, openFile) {
    const g = String(goal || '').toLowerCase();
    const scored = Object.keys(files).map((p) => {
      let score = 0;
      if (p === 'index.html') score += 3;
      if (p === 'ANTROR.md') score += 2;
      if (openFile && p === openFile) score += 3;
      if (g.includes(p.toLowerCase())) score += 5;
      const base = p.split('/').pop().toLowerCase().replace(/\.\w+$/, '');
      if (base && g.includes(base)) score += 3;
      return { p, score, size: files[p].length };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.size - b.size);
    const out = []; let total = 0;
    for (const x of scored) {
      if (total + x.size > 24000) break;
      out.push(x.p); total += x.size;
    }
    return out;
  },

  manifest(files) {
    const paths = Object.keys(files);
    if (!paths.length) return 'CURRENT PROJECT: completely empty.';
    return paths.map((p) => '- ' + p + ' (' + files[p].length + ' bytes)').join('\n');
  },

  systemExtra(structure, relevant, memory) {
    let s = 'PROJECT FILES:\n' + (structure.length ? structure.map((x) => '  ' + x).join('\n') : '  (empty project)');
    if (memory) s += '\n\nPROJECT MEMORY — ANTROR.md:\n' + memory;
    if (relevant.length) s += '\n\nKEY FILES (contents available via read_file): ' + relevant.join(', ');
    return s;
  },
};

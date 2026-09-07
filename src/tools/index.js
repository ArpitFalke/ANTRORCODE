/* ════════════════════════════════════════════════════════════════
   ANTRORCODE Agent Core — tools
   Unified tool contract. Every tool:
     { name, description, permissionClass, inputSchema, execute(args,ctx) }
   execute returns the unified result:
     { success:true,  tool, result,   metadata }
     { success:false, tool, error:{code,message}, metadata }
   Implemented over the EXISTING systems (state.project.files,
   antrorAPI / bridge, MCP client) — nothing is duplicated.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.AC = window.AC || {};
window.AC.tools = window.AC.tools || {};
window.AC.ok = (tool, result, metadata) => ({ success: true, tool, result, metadata: metadata || {} });
window.AC.fail = (tool, code, message, metadata) => ({ success: false, tool, error: { code, message: message || code }, metadata: metadata || {} });

const T = window.AC.tools;
const S = (str) => ({ type: 'string', description: str });
function def(name, description, permissionClass, inputSchema, execute) {
  T[name] = { name, description, permissionClass, inputSchema, execute };
}

/* ── filesystem (in-memory project FS + desktop disk sync via app hooks) ── */
def('read_file', 'Read the full contents of a project file', 'READ',
  { type: 'object', properties: { path: S('project-relative file path') }, required: ['path'] },
  async (args) => {
    const p = String(args.path || '');
    const files = state.project.files;
    if (!(p in files)) return AC.fail('read_file', 'FILE_NOT_FOUND', 'File not found: ' + p);
    const content = files[p];
    return AC.ok('read_file', content.length > 24000 ? content.slice(0, 24000) + '\n…[truncated]' : content,
      { path: p, lines: content.split('\n').length, bytes: content.length });
  });

def('write_file', 'Create or completely replace a project file', 'WRITE',
  { type: 'object', properties: { path: S('project-relative path'), content: S('full file content') }, required: ['path', 'content'] },
  async (args) => {
    const p = String(args.path || '');
    if (!p || p.includes('..') || p.startsWith('/')) return AC.fail('write_file', 'BAD_ARGUMENTS', 'Invalid path: ' + p);
    const prev = state.project.files[p];
    state.project.files[p] = String(args.content ?? '').replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '\n');
    let added = 0, removed = 0;
    if (typeof lineDiff === 'function') {
      const d = lineDiff(prev, state.project.files[p]);
      if (d) d.forEach((x) => { if (x.t === '+') added++; else if (x.t === '-') removed++; });
    }
    if (typeof saveProject === 'function') saveProject();
    if (typeof renderTreeSoon === 'function') renderTreeSoon();
    if (typeof refreshSoon === 'function') refreshSoon();
    if (typeof persistCurrentProject === 'function') persistCurrentProject();
    return AC.ok('write_file', 'written', { path: p, created: prev == null, added, removed, lines: state.project.files[p].split('\n').length });
  });

def('apply_patch', 'Apply a unified diff to an existing project file (reviewable, reversible)', 'WRITE',
  { type: 'object', properties: { path: S('project-relative path'), patch: S('unified diff (--- a/file +++ b/file @@ hunks)') }, required: ['path', 'patch'] },
  async (args) => {
    const p = String(args.path || '');
    const patch = String(args.patch || '');
    const files = state.project.files;
    if (!(p in files)) return AC.fail('apply_patch', 'FILE_NOT_FOUND', 'File not found: ' + p);
    try {
      const before = files[p];
      const after = AC.applyUnifiedDiff(before, patch);
      if (after === null) return AC.fail('apply_patch', 'PATCH_FAILED', 'Patch context did not match the file — read the file and regenerate the patch');
      let added = 0, removed = 0;
      if (typeof lineDiff === 'function') {
        const d = lineDiff(before, after);
        if (d) d.forEach((x) => { if (x.t === '+') added++; else if (x.t === '-') removed++; });
      }
      files[p] = after;
      if (typeof saveProject === 'function') saveProject();
      if (typeof renderTreeSoon === 'function') renderTreeSoon();
      if (typeof refreshSoon === 'function') refreshPreview();
      if (typeof persistCurrentProject === 'function') persistCurrentProject();
      return AC.ok('apply_patch', 'patched', { path: p, added, removed, bytesBefore: before.length, bytesAfter: after.length });
    } catch (e) {
      return AC.fail('apply_patch', 'PATCH_FAILED', e.message || String(e));
    }
  });

def('search_files', 'Search all project files for text (case-insensitive)', 'READ',
  { type: 'object', properties: { query: S('text to find') }, required: ['query'] },
  async (args) => {
    const q = String(args.query || '').toLowerCase();
    if (!q) return AC.fail('search_files', 'BAD_ARGUMENTS', 'Empty query');
    const hits = [];
    Object.keys(state.project.files).forEach((p) => {
      state.project.files[p].split('\n').forEach((l, i) => {
        if (l.toLowerCase().includes(q) && hits.length < 40) hits.push({ path: p, line: i + 1, text: l.trim().slice(0, 160) });
      });
    });
    return AC.ok('search_files', hits, { query: q, matches: hits.length });
  });

def('list_directory', 'List all project files with sizes', 'READ',
  { type: 'object', properties: {} },
  async () => AC.ok('list_directory', Object.keys(state.project.files).map((p) => p + ' (' + state.project.files[p].length + 'B)'), { count: Object.keys(state.project.files).length }));

/* ── terminal (existing permission behavior preserved) ── */
def('run_command', 'Run a command on the user device (permission required)', 'EXECUTE',
  { type: 'object', properties: { command: S('shell command') }, required: ['command'] },
  async (args) => {
    const cmd = String(args.command || '').trim();
    if (!cmd) return AC.fail('run_command', 'BAD_ARGUMENTS', 'Empty command');
    AC.events.permRequested({ tool: 'run_command', command: cmd.slice(0, 120) });
    try {
      if (window.antrorAPI) {
        const r = await window.antrorAPI.runCommand(cmd);
        if (r.denied) return AC.fail('run_command', 'PERMISSION_DENIED', 'User denied the command');
        return AC.ok('run_command', (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : ''), { exitCode: r.code, command: cmd });
      }
      if (window.__vfBridgeRun) {
        const out = await window.__vfBridgeRun(cmd);
        return AC.ok('run_command', out, { command: cmd });
      }
      return AC.fail('run_command', 'DESKTOP_REQUIRED', 'Device commands need the desktop app (or the bridge)');
    } catch (e) {
      return AC.fail('run_command', 'COMMAND_FAILED', e.message || String(e));
    }
  });

/* ── git (read-only tools; mutations via run_command in the desktop app) ── */
def('git_status', 'Show the working tree status (desktop: real git)', 'GIT',
  { type: 'object', properties: {} },
  async () => AC.tools.run_command({ command: 'git status --short --branch' }));
def('git_diff', 'Show the diff of current changes', 'GIT',
  { type: 'object', properties: {} },
  async () => AC.tools.run_command({ command: 'git diff --stat' }));

/* ── browser ── */
def('browser_open', 'Open a URL in the workspace browser', 'BROWSER',
  { type: 'object', properties: { url: S('http(s) URL') }, required: ['url'] },
  async (args) => {
    const url = String(args.url || '');
    if (!/^https?:\/\//i.test(url)) return AC.fail('browser_open', 'BAD_ARGUMENTS', 'http(s) URL required');
    if (typeof navFrame === 'function') { navFrame(url); return AC.ok('browser_open', 'opened in workspace browser', { url }); }
    return AC.fail('browser_open', 'DESKTOP_REQUIRED', 'No browser surface available');
  });
def('browser_console', 'Read captured runtime errors from the preview console', 'READ',
  { type: 'object', properties: {} },
  async () => {
    const errs = (typeof consErrors !== 'undefined') ? consErrors.slice(-20) : [];
    return AC.ok('browser_console', errs, { count: errs.length });
  });

/* ── mcp (existing HTTP client) ── */
def('mcp_call', 'Call a tool on a connected MCP server', 'MCP',
  { type: 'object', properties: { server: S('server name'), tool: S('tool name'), arguments: { type: 'object', description: 'tool arguments object' } }, required: ['server', 'tool'] },
  async (args) => {
    try {
      if (typeof mcpToolCall !== 'function') return AC.fail('mcp_call', 'MCP_ERROR', 'MCP client unavailable');
      const out = await mcpToolCall(args.server, args.tool, args.arguments ? JSON.stringify(args.arguments) : '');
      return AC.ok('mcp_call', out, { server: args.server, tool: args.tool });
    } catch (e) {
      return AC.fail('mcp_call', 'MCP_ERROR', e.message || String(e));
    }
  });

/* ── unified-diff applier (strict context matching, reversible by construction) ── */
window.AC.applyUnifiedDiff = function (before, patch) {
  const lines = before.split('\n');
  const pl = patch.split('\n');
  let idx = 0, applied = 0, out = lines.slice();
  let i = 0;
  while (i < pl.length) {
    const line = pl[i];
    const hunk = line.match(/^@@\s*-\d+(?:,\d+)?\s*\+\d+(?:,\d+)?\s*@@/);
    if (hunk) { i++; continue; }
    if (/^(---|\+\+\+)/.test(line)) { i++; continue; }
    // gather one hunk: context ' ', removed '-', added '+'
    const ctxBefore = [], changes = [], ctxAfter = [];
    let mode = 'before';
    while (i < pl.length && !/^@@/.test(pl[i])) {
      const l = pl[i];
      if (l.startsWith('-')) { changes.push({ t: '-', s: l.slice(1) }); mode = 'in'; }
      else if (l.startsWith('+')) { changes.push({ t: '+', s: l.slice(1) }); mode = 'in'; }
      else { const s = l.startsWith(' ') ? l.slice(1) : l;
        if (mode === 'in') { ctxAfter.push(s); } else { ctxBefore.push(s); }
        changes.push({ t: ' ', s });
      }
      i++;
    }
    // find context position in the current file
    const findFrom = (start) => {
      for (let k = start; k <= out.length - ctxBefore.length; k++) {
        let ok = true;
        for (let j = 0; j < ctxBefore.length; j++) if (out[k + j] !== ctxBefore[j]) { ok = false; break; }
        if (ok) return k;
      }
      return -1;
    };
    let pos = findFrom(idx);
    if (pos < 0) pos = findFrom(0);
    if (pos < 0) return null;   // strict matching failed → PATCH_FAILED upstream
    // splice: remove '-' lines, insert '+' lines at the anchor
    const anchors = changes.filter((x) => x.t !== '+').map((x) => x.s);
    for (let j = 0; j < anchors.length; j++) {
      const at = out.indexOf(anchors[j], pos);
      if (at < 0) return null;
      out.splice(at, 1);
    }
    const plus = changes.filter((x) => x.t === '+').map((x) => x.s);
    const insertAt = out.indexOf(ctxBefore[ctxBefore.length - 1], pos) + 1;
    out.splice(insertAt, 0, ...plus);
    applied++;
    idx = insertAt + plus.length;
    if (applied > 200) break;
  }
  return applied > 0 ? out.join('\n') : null;
};

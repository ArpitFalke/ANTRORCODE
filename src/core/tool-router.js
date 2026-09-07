/* ════════════════════════════════════════════════════════════════
   ANTRORCODE Agent Core — tool-router.js
   Operates ONLY against the unified tool contract:
     schema validation → permission policy → execute → unified result.
   Failures are never hidden from the model.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.AC = window.AC || {};

window.AC.ToolRouter = function (policy) {
  this.policy = policy || new window.AC.PermissionPolicy();
};

window.AC.ToolRouter.prototype = {
  /* lightweight input-schema validation against the tool definition */
  validate(call) {
    const def = window.AC.tools[call.tool];
    if (!def) return AC.E.UNKNOWN_TOOL(call.tool);
    const schema = def.inputSchema || {};
    const props = schema.properties || {};
    const required = schema.required || [];
    for (const req of required) {
      const v = (call.arguments || {})[req];
      if (v === undefined || v === null || v === '') {
        return AC.E.BAD_ARGUMENTS(call.tool + ': missing required argument "' + req + '"', { tool: call.tool, argument: req });
      }
    }
    for (const key of Object.keys(call.arguments || {})) {
      if (props[key] && props[key].type === 'object' && typeof call.arguments[key] !== 'object') {
        return AC.E.BAD_ARGUMENTS(call.tool + ': argument "' + key + '" must be an object', { tool: call.tool, argument: key });
      }
    }
    return null;
  },

  async execute(call) {
    call = { tool: String(call.tool || ''), arguments: (call.arguments && typeof call.arguments === 'object') ? call.arguments : {} };
    const invalid = this.validate(call);
    if (invalid) return AC.fail(call.tool, invalid.code, invalid.message);

    const cls = window.AC.tools[call.tool].permissionClass;
    const verdict = this.policy.check(cls, call);
    if (!verdict.allowed) {
      const err = AC.E.PERMISSION_DENIED(call.tool, verdict.reason);
      return AC.fail(call.tool, err.code, err.message, { permission: cls });
    }
    try {
      return await window.AC.tools[call.tool].execute(call.arguments, {});
    } catch (e) {
      const err = (e && e.agentError) ? e : AC.E.UNKNOWN('TOOL_CRASH', e.message || String(e));
      return AC.fail(call.tool, err.code, err.message);
    }
  },
};

/* Phase 1 policy: simple, but structured as methods so Phase 2 can make
   it risk-based per tool/operation without touching the router. */
window.AC.PermissionPolicy = function () {
  this.approvedCommands = new Set();
  this.planMode = false;   // when true, WRITE/EXECUTE are denied (planning only)
};
window.AC.PermissionPolicy.prototype = {
  check(cls, call) {
    if (this.cancelled) return { allowed: false, reason: 'task cancelled' };
    switch (cls) {
      case 'READ':
      case 'GIT':
      case 'BROWSER':
      case 'MCP':   return { allowed: true };          // user connected/configured these surfaces explicitly
      case 'WRITE':
        if (this.planMode) return { allowed: false, reason: 'PLAN MODE — produce the plan only' };
        return { allowed: true };          // the core loop; diff + undo + verification cover recovery
      case 'EXECUTE': {
        if (this.planMode) return { allowed: false, reason: 'PLAN MODE — produce the plan only' };
        const cmd = call.arguments && call.arguments.command;
        const key = 'EXECUTE:' + cmd;
        if (this.approvedCommands.has(key)) return { allowed: true };
        const ok = typeof window.confirm === 'function'
          ? window.confirm('ANTROR Code wants to run this command:\n\n  ' + cmd + '\n\nAllow?')
          : true;
        AC.events.permRequested({ tool: 'run_command', command: String(cmd).slice(0, 120), allowed: !!ok });
        if (!ok) return { allowed: false, reason: 'user denied' };
        this.approvedCommands.add(key);
        return { allowed: true };
      }
      default: return { allowed: false, reason: 'unknown permission class ' + cls };
    }
  },
};

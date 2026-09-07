/* ════════════════════════════════════════════════════════════════
   ANTRORCODE Agent Core — errors.js
   Structured error codes for tools, gateway and the agent loop.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.AC = window.AC || {};

class AgentError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    this.details = details || {};
    this.agentError = true;
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}
window.AC.AgentError = AgentError;

window.AC.E = {
  UNKNOWN_TOOL:      (t) => new AgentError('UNKNOWN_TOOL', 'Unknown tool: ' + t, { tool: t }),
  BAD_ARGUMENTS:     (m, d) => new AgentError('BAD_ARGUMENTS', m || 'Invalid arguments', d),
  PERMISSION_DENIED: (t, why) => new AgentError('PERMISSION_DENIED', 'Permission denied for ' + t, { tool: t, why: why || '' }),
  COMMAND_FAILED:    (code, msg) => new AgentError('COMMAND_FAILED', msg || 'Command exited ' + code, { exitCode: code }),
  FILE_NOT_FOUND:    (p) => new AgentError('FILE_NOT_FOUND', 'File not found: ' + p, { path: p }),
  PROVIDER_ERROR:    (status, msg) => new AgentError('PROVIDER_ERROR', msg || 'Provider HTTP ' + status, { status }),
  PROVIDER_NETWORK:  (msg) => new AgentError('PROVIDER_NETWORK', msg || 'Could not reach provider'),
  CANCELLED:         () => new AgentError('CANCELLED', 'Task cancelled by user'),
  MAX_ROUNDS:        (n) => new AgentError('MAX_ROUNDS', 'Maximum agent rounds (' + n + ') reached'),
  MCP_ERROR:         (msg) => new AgentError('MCP_ERROR', msg || 'MCP call failed'),
  DESKTOP_REQUIRED:  (what) => new AgentError('DESKTOP_REQUIRED', what + ' requires the ANTROR Code desktop app'),
  BRIDGE_UNAVAILABLE:() => new AgentError('BRIDGE_UNAVAILABLE', 'Device bridge is not connected'),
  PATCH_FAILED:      (why) => new AgentError('PATCH_FAILED', why || 'Patch did not apply', {}),
  UNKNOWN:           (code, msg) => new AgentError(code || 'UNKNOWN', msg || 'Unknown error'),
};

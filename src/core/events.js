/* ════════════════════════════════════════════════════════════════
   ANTRORCODE Agent Core — events.js
   Structured observability bus. No secrets pass through here.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.AC = window.AC || {};

window.AC.events = (function () {
  const log = [];
  const listeners = [];
  function emit(type, data) {
    const ev = { type, data: data || {}, at: Date.now() };
    log.push(ev);
    if (log.length > 500) log.shift();
    listeners.forEach((fn) => { try { fn(ev); } catch (e) { /* listener errors never break the agent */ } });
    return ev;
  }
  return {
    emit,
    on: (fn) => listeners.push(fn),
    log,
    taskCreated:    (d) => emit('task.created', d),
    agentStarted:   (d) => emit('agent.started', d),
    modelRequest:   (d) => emit('model.request', d),
    modelResponse:  (d) => emit('model.response', d),
    toolRequest:    (d) => emit('tool.request', d),
    toolStarted:    (d) => emit('tool.started', d),
    toolCompleted:  (d) => emit('tool.completed', d),
    toolFailed:     (d) => emit('tool.failed', d),
    permRequested:  (d) => emit('permission.requested', d),
    verifyStarted:  (d) => emit('verification.started', d),
    verifyDone:     (d) => emit('verification.completed', d),
    agentDone:      (d) => emit('agent.completed', d),
    agentFailed:    (d) => emit('agent.failed', d),
    agentCancelled: (d) => emit('agent.cancelled', d),
  };
})();

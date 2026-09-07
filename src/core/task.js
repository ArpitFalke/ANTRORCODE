/* ════════════════════════════════════════════════════════════════
   ANTRORCODE Agent Core — task.js
   Explicit, observable agent task state.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.AC = window.AC || {};

window.AC.DEFAULT_MAX_ROUNDS = 10;

window.AC.Task = function (goal, taskId, opts) {
  opts = opts || {};
  this.taskId = taskId || ('task-' + Date.now() + '-' + Math.floor(Math.random() * 999));
  this.goal = String(goal || '');
  this.status = 'IDLE';        // IDLE PLANNING EXECUTING WAITING_FOR_TOOL VERIFYING COMPLETED FAILED CANCELLED
  this.mode = opts.mode || 'AGENT';   // 'AGENT' implemented · 'PLAN'/'GOAL' reserved identifiers
  this.messages = [];
  this.toolCalls = [];
  this.toolResults = [];
  this.currentStep = '';
  this.round = 0;
  this.maxRounds = opts.maxRounds || window.AC.DEFAULT_MAX_ROUNDS;
  this.errors = [];
  this.changedFiles = [];
  this.verification = null;
  this.plan = [];                      // [{label, done}]
  this.metadata = opts.metadata || {};
  this.parentTaskId = opts.parentTaskId || null;
  this.cancellation = { requested: false, reason: null, at: null };
  this.startedAt = Date.now();
  this.updatedAt = Date.now();
};
window.AC.Task.prototype = {
  set(status, step) {
    this.status = status;
    if (step !== undefined) this.currentStep = String(step).slice(0, 120);
    this.updatedAt = Date.now();
    return this;
  },
  requestCancel(reason) {
    /* idempotent: repeated calls never re-run cleanup */
    if (this.cancellation.requested) return false;
    this.cancellation = { requested: true, reason: reason || 'user', at: Date.now() };
    this.set('CANCELLED', this.cancellation.reason);
    return true;
  },
  pushError(err) {
    this.errors.push(err && err.agentError ? err.toJSON() : { code: 'UNKNOWN', message: String(err) });
    this.updatedAt = Date.now();
  },
  snapshot() {
    return {
      taskId: this.taskId, goal: this.goal, status: this.status, mode: this.mode,
      round: this.round, maxRounds: this.maxRounds, currentStep: this.currentStep,
      plan: this.plan.map((p) => ({ label: p.label, done: p.done })),
      toolCalls: this.toolCalls.length, toolResults: this.toolResults.length,
      changedFiles: this.changedFiles.slice(), errors: this.errors.slice(),
      verification: this.verification, parentTaskId: this.parentTaskId,
      cancellation: Object.assign({}, this.cancellation),
      startedAt: this.startedAt, updatedAt: this.updatedAt,
    };
  },
};

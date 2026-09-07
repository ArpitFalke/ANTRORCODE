/* ════════════════════════════════════════════════════════════════
   ANTRORCODE Agent Core — agent.js
   The loop: goal → context → model → normalized tool calls →
   validate → permissions → execute → observe → continue → verify.

   System prompt teaches the portable protocol (works on every
   provider). Native tool-call ingestion can be enabled per adapter
   later without changing this loop.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.AC = window.AC || {};

window.AC.AgentSystem = function (mode) {
  const planAddon = mode === 'PLAN'
    ? 'PLAN MODE: The user wants a PLAN ONLY right now. Produce the <plan> block with detailed todos (affected files, approach, risks, verification steps) plus a short approach summary. Do NOT write, modify or run anything. Do not output code files.'
    : '';
  return [
    'You are ANTROR Code — an autonomous coding agent inside the ANTROR Code studio.',
    'You complete software tasks by using TOOLS, step by step, until the goal is done.',
    '',
    'TOOL PROTOCOL (the only way you act):',
    'When you need to act, reply with ONE tool call in a fenced block and nothing else:',
    '```antror_tool',
    '{"tool":"write_file","arguments":{"path":"index.html","content":"<!doctype html>…"}}',
    '```',
    'Available tools: read_file{path} · write_file{path,content} · apply_patch{path,patch} · search_files{query} ·',
    'list_directory{} · run_command{command} · git_status{} · git_diff{} · browser_open{url} · browser_console{} · mcp_call{server,tool,arguments}.',
    'After each tool call you receive its structured result, then continue with the next call.',
    'When the goal is fully achieved, reply with the final answer as PLAIN TEXT (no tool block):',
    'a short summary of what was done and how to try it, plus a <plan> recap if you announced one.',
    '',
    'RULES:',
    '- Start non-trivial tasks with a short <plan> block (3-8 <todo> items), then execute them one by one.',
    '- New files: prefer write_file with COMPLETE content. Existing files: prefer apply_patch with a unified diff.',
    '- Every web project needs index.html. Vanilla HTML/CSS/JS unless asked otherwise. No binary assets.',
    '- If a tool returns ERROR, read the message and change your approach. Never repeat a failing call unchanged.',
    '- Only software work. Anything else: one line — "I build things — tell me what to make or change."',
    planAddon,
  ].filter(Boolean).join('\n');
};

window.AC.AgentCore = function (opts) {
  opts = opts || {};
  this.gateway = opts.gateway || new window.AC.ModelGateway();
  this.router = opts.router || new window.AC.ToolRouter();
  this.verifier = opts.verifier || new window.AC.Verifier();
  this.context = opts.context || new window.AC.ContextBuilder();
  this.maxRounds = opts.maxRounds || window.AC.DEFAULT_MAX_ROUNDS;
  this.onEvent = opts.onEvent || function () {};
  this.cleanedUp = false;                        // idempotent cancellation guard
};

window.AC.AgentCore.prototype = {
  /* ── cancellation: idempotent ── */
  cancel(reason) {
    if (this.cancelled) return false;            // idempotent: second call is a no-op
    this.cancelled = true;
    if (!this.cleanedUp) {
      this.cleanedUp = true;
      if (this.abortController) { try { this.abortController.abort(); } catch (e) {} }
      if (this.task) { this.task.requestCancel(reason); }
      if (this.onEvent) this.onEvent('agent.cancelled', this.task ? this.task.snapshot() : {});
      AC.events.agentCancelled(this.task ? this.task.snapshot() : {});
    }
    return true;
  },
  abort(reason) { return this.cancel(reason || 'user'); },   // public alias
  _checkCancel() {
    if (this.cancelled || (this.signal && this.signal.aborted)) throw AC.E.CANCELLED();
  },

  /* ── main entry: goal → structured completion result ── */
  async run(goal, ui) {
    ui = ui || {};
    const planMode = this.mode === 'PLAN';
    if (this.router && this.router.policy) this.router.policy.planMode = planMode;
    this.cancelled = false; this.cleanedUp = false;
    this.abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    this.signal = this.abortController ? this.abortController.signal : { aborted: false };
    const self = this;

    const task = this.task = new window.AC.Task(goal, null, { maxRounds: this.maxRounds, mode: this.mode || 'AGENT' });
    const ev = (t, d) => { AC.events.emit(t, d); this.onEvent(t, d); };

    ev('task.created', task.snapshot());
    ev('agent.started', { goal: goal.slice(0, 120) });

    try {
      const ctx = this.context.build(goal, ui);
      task.plan = this.context ? task.plan : [];
      task.messages.push({ role: 'user', text: 'GOAL: ' + goal });

      /* the loop */
      let lastText = '';
      let finishedNaturally = false;
      while (task.round < task.maxRounds) {
        this._checkCancel();
        task.round++;
        task.set('EXECUTING', 'model round ' + task.round);

        ev('model.request', { round: task.round, messages: task.messages.length });
        let resp;
        try {
          resp = await this.gateway.stream({
            messages: task.messages.slice(),
            system: window.AC.AgentSystem(this.mode) + '\n\n' + (ctx.systemExtra || ''),
            signal: this.signal,
            onDelta: (d) => { if (ui.onDelta) { this._checkCancel(); ui.onDelta(d, task); } },
            onThinking: (t) => { if (ui.onThinking) ui.onThinking(t, task); },
          });
        } catch (e) {
          if (e.name === 'AbortError' || e.code === 'CANCELLED') {
            task.set('CANCELLED', 'aborted');
            ev('agent.cancelled', task.snapshot());
            return this.finish(task, lastText, 'CANCELLED');
          }
          const err = (e && e.agentError) ? e : AC.E.PROVIDER_ERROR(0, e.message || String(e));
          task.pushError(err); task.set('FAILED', err.message);
          ev('agent.failed', { error: err.toJSON() });
          return this.finish(task, lastText, 'FAILED', err);
        }
        ev('model.response', { round: task.round, chars: (resp.text || '').length });
        lastText = resp.text;
        task.messages.push({ role: 'assistant', text: resp.rawText || resp.text });

        /* plan todos (live) */
        const plan = this.parsePlan(resp.rawText || resp.text);
        if (plan.length) { task.plan = plan; if (ui.onPlan) ui.onPlan(plan, task); }

        /* no tool calls → final answer */
        if (!resp.toolCalls.length) { finishedNaturally = true; break; }

        /* ── execute tools: validate → permission → run → structured result ── */
        task.set('WAITING_FOR_TOOL', resp.toolCalls.length + ' tool call(s)');
        const results = [];
        for (const call of resp.toolCalls.slice(0, 6)) {
          this._checkCancel();
          task.toolCalls.push(call);
          task.set('WAITING_FOR_TOOL', call.tool);
          ev('tool.request', { tool: call.tool, arguments: call.arguments });
          if (ui.onTool) ui.onTool(call, task);
          const res = await this.router.execute(call);
          task.toolResults.push(res);
          res.success ? AC.events.toolCompleted({ tool: call.tool }) : AC.events.toolFailed({ tool: call.tool, error: res.error });
          if (res.success && call.tool === 'write_file' && !task.changedFiles.includes(res.metadata.path)) task.changedFiles.push(res.metadata.path);
          if (res.success && call.tool === 'apply_patch' && !task.changedFiles.includes(res.metadata.path)) task.changedFiles.push(res.metadata.path);
          if (ui.onToolResult) ui.onToolResult(call, res, task);
          results.push({ call, res });
        }

        /* ── observe: feed structured results back ── */
        const observe = results.map((r) =>
          'TOOL ' + r.call.tool + ' ' + JSON.stringify(r.call.arguments).slice(0, 140) + '\n→ ' +
          (r.res.success
            ? 'OK\n' + String(r.res.result).slice(0, 6000)
            : 'ERROR ' + r.res.error.code + ': ' + r.res.error.message + '\n(Change your approach — do not repeat this call unchanged.)')
        ).join('\n\n');
        task.messages.push({ role: 'user', text: 'TOOL RESULTS:\n\n' + observe +
          '\n\nContinue: the next tool call, or the final plain-text answer if the goal is complete.' +
          '\nIf your plan progressed, RE-EMIT the full <plan> block with <todo done="true"> on every item you finished.' });
      }

      /* ── verification (basic structural) on completed runs ── */
      if (finishedNaturally) {
        this._checkCancel();
        task.set('VERIFYING', 'basic structural verification');
        task.verification = await this.verifier.verify(task.changedFiles);
        AC.events.verifyDone({ passed: task.verification.passed });
        task.set('COMPLETED', 'goal achieved');
        ev('agent.completed', task.snapshot());
        const done = this._result(task, lastText, 'COMPLETED', null, task.verification);
        return done;
      }

      /* rounds exhausted without completion */
      this._checkCancel();
      const err = AC.E.MAX_ROUNDS(task.maxRounds);
      task.pushError(err); task.set('FAILED', err.message);
      ev('agent.failed', { error: err.toJSON() });
      return this.finish(task, lastText, 'FAILED', err);

    } catch (e) {
      if (e.code === 'CANCELLED' || e.name === 'AbortError') {
        task.set('CANCELLED', e.message || 'cancelled');
        ev('agent.cancelled', task.snapshot());
        return this.finish(task, '', 'CANCELLED');
      }
      const err = (e && e.agentError) ? e : AC.E.UNKNOWN('AGENT_CRASH', e.message || String(e));
      task.pushError(err); task.set('FAILED', err.message);
      ev('agent.failed', { error: err.toJSON() });
      return this.finish(task, '', 'FAILED', err);
    }
  },

  parsePlan(raw) {
    const out = [];
    const block = String(raw || '').match(/<plan>([\s\S]*?)<\/plan>/);
    if (!block) return out;
    const re = /<todo\s+done="(true|false)"\s*>([\s\S]*?)<\/todo>|<todo\s*>([\s\S]*?)<\/todo>/g;
    let m;
    while ((m = re.exec(block[1])) !== null) {
      const label = (m[2] || m[3] || '').trim().slice(0, 120);
      if (label) out.push({ label, done: m[1] === 'true' });
    }
    return out;
  },

  /* basic structural verification + structured completion */
  finish(task, text, status, err) {
    if (!this.cleanedUp && status !== 'CANCELLED') { /* verification only for finished runs */ }
    let verification = null;
    if (status === 'COMPLETED' && typeof this.verifier.verify === 'function') {
      /* verification is async — the caller (run) awaits it before returning when COMPLETED */
    }
    return this._result(task, text, status, err, verification);
  },
  _result(task, text, status, err, verification) {
    return {
      status,
      text: (typeof window.AC !== 'undefined' && window.AC.stripProtocol) ? window.AC.stripProtocol(text) : text,
      taskId: task.taskId, goal: task.goal, mode: task.mode,
      rounds: task.round, changedFiles: task.changedFiles.slice(),
      toolResults: task.toolResults.map((r) => ({ tool: r.tool, success: r.success, error: r.error || undefined })),
      plan: task.plan.map((p) => ({ label: p.label, done: p.done })),
      errors: task.errors.slice(),
      verification: task.verification,
      durationMs: Date.now() - task.startedAt,
      error: err || null,
    };
  },
};

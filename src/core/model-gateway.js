/* ════════════════════════════════════════════════════════════════
   ANTRORCODE Agent Core — model-gateway.js
   Provider-abstract gateway. The Agent Core depends ONLY on the
   normalized shapes produced here:

     ToolCall  = { tool, arguments }                        (internal)
     Turn      = { text, toolCalls[], usage, model }        (per model round)

   Two ingestion paths behind this one interface:
     NATIVE   — provider adapters that surface structured tool calls
                (adapter provides nativeToolCalls(raw) → ToolCall[])
     PORTABLE — fenced ```antror_tool``` JSON (works on every provider)
   Swapping/adding a path never touches the Agent Core.
   Built over the EXISTING makeAdapter/sseStream — adapters untouched.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.AC = window.AC || {};

window.AC.ModelGateway = function (opts) {
  this.preferNative = !opts || opts.preferNative !== false;
};

window.AC.stripProtocol = function (text) {
  return String(text || '')
    .replace(/```antror_tool[\s\S]*?```/g, '')
    .replace(/^[\s\S]*```antror_tool/, '')
    .trim();
};

window.AC.ModelGateway.prototype = {
  /* one normalized streaming model turn */
  async stream({ messages, system, signal, onDelta, onThinking }) {
    if (typeof makeAdapter !== 'function' || typeof sseStream !== 'function') {
      throw AC.E.PROVIDER_ERROR(0, 'gateway not initialised (makeAdapter missing)');
    }
    const cfg = activeConfig();
    if (!cfg) throw AC.E.PROVIDER_ERROR(0, 'no provider configured');
    if (cfg._ameesDown) throw AC.E.PROVIDER_ERROR(503, 'Amees is being set up — pick your own provider for now');

    const adapter = makeAdapter(cfg, messages, system, {});
    const gw = this;

    const raw = await sseStream(adapter, signal || null,
      (delta) => { if (onDelta) onDelta(delta); },
      (think) => { if (onThinking) onThinking(think); });

    const text = raw || '';
    const toolCalls = gw.extractToolCalls(text, adapter);

    return {
      text: gw.stripProtocol(text),
      rawText: text,
      toolCalls,
      usage: adapter.__usage || null,
      model: cfg.displayModel || cfg.model,
    };
  },

  /* normalized ingestion: NATIVE first, PORTABLE fallback */
  extractToolCalls(raw, adapter) {
    if (this.preferNative && adapter && typeof adapter.nativeToolCalls === 'function') {
      const native = adapter.nativeToolCalls(raw);
      if (Array.isArray(native) && native.length) {
        return native.map((c) => this.normalize(c.tool || c.name, c.arguments || c.input));
      }
      return [];
    }
    return this.parsePortable(raw);
  },

  normalize(tool, args) {
    return { tool: String(tool || ''), arguments: (args && typeof args === 'object') ? args : {} };
  },

  /* PORTABLE path: fenced ```antror_tool {"tool":…,"arguments":…} ``` */
  parsePortable(raw) {
    const calls = [];
    const re = /```antror_tool\s*([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      try {
        const j = JSON.parse(m[1].trim());
        if (j && j.tool) calls.push(this.normalize(j.tool, j.arguments));
      } catch (e) {
        /* malformed JSON: surfaced to the model as a failed call result so it can retry */
      }
    }
    return calls;
  },

  /* protocol blocks never render as chat text */
  stripProtocol(text) {
    return String(text || '')
      .replace(/```antror_tool[\s\S]*?```/g, '')
      .replace(/^\s*```antror_tool[\s\S]*$/g, '')   // unterminated streaming block
      .trim();
  },
};

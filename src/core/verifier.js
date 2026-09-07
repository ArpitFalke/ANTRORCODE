/* ════════════════════════════════════════════════════════════════
   ANTRORCODE Agent Core — verifier.js
   BASIC STRUCTURAL VERIFICATION (Phase 1 — not the final engine):
   HTML closure · script closure · JSON parse · CSS braces ·
   preview runtime errors. Reports actual findings only.
   ════════════════════════════════════════════════════════════════ */
'use strict';
window.AC = window.AC || {};

window.AC.Verifier = function () {};

window.AC.Verifier.prototype = {
  async verify(changedFiles) {
    AC.events.verifyStarted({ files: (changedFiles || []).length });
    const problems = [];
    (changedFiles || []).forEach((p) => {
      const content = (window.state && state.project.files[p]);
      if (content == null) return;
      if (/\.html?$/i.test(p)) {
        if (!/<\/html>/i.test(content)) problems.push({ file: p, issue: 'HTML does not close </html> (may be truncated)' });
        if (/<script/i.test(content) && !/<\/script>/i.test(content)) problems.push({ file: p, issue: 'unclosed <script> tag' });
      }
      if (/\.json$/i.test(p)) {
        try { JSON.parse(content); } catch (e) { problems.push({ file: p, issue: 'invalid JSON: ' + e.message }); }
      }
      if (/\.css$/i.test(p)) {
        const open = (content.match(/\{/g) || []).length;
        const close = (content.match(/\}/g) || []).length;
        if (open !== close) problems.push({ file: p, issue: 'unbalanced braces (' + open + ' open / ' + close + ' close)' });
      }
    });
    const runtimeErrors = (typeof consErrors !== 'undefined') ? consErrors.length : 0;
    if (runtimeErrors > 0) problems.push({ file: '(preview)', issue: runtimeErrors + ' runtime error(s) captured in the preview console' });

    const verification = { passed: problems.length === 0, problems, checkedAt: Date.now(), kind: 'basic-structural' };
    AC.events.verifyDone({ passed: verification.passed, problems: problems.length });
    return verification;
  },
};

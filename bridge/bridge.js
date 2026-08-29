#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   ANTROR Code — device bridge
   Lets the app's terminal run REAL commands on this machine
   (npm, git, python…) — only when the user approves each one.

   Start:   node bridge/bridge.js
   It prints a TOKEN — paste it into ⚙ Settings → Device bridge.
   Binds to 127.0.0.1 only (never exposed to the network).
   ════════════════════════════════════════════════════════════════ */
'use strict';
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');

const PORT = 8765;
const TOKEN = crypto.randomBytes(16).toString('hex');

const line = (s) => console.log(s);
line('┌────────────────────────────────────────────────────────┐');
line('│  ANTROR Code · device bridge — keep this window open   │');
line('│                                                        │');
line('│  Token (paste into ⚙ Settings → Device bridge):        │');
line('│                                                        │');
line('│  ' + TOKEN + '  │');
line('│                                                        │');
line('│  Every command still asks your permission in the app.  │');
line('└────────────────────────────────────────────────────────┘');

const RUNNING = new Set(); // avoid piling up

http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  const send = (code, obj) => {
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors));
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && req.url === '/ping') {
    return send(200, { ok: true, platform: os.platform(), host: os.hostname(), user: os.userInfo().username, node: process.version });
  }
  if (req.method !== 'POST' || req.url !== '/run') return send(404, { error: 'not found' });
  if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'bad token — copy it from the bridge window' });
  if (RUNNING.size >= 3) return send(429, { error: 'too many commands running — try again in a moment' });

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 100000) req.destroy(); });
  req.on('end', () => {
    let j; try { j = JSON.parse(body); } catch (e) { return send(400, { error: 'bad json' }); }
    const cmd = String(j.cmd || '').slice(0, 2000).trim();
    if (!cmd) return send(400, { error: 'no cmd' });

    line('▶ ' + cmd);
    RUNNING.add(cmd);
    const child = exec(cmd, {
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      cwd: typeof j.cwd === 'string' && j.cwd ? j.cwd : process.cwd(),
      env: process.env,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    }, (err, stdout, stderr) => {
      RUNNING.delete(cmd);
      const code = err ? (err.code ?? 1) : 0;
      line('■ exit ' + code);
      send(200, {
        ok: code === 0,
        code,
        stdout: String(stdout || '').slice(0, 200000),
        stderr: String(stderr || '').slice(0, 50000),
      });
    });
    child.on('error', (e) => { RUNNING.delete(cmd); try { send(200, { ok: false, code: 127, stdout: '', stderr: String(e.message) }); } catch (_) {} });
  });
}).listen(PORT, '127.0.0.1', () => line('listening on http://127.0.0.1:' + PORT + ' — waiting for approved commands'));

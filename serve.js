#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   ANTROR Code — dev server with clean URLs.
   /settings serves settings.html, /login → login.html, / → index.html.
   Run:  node serve.js          (port 8899)
   or:   node serve.js 3000
   ════════════════════════════════════════════════════════════════ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.argv[2] || 8899);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  const candidates = [];
  if (p === '/' || p === '') {
    candidates.push('index.html');
  } else {
    candidates.push(p.replace(/^\/+/, ''));                       // exact file (assets, sw.js, .html)
    if (!path.extname(p)) candidates.push(p.replace(/^\/+/, '') + '.html'); // /settings → settings.html
  }
  for (const rel of candidates) {
    const file = path.resolve(root, rel);
    if (!file.startsWith(root)) continue;                          // traversal guard
    try {
      if (fs.statSync(file).isFile()) {
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',   // always revalidate — never serve stale scripts during development
        });
        return fs.createReadStream(file).pipe(res);
      }
    } catch (e) { /* try next candidate */ }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 — ' + p);
}).listen(port, () => console.log('ANTROR Code → http://localhost:' + port));

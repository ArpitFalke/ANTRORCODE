// Minimal OpenAI-compatible SSE mock for end-to-end testing VibeForge's agent loop.
const http = require('http');
const PORT = 8901;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock App</title><link rel="stylesheet" href="style.css"></head>
<body><div class="glow"><h1>🚀 Mock-built app</h1><p>streamed in by the fake model</p><button onclick="hi()">click me</button></div>
<script>function hi(){document.querySelector('p').textContent='it really works ✨'}<\/script>
</body></html>`;
const css = `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#12102a;color:#eef;
font-family:system-ui,sans-serif;text-align:center}
.glow{padding:40px;border-radius:24px;background:rgba(255,255,255,.04);border:1px solid rgba(167,139,250,.35)}
button{margin-top:14px;padding:10px 22px;border:none;border-radius:99px;cursor:pointer;color:#fff;
background:linear-gradient(135deg,#a78bfa,#f472b6);font-weight:800}`;

const full = `Here you go — a tiny glowing app! 🎉\n\n<file path="index.html">\n${html}\n</file>\n\n<file path="style.css">\n${css}\n</file>\n\nClick the button to test it. Ask me for anything else!`;

function chunk(s){
  return 'data: ' + JSON.stringify({ choices: [{ delta: { content: s } }] }) + '\n\n';
}
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST') { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    // stream in small slices to exercise incremental parsing
    const piece = 90; let i = 0;
    const timer = setInterval(() => {
      if (i >= full.length) { res.write('data: [DONE]\n\n'); clearInterval(timer); res.end(); return; }
      res.write(chunk(full.slice(i, i + piece))); i += piece;
    }, 25);
  });
});
server.listen(PORT, () => console.log('mock llm on :' + PORT));

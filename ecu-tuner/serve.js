// Tiny local web server (no install needed): node serve.js  → http://localhost:5555
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, PORT = process.env.PORT || 5555;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.css': 'text/css' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.normalize(path.join(root, p));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(buf); });
}).listen(PORT, '127.0.0.1', () => console.log(`SM Remap: http://localhost:${PORT}  (เปิดด้วย Chrome หรือ Edge)`));

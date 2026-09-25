// local-staging/server.js
// Local test server that serves the real index.html AND proxies to the
// REAL netlify/functions/api.js handler, which talks to Supabase STAGING.
//
// Unlike local-mock/server.js (fake in-memory data), this uses actual
// staging data (245 customers, 506 services, etc.) via the real backend
// code — so it's the closest thing to testing "production" without
// touching Netlify or spending deploy credits.
//
// Usage:  node local-staging/server.js [port]
// Requires: .env with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Then open http://localhost:9999

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || 9999;
const ROOT = path.join(__dirname, '..');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const { handler } = require('../netlify/functions/api.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, decodeURIComponent(urlPath));
  // Basic path traversal guard
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function proxyToFunction(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const queryStringParameters = {};
    url.searchParams.forEach((v, k) => { queryStringParameters[k] = v; });

    const event = {
      httpMethod: req.method,
      body: body || null,
      queryStringParameters,
    };

    try {
      const result = await handler(event);
      res.writeHead(result.statusCode, result.headers || { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/.netlify/functions/api')) {
    proxyToFunction(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log('✅ CCL CRM LOCAL STAGING server running');
  console.log(`   URL: http://localhost:${PORT}`);
  console.log('   Backend: REAL netlify/functions/api.js -> Supabase STAGING');
  console.log('   Data: REAL staging data (245 customers, 506 services, etc.)');
  console.log('   Login: use real Supabase Auth accounts (nic / faii.w)');
});

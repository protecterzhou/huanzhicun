'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Router } = require('./router');
const A = require('./auth');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
// 绑定 0.0.0.0，局域网内其他电脑才能访问；只允许本机时设 HOST=127.0.0.1
const HOST = process.env.HOST || '0.0.0.0';

const router = new Router();
require('./api')(router);
require('./api-admin')(router);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendFileDownload(res, out) {
  const stat = fs.statSync(out.__file);
  const name = out.name || path.basename(out.__file);
  res.writeHead(200, {
    'Content-Type': out.mime || 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(out.__file).pipe(res);
}

function sendCsv(res, csv) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(csv.name)}`,
    'Cache-Control': 'no-store',
  });
  res.end(csv.content);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (ch) => {
      size += ch.length;
      if (size > limit) {
        reject(A.err(413, '文件太大（上限 50MB）'));
        req.destroy();
        return;
      }
      chunks.push(ch);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buf, boundary) {
  const out = { fields: {}, files: [] };
  if (!boundary) return out;
  const sep = Buffer.from('--' + boundary);
  let pos = buf.indexOf(sep);
  while (pos !== -1) {
    let start = pos + sep.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    const next = buf.indexOf(sep, start);
    if (next === -1) break;
    let end = next;
    if (buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2;
    const part = buf.subarray(start, end);
    const hEnd = part.indexOf('\r\n\r\n');
    if (hEnd !== -1) {
      const head = part.subarray(0, hEnd).toString('utf8');
      const data = part.subarray(hEnd + 4);
      const nameM = /name="([^"]*)"/i.exec(head);
      const fileM = /filename="([^"]*)"/i.exec(head);
      const ctM = /Content-Type:\s*([^\r\n]+)/i.exec(head);
      if (nameM) {
        if (fileM && fileM[1]) {
          out.files.push({
            field: nameM[1],
            filename: fileM[1],
            mime: ctM ? ctM[1].trim() : 'application/octet-stream',
            data: Buffer.from(data),
          });
        } else {
          out.fields[nameM[1]] = data.toString('utf8');
        }
      }
    }
    pos = next;
  }
  return out;
}

function getToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  const cookie = req.headers.cookie || '';
  const m = /(?:^|;\s*)hzc_token=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

async function handleApi(req, res, url) {
  const match = router.match(req.method, url.pathname);
  if (!match) return sendJson(res, 404, { error: '接口不存在' });

  const token = getToken(req);
  const user = A.getUserByToken(token);

  let body = null;
  let fields = {};
  let files = [];
  const ct = req.headers['content-type'] || '';

  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    const raw = await readBody(req, 60 * 1024 * 1024);
    if (ct.includes('multipart/form-data')) {
      const b = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
      const parsed = parseMultipart(raw, b ? (b[1] || b[2]).trim() : '');
      fields = parsed.fields;
      files = parsed.files;
    } else if (raw.length) {
      try { body = JSON.parse(raw.toString('utf8')); } catch { body = {}; }
    }
  }

  const c = {
    req, res,
    params: match.params,
    query: Object.fromEntries(url.searchParams.entries()),
    body: body || {},
    fields, files, user, token,
    ip: (req.socket && req.socket.remoteAddress) || '',
  };

  try {
    const out = await match.handler(c);
    if (out && out.__file) return sendFileDownload(res, out);
    if (out && out.__csv) return sendCsv(res, out.__csv);
    if (res.headersSent) return;
    return sendJson(res, 200, out === undefined ? { ok: true } : out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[api]', url.pathname, e);
    if (!res.headersSent) sendJson(res, status, { error: e.message || '服务器内部错误' });
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const idx = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(idx)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return fs.createReadStream(idx).pipe(res);
    }
    res.writeHead(404); return res.end('Not Found');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=60',
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, ts: Date.now() });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
  }
});

function listen(port, attempts = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempts < 10) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1} ...`);
      listen(port + 1, attempts + 1);
    } else {
      console.error(e);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    const lan = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) lan.push(a.address);
      }
    }
    console.log('');
    console.log('  ┌───────────────────────────────────────────┐');
    console.log('  │   环智存 · 环保台账归档与合规管理平台     │');
    console.log('  └───────────────────────────────────────────┘');
    console.log(`   本机访问:   http://127.0.0.1:${port}`);
    if (lan.length) {
      lan.forEach((ip) => console.log(`   局域网访问: http://${ip}:${port}`));
    } else {
      console.log('   局域网访问: 未检测到网卡地址');
    }
    console.log('   ※ 同事打不开时，先确认 Windows 防火墙放行了 TCP ' + port);
    console.log(`   数据目录: ${path.join(__dirname, '..', 'data')}`);
    console.log('   演示账号: admin / admin123    （集团总负责人）');
    console.log('             gx_clerk / 123456   （总部资料员）');
    console.log('             js_clerk / 123456   （建设公司资料员）');
    console.log('');
  });
}

listen(PORT);

#!/usr/bin/env node
/* 零依赖静态服务器：`npm run serve` 后打开 http://localhost:8080
 *
 * 为什么需要它：file:// 下浏览器不允许 fetch/XHR 读 GLB，页面只能退回
 * js/models/*.js 内嵌包（需要先跑 `npm run build:models`）。走 http 时
 * 直接按 URL 加载 models/*.glb，并且带 ?v= 缓存版本号，开发体验更好。
 *
 * 用法: node tools/serve.js [端口]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  let pathname = decodeURIComponent(url.parse(req.url).pathname);
  if (pathname === '/') pathname = '/index.html';

  // 目录穿越防护：解析后必须仍在 ROOT 内
  const target = path.resolve(ROOT, '.' + pathname);
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(target).pipe(res);
  });
}).listen(PORT, () => {
  console.log('澄屿 · 3D 生态水族箱  →  http://localhost:' + PORT + '/');
});

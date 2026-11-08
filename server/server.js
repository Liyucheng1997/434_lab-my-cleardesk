// 自建信令服务器：在有公网 IP 的服务器上运行 `npm run server`（或 `node server/server.js`），
// 然后在客户端“设置 → 网络 → 信令服务器 → 自建服务器”填上地址和端口。
// 环境变量：PORT（默认 9000）、KEY（默认 cleardesk）、SSL_KEY / SSL_CERT（可选，PEM 文件路径，启用 wss）。
const fs = require('fs');
const { PeerServer } = require('peer');

const port = Number(process.env.PORT) || 9000;
const key = process.env.KEY || 'cleardesk';
const ssl = process.env.SSL_KEY && process.env.SSL_CERT ? { key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT) } : undefined;

const server = PeerServer({ port, path: '/', key, ssl, allow_discovery: false, alive_timeout: 60000 }, () => {
  console.log(`晴窗远程信令服务器已启动：${ssl ? 'wss' : 'ws'}://0.0.0.0:${port}/  key=${key}`);
});
server.on('connection', (c) => console.log(new Date().toISOString(), '上线', c.getId()));
server.on('disconnect', (c) => console.log(new Date().toISOString(), '离线', c.getId()));

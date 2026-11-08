// 局域网直连：在本机端口上运行一个 PeerJS 信令服务器，同一局域网的电脑输入本机 IP 即可直连，不经过公网。
const os = require('os');
const http = require('http');

let server = null;
let state = { running: false, port: 0, error: '' };

function start(port) {
  stop();
  return new Promise((resolve) => {
    try {
      const express = require('express');
      const { ExpressPeerServer } = require('peer');
      const app = express();
      const srv = http.createServer(app);
      const peerApp = ExpressPeerServer(srv, { path: '/', key: 'cleardesk', allow_discovery: false, alive_timeout: 30000 });
      peerApp.on('error', () => {}); // ws 层的错误（例如端口占用）已由 http server 的 error 事件处理
      app.use('/', peerApp);
      srv.on('error', (e) => {
        state = { running: false, port, error: e.code === 'EADDRINUSE' ? `端口 ${port} 已被占用` : e.message };
        server = null;
        resolve(state);
      });
      srv.listen(port, '0.0.0.0', () => {
        server = srv;
        state = { running: true, port, error: '' };
        resolve(state);
      });
    } catch (e) {
      state = { running: false, port, error: e.message };
      server = null;
      resolve(state);
    }
  });
}

function stop() {
  try {
    if (server) server.close();
    if (server && server.closeAllConnections) server.closeAllConnections();
  } catch {}
  server = null;
  state = { running: false, port: 0, error: '' };
}

function addresses() {
  const list = [];
  for (const [name, items] of Object.entries(os.networkInterfaces())) {
    for (const it of items || []) {
      if (it.family === 'IPv4' && !it.internal && !/^169\.254\./.test(it.address)) list.push({ name, address: it.address });
    }
  }
  // 虚拟网卡（VMware、Hyper-V、WSL 等）排后面
  const virtual = (n) => /vmware|virtual|vethernet|wsl|hyper-v|vbox|docker|loopback|tailscale|zerotier/i.test(n);
  list.sort((a, b) => virtual(a.name) - virtual(b.name));
  return list;
}

module.exports = { start, stop, status: () => ({ ...state, addresses: addresses() }) };

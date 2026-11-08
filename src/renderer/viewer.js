// 控制端：连接对方识别码，显示远程画面，把本地鼠标键盘事件发给对方。
import { $, $$, h, esc, ICONS, PREFIX, LAN_HOST_ID, QUALITY, formatBytes, toast, modal, popupMenu, initTheme } from './common.js';

const api = window.api;
const video = $('#video');
const stage = $('#stage');

let init = null;
let peer = null;
let conn = null; // 控制通道
let fileConn = null; // 文件通道
let call = null;
let state = 'idle'; // connecting | waiting | connected | closed
let hostInfo = null; // auth 返回的信息
let displays = [];
let currentDisplay = '';
let quality = 'balanced';
let viewOnly = false;
let clipSync = true;
let fitMode = 'fit';
let timeout = null;
let statsTimer = null;
let clipTimer = null;
let lastClip = '';
let lastRtt = 0;
let resized = false;

for (const el of $$('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon];

function overlay(kind, title, msg = '', actions = []) {
  const ov = $('#overlay');
  if (!kind) {
    ov.hidden = true;
    return;
  }
  ov.hidden = false;
  $('#ovSpin').style.display = kind === 'busy' ? '' : 'none';
  const card = $('.ov-card', ov);
  card.querySelector('.ov-icon')?.remove();
  if (kind === 'error') card.prepend(h('<div class="ov-icon">!</div>'));
  $('#ovTitle').textContent = title;
  $('#ovMsg').textContent = msg;
  const box = $('#ovActions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = h(`<button class="btn ${a.primary ? 'btn-primary' : ''}">${esc(a.label)}</button>`);
    b.onclick = a.run;
    box.appendChild(b);
  }
}

function setStatus(cls, name) {
  $('#stDot').className = 'dot ' + cls;
  if (name != null) $('#hostName').textContent = name;
}

// —— 建立连接 ——
async function start() {
  cleanup();
  state = 'connecting';
  resized = false;
  setStatus('busy', `正在连接 ${init.title}`);
  document.title = `正在连接 ${init.title} - 晴窗远程`;
  overlay('busy', '正在连接…', init.mode === 'lan' ? `局域网直连 ${init.target}` : `识别码 ${init.title}`);
  $('#tools').hidden = true;

  let server, iceServers, targetId;
  if (init.mode === 'lan') {
    const [ip, port] = init.target.split(':');
    server = { host: ip, port: parseInt(port, 10) || init.server.lanPort || 21118, path: '/', secure: false, key: 'cleardesk' };
    iceServers = [];
    targetId = LAN_HOST_ID;
  } else {
    server = init.server.cloud;
    iceServers = init.server.iceServers;
    targetId = PREFIX + init.target;
  }
  const myId = PREFIX + 'c-' + init.deviceId + '-' + Math.random().toString(36).slice(2, 8);
  const p = new Peer(myId, { ...server, config: { iceServers }, debug: 0, pingInterval: 5000 });
  peer = p;
  timeout = setTimeout(() => {
    if (p === peer && (state === 'connecting' || state === 'auth')) fail('连接超时', init.mode === 'lan' ? '请确认对方 IP 正确、对方开启了局域网直连，且防火墙允许晴窗远程。' : '对方可能不在线，或网络较差。请稍后重试。');
  }, 25000);

  p.on('open', () => {
    if (p !== peer) return;
    conn = p.connect(targetId, { reliable: true, serialization: 'binary', metadata: { kind: 'control' } });
    bindControl(conn);
  });
  p.on('call', (c) => {
    if (p !== peer) return;
    call = c;
    c.answer();
    c.on('stream', (stream) => {
      if (c !== call) return;
      video.srcObject = stream;
      video.play().catch(() => {});
    });
    c.on('close', () => c === call && state === 'connected' && lost('画面已中断'));
    const pc = c.peerConnection;
    if (pc)
      pc.addEventListener('connectionstatechange', () => {
        if (c !== call) return;
        if (pc.connectionState === 'failed') lost('网络连接失败', '双方网络无法直连，且中继服务器不可用。可以在设置里配置 TURN 服务器后重试。');
        if (pc.connectionState === 'disconnected') setStatus('warn');
        if (pc.connectionState === 'connected' && state === 'connected') setStatus('ok');
      });
  });
  p.on('error', (err) => {
    if (p !== peer) return;
    if (err.type === 'peer-unavailable') return fail('对方不在线', init.mode === 'lan' ? '对方没有运行晴窗远程，或没有开启局域网直连。' : '识别码不正确，或对方电脑没有运行晴窗远程。');
    if (state === 'connected') return; // 已经点对点连上了，信令服务器断开不影响
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) return fail('无法连接服务器', init.mode === 'lan' ? `无法连接 ${server.host}:${server.port}，请检查 IP 和防火墙。` : '请检查网络，或在设置里更换信令服务器。');
    if (err.type === 'unavailable-id') return start();
    fail('连接失败', err.message || String(err.type));
  });
}

function bindControl(c) {
  c.on('open', () => {
    if (c !== conn) return;
    state = 'auth';
    c.send({ t: 'hello', password: init.password, name: init.deviceName, from: init.deviceId, quality });
  });
  c.on('data', (msg) => onMessage(msg));
  c.on('close', () => {
    if (c !== conn) return;
    if (state === 'connected') lost('连接已断开', '对方已断开，或网络中断。');
    else if (state !== 'closed') fail('连接已关闭', '对方关闭了连接。');
  });
  c.on('error', () => {});
}

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'waiting':
      // 对方有 30 秒决定是否接受，连接超时要相应延长
      clearTimeout(timeout);
      timeout = setTimeout(() => state === 'auth' && fail('对方没有回应', '对方没有在 30 秒内接受连接请求。'), 40000);
      overlay('busy', '等待对方确认…', '对方需要在电脑上点击“接受”。');
      break;
    case 'auth':
      if (!msg.ok) return fail('无法连接', msg.reason || '验证失败');
      onAuthed(msg);
      break;
    case 'display':
      displays = msg.displays || displays;
      currentDisplay = msg.current;
      resized = false;
      updateToolbar();
      break;
    case 'pong':
      lastRtt = Math.round(performance.now() - msg.ts);
      break;
    case 'clip':
      if (clipSync && typeof msg.text === 'string') {
        lastClip = msg.text;
        api.clipboard.write(msg.text);
      }
      break;
    case 'bye':
      state = 'closed';
      lost('连接已断开', msg.reason || '对方断开了连接。');
      break;
  }
}

function onAuthed(msg) {
  clearTimeout(timeout);
  state = 'connected';
  hostInfo = msg;
  displays = msg.displays || [];
  currentDisplay = msg.current;
  setStatus('ok', msg.hostName);
  document.title = `${msg.hostName} - 晴窗远程`;
  api.viewer.title(document.title);
  overlay('busy', '已连接，正在接收画面…');
  $('#tools').hidden = false;
  api.recent.add({ mode: init.mode, target: init.target, name: msg.hostName, password: init.password, remember: init.remember });
  send({ t: 'clipsync', on: clipSync });
  if (quality !== 'balanced') send({ t: 'quality', q: quality });
  updateToolbar();
  startStats();
  startClip();
  stage.focus();
}

function fail(title, msg) {
  if (state === 'closed' && title !== '连接已断开') return;
  state = 'closed';
  cleanup();
  setStatus('err');
  $('#tools').hidden = true;
  overlay('error', title, msg, [
    { label: '关闭', run: () => api.viewer.close() },
    { label: '重试', primary: true, run: start },
  ]);
}

function lost(title, msg = '') {
  state = 'closed';
  cleanup();
  setStatus('err');
  $('#tools').hidden = true;
  overlay('error', title, msg, [
    { label: '关闭窗口', run: () => api.viewer.close() },
    { label: '重新连接', primary: true, run: start },
  ]);
}

function cleanup() {
  clearTimeout(timeout);
  clearInterval(statsTimer);
  clearInterval(clipTimer);
  statsTimer = clipTimer = null;
  pressed.clear();
  const p = peer;
  peer = conn = call = fileConn = null;
  if (p) setTimeout(() => p.destroy(), 100);
  video.srcObject = null;
  for (const f of queue.splice(0)) f.fail('连接已断开');
}

function send(msg) {
  if (state !== 'connected' || !conn || !conn.open) return false;
  try {
    conn.send(msg);
    return true;
  } catch {
    return false;
  }
}

// —— 工具栏 ——
function updateToolbar() {
  const i = displays.findIndex((d) => d.id === currentDisplay);
  $('#tDisplay').hidden = displays.length < 2;
  $('#tDisplayLabel').textContent = i >= 0 ? `显示器 ${i + 1}` : '显示器';
  $('#tQualityLabel').textContent = QUALITY[quality].label;
  $('#tClip').classList.toggle('on', clipSync);
  $('#tView').classList.toggle('on', viewOnly);
  $('#tView').querySelector('.tool-label').textContent = viewOnly ? '仅观看' : '控制';
  $('#tFit').title = fitMode === 'fit' ? '当前：适应窗口（点击切换为原始大小）' : '当前：原始大小（点击切换为适应窗口）';
  $('#tFit').classList.toggle('on', fitMode === 'original');
  stage.classList.toggle('original', fitMode === 'original');
  stage.classList.toggle('viewonly', viewOnly);
}

$('#tDisplay').onclick = (e) =>
  popupMenu(
    e.currentTarget,
    displays.map((d, i) => ({ label: `显示器 ${i + 1}${d.primary ? '（主屏）' : ''}`, hint: `${d.width}×${d.height}`, value: d.id, checked: d.id === currentDisplay })),
    (id) => {
      if (id === currentDisplay) return;
      send({ t: 'display', id });
      currentDisplay = id;
      resized = false;
      updateToolbar();
    },
  );

$('#tQuality').onclick = (e) =>
  popupMenu(
    e.currentTarget,
    Object.entries(QUALITY).map(([k, v]) => ({ label: v.label, hint: k === 'smooth' ? '省流量' : k === 'hd' ? '60 帧' : '', value: k, checked: k === quality })),
    (q) => {
      quality = q;
      send({ t: 'quality', q });
      updateToolbar();
    },
  );

const COMBOS = {
  taskmgr: ['ControlLeft', 'ShiftLeft', 'Escape'],
  win: ['MetaLeft'],
  desktop: ['MetaLeft', 'KeyD'],
  explorer: ['MetaLeft', 'KeyE'],
  run: ['MetaLeft', 'KeyR'],
  alttab: ['AltLeft', 'Tab'],
  altf4: ['AltLeft', 'F4'],
  screenshot: ['MetaLeft', 'ShiftLeft', 'KeyS'],
};
$('#tKeys').onclick = (e) =>
  popupMenu(
    e.currentTarget,
    [
      { label: '任务管理器', hint: 'Ctrl+Shift+Esc', value: 'taskmgr' },
      { label: '开始菜单', hint: 'Win', value: 'win' },
      { label: '显示桌面', hint: 'Win+D', value: 'desktop' },
      { label: '文件资源管理器', hint: 'Win+E', value: 'explorer' },
      { label: '运行', hint: 'Win+R', value: 'run' },
      { label: '切换窗口', hint: 'Alt+Tab', value: 'alttab' },
      { label: '关闭当前窗口', hint: 'Alt+F4', value: 'altf4' },
      { label: '截图', hint: 'Win+Shift+S', value: 'screenshot' },
      { sep: true },
      { label: '输入文字…', value: 'text' },
      { label: '锁定对方电脑', value: 'lock' },
    ],
    async (v) => {
      if (v === 'lock') return send({ t: 'lock' });
      if (v === 'text') return typeText();
      send({ t: 'combo', keys: COMBOS[v] });
      stage.focus();
    },
  );

async function typeText() {
  const body = h('<div><textarea class="input text-area" placeholder="输入的文字会直接打到对方当前光标处，支持中文"></textarea></div>');
  const ok = await modal({ title: '输入文字', body, width: 440, buttons: [{ label: '取消', value: false }, { label: '发送', value: true, primary: true }], onMount: () => $('textarea', body).focus() });
  const text = $('textarea', body).value;
  if (ok && text) send({ t: 'text', text });
  stage.focus();
}

$('#tClip').onclick = () => {
  clipSync = !clipSync;
  send({ t: 'clipsync', on: clipSync });
  updateToolbar();
  toast(clipSync ? '已开启剪贴板同步' : '已关闭剪贴板同步');
};
$('#tView').onclick = () => {
  viewOnly = !viewOnly;
  if (viewOnly) releaseAll();
  updateToolbar();
  toast(viewOnly ? '仅观看：不会操作对方电脑' : '已恢复控制');
};
$('#tFit').onclick = () => {
  fitMode = fitMode === 'fit' ? 'original' : 'fit';
  updateToolbar();
  sizeVideo();
};
$('#tFull').onclick = () => api.viewer.fullscreen();
$('#tClose').onclick = () => requestClose();
$('#tFile').onclick = () => $('#filePick').click();
$('#filePick').onchange = (e) => {
  for (const f of e.target.files) sendFile(f);
  e.target.value = '';
};

api.viewer.onFullscreen((on) => {
  document.body.classList.toggle('fullscreen', on);
  $('#bar').classList.remove('peek');
});
$('#hot').onmouseenter = () => $('#bar').classList.add('peek');
$('#bar').onmouseleave = () => document.body.classList.contains('fullscreen') && !document.querySelector('.popover') && $('#bar').classList.remove('peek');

async function requestClose() {
  if (state !== 'connected') return api.viewer.close();
  const ok = await modal({ title: '断开连接？', body: `<div class="modal-msg">将断开与 ${esc(hostInfo.hostName)} 的远程连接。</div>`, buttons: [{ label: '取消', value: false }, { label: '断开', value: true, primary: true }] });
  if (!ok) return stage.focus();
  releaseAll();
  send({ t: 'bye' });
  state = 'closed';
  setTimeout(() => {
    cleanup();
    api.viewer.close();
  }, 150);
}
api.viewer.onCloseRequest(requestClose);

// —— 画面尺寸 ——
video.addEventListener('loadedmetadata', onVideoSize);
video.addEventListener('resize', onVideoSize);
function onVideoSize() {
  if (!video.videoWidth) return;
  overlay(null);
  if (!resized) {
    resized = true;
    api.viewer.resize({ width: Math.round(video.videoWidth / devicePixelRatio), height: Math.round(video.videoHeight / devicePixelRatio) });
  }
  sizeVideo();
}
function sizeVideo() {
  if (fitMode === 'original' && video.videoWidth) {
    // 原始大小：一个远程像素对应一个物理像素
    video.style.width = video.videoWidth / devicePixelRatio + 'px';
    video.style.height = video.videoHeight / devicePixelRatio + 'px';
  } else {
    video.style.width = video.style.height = '';
  }
}

// —— 状态统计 ——
function startStats() {
  clearInterval(statsTimer);
  let lastFrames = 0;
  let lastTs = 0;
  statsTimer = setInterval(async () => {
    send({ t: 'ping', ts: performance.now() });
    const pc = call && call.peerConnection;
    if (!pc) return;
    let fps = 0;
    let route = '';
    let kbps = 0;
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          if (lastTs) {
            fps = Math.round(((r.framesDecoded - lastFrames) * 1000) / (r.timestamp - lastTs));
            kbps = Math.round(((r.bytesReceived - (startStats.bytes || 0)) * 8) / (r.timestamp - lastTs));
          }
          lastFrames = r.framesDecoded;
          lastTs = r.timestamp;
          startStats.bytes = r.bytesReceived;
        }
        if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
      });
      if (pair) {
        const local = stats.get(pair.localCandidateId);
        const remote = stats.get(pair.remoteCandidateId);
        route = local && remote && (local.candidateType === 'relay' || remote.candidateType === 'relay') ? '中继' : '直连';
      }
    } catch {}
    const res = video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '';
    const rate = kbps > 1000 ? (kbps / 1000).toFixed(1) + ' Mbps' : kbps + ' kbps';
    $('#stats').textContent = [route, lastRtt ? `${lastRtt} ms` : '', res, fps ? `${fps} fps` : '', kbps ? rate : ''].filter(Boolean).join(' · ');
  }, 1000);
}

// —— 剪贴板：本机复制的文字自动同步到对方 ——
function startClip() {
  clearInterval(clipTimer);
  api.clipboard.read().then((t) => (lastClip = t));
  clipTimer = setInterval(async () => {
    if (!clipSync || !document.hasFocus()) return;
    const t = await api.clipboard.read();
    if (t && t !== lastClip) {
      lastClip = t;
      send({ t: 'clip', text: t });
    }
  }, 800);
}

// —— 鼠标键盘 ——
const pressed = new Set();
let pendingMove = null;

// 把窗口坐标换算成远程画面上的 0..1 坐标（考虑 object-fit: contain 的黑边）
function norm(e) {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(r.width / vw, r.height / vh);
  const w = vw * scale;
  const hgt = vh * scale;
  const x = (e.clientX - r.left - (r.width - w) / 2) / w;
  const y = (e.clientY - r.top - (r.height - hgt) / 2) / hgt;
  return { x, y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

const canControl = () => state === 'connected' && !viewOnly && !document.querySelector('.modal-overlay');

video.addEventListener('mousemove', (e) => {
  if (!canControl()) return;
  const p = norm(e);
  if (!p || !p.inside) return;
  if (!pendingMove) requestAnimationFrame(flushMove);
  pendingMove = p;
});
function flushMove() {
  if (pendingMove) send({ t: 'mm', x: pendingMove.x, y: pendingMove.y });
  pendingMove = null;
}
video.addEventListener('mousedown', (e) => {
  stage.focus();
  if (!canControl()) return;
  const p = norm(e);
  if (!p || !p.inside) return;
  e.preventDefault();
  pendingMove = null;
  send({ t: 'md', b: e.button, x: p.x, y: p.y });
});
window.addEventListener('mouseup', (e) => {
  if (!canControl()) return;
  const p = norm(e);
  send({ t: 'mu', b: e.button, x: p && p.inside ? p.x : undefined, y: p && p.inside ? p.y : undefined });
});
video.addEventListener('contextmenu', (e) => e.preventDefault());
video.addEventListener('auxclick', (e) => e.preventDefault());
stage.addEventListener(
  'wheel',
  (e) => {
    if (!canControl() || fitMode === 'original') return;
    e.preventDefault();
    send({ t: 'wh', dx: -(e.wheelDeltaX || 0), dy: -(e.wheelDeltaY || 0) });
  },
  { passive: false },
);

window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      return api.viewer.fullscreen();
    }
    if (!canControl() || document.activeElement !== stage) return;
    e.preventDefault();
    e.stopPropagation();
    pressed.add(e.code);
    send({ t: 'kd', code: e.code, key: e.key });
  },
  true,
);
window.addEventListener(
  'keyup',
  (e) => {
    if (!pressed.has(e.code)) return;
    e.preventDefault();
    pressed.delete(e.code);
    send({ t: 'ku', code: e.code, key: e.key });
  },
  true,
);
// 失焦时松开所有按键，避免对方“卡键”
function releaseAll() {
  if (pressed.size) for (const code of pressed) send({ t: 'ku', code });
  pressed.clear();
  send({ t: 'release' });
}
window.addEventListener('blur', releaseAll);
stage.addEventListener('blur', () => pressed.size && releaseAll());

// —— 文件发送（独立数据通道）——
const queue = [];
let sending = false;
const CHUNK = 64 * 1024;

stage.addEventListener('dragover', (e) => {
  if (state !== 'connected' || ![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  stage.classList.add('dragging');
});
stage.addEventListener('dragleave', (e) => e.target === stage || e.target === video ? stage.classList.remove('dragging') : null);
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('dragging');
  for (const f of e.dataTransfer.files) if (f.size || f.type) sendFile(f);
});

function openFileConn() {
  if (fileConn && fileConn.open) return Promise.resolve(fileConn);
  return new Promise((resolve, reject) => {
    const c = peer.connect(conn.peer, { reliable: true, serialization: 'binary', metadata: { kind: 'file' } });
    const t = setTimeout(() => reject(new Error('文件通道连接超时')), 15000);
    const pending = new Map();
    c.pending = pending;
    c.on('open', () => c.send({ t: 'hello', kind: 'file' }));
    c.on('data', (msg) => {
      if (msg.t === 'auth') {
        clearTimeout(t);
        if (msg.ok) {
          fileConn = c;
          resolve(c);
        } else reject(new Error(msg.reason || '文件通道未授权'));
      }
      if (msg.t === 'fdone' && pending.has(msg.id)) {
        pending.get(msg.id)(msg.ok);
        pending.delete(msg.id);
      }
    });
    c.on('close', () => {
      for (const fn of pending.values()) fn(false);
      pending.clear();
      if (fileConn === c) fileConn = null;
    });
    c.on('error', (e) => reject(e));
  });
}

function sendFile(file) {
  if (state !== 'connected') return;
  const el = h(`<div class="transfer"><div class="tr-name">${esc(file.name)}</div><div class="tr-bar"><i></i></div><div class="tr-meta">等待发送 · ${formatBytes(file.size)}</div></div>`);
  $('#transfers').appendChild(el);
  const item = {
    file,
    el,
    progress: (sent) => {
      $('i', el).style.width = (file.size ? (sent / file.size) * 100 : 100) + '%';
      $('.tr-meta', el).textContent = `${formatBytes(sent)} / ${formatBytes(file.size)}`;
    },
    done: () => {
      el.classList.add('done');
      $('i', el).style.width = '100%';
      $('.tr-meta', el).textContent = `已发送到对方的“下载/ClearDesk 接收” · ${formatBytes(file.size)}`;
      setTimeout(() => el.remove(), 5000);
    },
    fail: (why) => {
      el.classList.add('fail');
      $('.tr-meta', el).textContent = '发送失败：' + why;
      setTimeout(() => el.remove(), 8000);
    },
  };
  queue.push(item);
  pump();
}

async function pump() {
  if (sending) return;
  sending = true;
  while (queue.length) {
    const item = queue[0];
    try {
      const c = await openFileConn();
      const id = Math.random().toString(36).slice(2);
      const doneP = new Promise((r) => c.pending.set(id, r));
      c.send({ t: 'fb', id, name: item.file.name, size: item.file.size });
      let sent = 0;
      while (sent < item.file.size) {
        if (!c.open) throw new Error('连接已断开');
        // 背压：发送缓冲太多时等一等
        while (c.dataChannel && c.dataChannel.bufferedAmount > 8 * 1024 * 1024) await new Promise((r) => setTimeout(r, 30));
        const buf = await item.file.slice(sent, sent + CHUNK).arrayBuffer();
        c.send({ t: 'fc', id, data: buf });
        sent += buf.byteLength;
        item.progress(sent);
      }
      c.send({ t: 'fe', id, ok: true });
      $('.tr-meta', item.el).textContent = '等待对方保存…';
      if (await doneP) item.done();
      else item.fail('对方保存失败');
    } catch (e) {
      item.fail(e.message || String(e));
    }
    queue.shift();
  }
  sending = false;
}

// —— 启动 ——
(async () => {
  await initTheme('dark');
  init = await api.viewer.init();
  if (!init) return overlay('error', '参数丢失', '请从主窗口重新发起连接。');
  quality = QUALITY[init.quality] ? init.quality : 'balanced';
  updateToolbar();
  start();
})();

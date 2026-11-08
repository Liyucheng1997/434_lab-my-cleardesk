// 被控端：在信令服务器上注册“识别码”，验证来访者，采集屏幕推流，并把收到的鼠标键盘事件交给主进程注入。
import { PREFIX, LAN_HOST_ID, QUALITY } from './common.js';

const api = window.api;
const listeners = new Set();
const sessions = new Map(); // connectionId → session

export const host = {
  cloud: { state: 'connecting', error: '' }, // connecting | online | offline | error
  lan: { state: 'off', error: '', addresses: [], port: 0 },
  sessions: () => [...sessions.values()].filter((s) => s.authed && !s.aux),
  onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  askAccept: async () => true, // 由界面替换：被控时需要确认
  notify: () => {}, // 由界面替换：显示提示
};

const emit = () => listeners.forEach((fn) => fn(host));

let cfg = null;
let settings = null;
let cloudPeer = null;
let lanPeer = null;
let cloudRetry = 0;
let cloudTimer = null;
let lanTimer = null;
let failCount = 0;
let lockUntil = 0;
let clipTimer = null;
let lastClip = '';

export async function startHost() {
  settings = await api.settings.get();
  cfg = await api.server.config();
  connectCloud();
  api.lan.onStatus((st) => applyLan(st));
  applyLan(await api.lan.status());
  api.host.onDisconnect((id) => {
    for (const s of host.sessions()) if (!id || s.id === id) disconnect(s, '被控端断开了连接');
  });
  api.settings.onChanged(async () => (settings = await api.settings.get()));
}

export async function reloadHost() {
  settings = await api.settings.get();
  cfg = await api.server.config();
  connectCloud();
  applyLan(await api.lan.status());
}

export function refreshSettings(s) {
  settings = s;
}

function peerOptions(server, iceServers) {
  return { host: server.host, port: server.port, path: server.path, secure: server.secure, key: server.key, config: { iceServers }, debug: 0, pingInterval: 5000 };
}

// —— 公网（识别码）——
function connectCloud() {
  clearTimeout(cloudTimer);
  if (cloudPeer) {
    const old = cloudPeer;
    cloudPeer = null;
    old.destroy();
  }
  host.cloud = { state: 'connecting', error: '' };
  emit();
  const p = new Peer(PREFIX + settings.deviceId, peerOptions(cfg.cloud, cfg.iceServers));
  cloudPeer = p;
  p.on('open', () => {
    if (p !== cloudPeer) return;
    cloudRetry = 0;
    host.cloud = { state: 'online', error: '' };
    emit();
  });
  p.on('connection', (conn) => handleConnection(conn, 'cloud', p));
  p.on('disconnected', () => {
    if (p !== cloudPeer || p.destroyed) return;
    host.cloud = { state: 'offline', error: '与服务器的连接已断开，正在重连…' };
    emit();
    scheduleCloud(() => p.reconnect());
  });
  p.on('error', (err) => {
    if (p !== cloudPeer) return;
    if (err.type === 'peer-unavailable') return;
    if (err.type === 'unavailable-id') {
      host.cloud = { state: 'error', error: '识别码已在其他地方在线，稍后重试' };
    } else {
      host.cloud = { state: 'offline', error: '无法连接服务器，正在重试…' };
    }
    emit();
    scheduleCloud(() => connectCloud());
  });
}

function scheduleCloud(fn) {
  clearTimeout(cloudTimer);
  const delay = Math.min(30000, 2000 * 2 ** cloudRetry++);
  cloudTimer = setTimeout(fn, delay);
}

// —— 局域网：注册到本机运行的信令服务器上 ——
function applyLan(st) {
  clearTimeout(lanTimer);
  host.lan = { state: st.running ? 'connecting' : st.error ? 'error' : 'off', error: st.error || '', addresses: st.addresses || [], port: st.port };
  if (lanPeer) {
    const old = lanPeer;
    lanPeer = null;
    old.destroy();
  }
  emit();
  if (!st.running) return;
  const p = new Peer(LAN_HOST_ID, peerOptions({ host: '127.0.0.1', port: st.port, path: '/', secure: false, key: 'cleardesk' }, []));
  lanPeer = p;
  p.on('open', () => {
    if (p !== lanPeer) return;
    host.lan.state = 'online';
    emit();
  });
  p.on('connection', (conn) => handleConnection(conn, 'lan', p));
  const retry = () => {
    if (p !== lanPeer) return;
    host.lan.state = 'connecting';
    emit();
    lanTimer = setTimeout(async () => applyLan(await api.lan.status()), 3000);
  };
  p.on('disconnected', retry);
  p.on('error', (err) => err.type !== 'peer-unavailable' && retry());
}

// —— 会话 ——
function handleConnection(conn, via, peer) {
  const s = { id: conn.connectionId, conn, via, peer, authed: false, name: '', from: '', since: 0, stream: null, call: null, source: null, quality: 'balanced', clip: false };
  sessions.set(s.id, s);
  // 20 秒内必须发来 hello；收到后由验证/确认流程自己控制超时
  s.helloTimer = setTimeout(() => !s.authed && close(s), 20000);
  conn.on('data', (msg) => onMessage(s, msg).catch((e) => console.error(e)));
  conn.on('close', () => {
    clearTimeout(s.helloTimer);
    end(s);
  });
  conn.on('error', () => end(s));
}

function reply(s, msg) {
  try {
    if (s.conn.open) s.conn.send(msg);
  } catch {}
}

function close(s, delay = 0) {
  setTimeout(() => {
    try {
      s.conn.close();
    } catch {}
    end(s);
  }, delay);
}

function disconnect(s, reason) {
  reply(s, { t: 'bye', reason });
  close(s, 300);
}

async function onMessage(s, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (!s.authed) {
    if (msg.t === 'hello') return hello(s, msg);
    return;
  }
  switch (msg.t) {
    case 'mm':
    case 'md':
    case 'mu':
    case 'wh':
    case 'kd':
    case 'ku':
    case 'combo':
    case 'text':
    case 'lock':
    case 'release':
      if (!s.aux) api.input({ ...msg, d: s.source && s.source.displayId });
      break;
    case 'display':
      await switchDisplay(s, msg.id);
      break;
    case 'quality':
      s.quality = QUALITY[msg.q] ? msg.q : 'balanced';
      applyQuality(s);
      break;
    case 'ping':
      reply(s, { t: 'pong', ts: msg.ts });
      break;
    case 'clipsync':
      s.clip = !!msg.on;
      syncClipTimer();
      break;
    case 'clip':
      if (typeof msg.text === 'string') {
        lastClip = msg.text;
        await api.clipboard.write(msg.text);
      }
      break;
    case 'fb':
      s.files = s.files || new Map();
      s.files.set(msg.id, { name: msg.name, size: msg.size, got: 0 });
      await api.file.begin({ id: s.id + ':' + msg.id, name: msg.name });
      break;
    case 'fc': {
      const f = s.files && s.files.get(msg.id);
      if (!f) break;
      const data = msg.data instanceof ArrayBuffer ? new Uint8Array(msg.data) : msg.data;
      f.got += data.byteLength;
      await api.file.chunk({ id: s.id + ':' + msg.id, data });
      break;
    }
    case 'fe': {
      const f = s.files && s.files.get(msg.id);
      if (!f) break;
      s.files.delete(msg.id);
      const p = await api.file.end({ id: s.id + ':' + msg.id, ok: !!msg.ok });
      reply(s, { t: 'fdone', id: msg.id, ok: !!p });
      if (p) host.notify({ type: 'file', name: f.name, path: p, from: s.name });
      break;
    }
    case 'bye':
      close(s);
      break;
  }
}

async function hello(s, msg) {
  if (s.helloSeen) return;
  s.helloSeen = true;
  clearTimeout(s.helloTimer);
  s.name = String(msg.name || '').slice(0, 64) || '未知设备';
  s.from = String(msg.from || '').slice(0, 32);
  const fail = (reason) => {
    reply(s, { t: 'auth', ok: false, reason });
    close(s, 1000);
  };
  // 文件通道：独立的数据连接传文件，避免大文件阻塞鼠标键盘。只允许已通过验证的控制端开启。
  if (msg.kind === 'file') {
    const main = [...sessions.values()].find((x) => x.authed && !x.aux && x.conn.peer === s.conn.peer);
    if (!main) return fail('未授权');
    s.aux = true;
    s.authed = true;
    s.name = main.name;
    return reply(s, { t: 'auth', ok: true });
  }
  if (!settings.allowControl) return fail('对方已关闭“允许远程控制本机”');
  if (Date.now() < lockUntil) return fail('验证失败次数过多，请 1 分钟后再试');
  if (!(await api.settings.verify(msg.password))) {
    if (++failCount >= 5) {
      failCount = 0;
      lockUntil = Date.now() + 60000;
    }
    return fail('验证码错误');
  }
  failCount = 0;
  if (settings.requireConfirm) {
    reply(s, { t: 'waiting' });
    const ok = await host.askAccept(s);
    if (!s.conn.open) return;
    if (!ok) return fail('对方拒绝了你的连接请求');
  }
  const sources = await api.screen.sources();
  if (!sources.length) return fail('对方电脑无法采集屏幕');
  const source = sources.find((x) => x.primary) || sources[0];
  try {
    s.stream = await capture(source);
  } catch (e) {
    return fail('对方电脑屏幕采集失败：' + e.message);
  }
  s.source = source;
  s.quality = QUALITY[msg.quality] ? msg.quality : 'balanced';
  s.authed = true;
  s.since = Date.now();
  const info = await api.app.info();
  reply(s, { t: 'auth', ok: true, hostName: settings.deviceName || info.hostname, hostId: settings.deviceId, displays: sources, current: source.id, version: info.version });
  s.call = s.peer.call(s.conn.peer, s.stream, { metadata: { sid: s.id } });
  const pc = s.call.peerConnection;
  if (pc) {
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') applyQuality(s);
      if (pc.connectionState === 'failed') disconnect(s, '画面通道建立失败');
    });
  }
  s.call.on('close', () => s.authed && close(s));
  publish();
  host.notify({ type: 'connected', name: s.name, from: s.from });
}

async function capture(source) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxWidth: source.width, maxHeight: source.height, maxFrameRate: 60 } },
  });
  return stream;
}

async function switchDisplay(s, sourceId) {
  const sources = await api.screen.sources();
  const source = sources.find((x) => x.id === sourceId);
  if (!source || !s.call || !s.call.peerConnection) return;
  const stream = await capture(source);
  const track = stream.getVideoTracks()[0];
  const sender = s.call.peerConnection.getSenders().find((x) => x.track && x.track.kind === 'video');
  if (sender) await sender.replaceTrack(track);
  api.releaseInput();
  if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
  s.stream = stream;
  s.source = source;
  applyQuality(s);
  reply(s, { t: 'display', current: source.id, displays: sources });
}

async function applyQuality(s) {
  const pc = s.call && s.call.peerConnection;
  if (!pc || !s.stream) return;
  const q = QUALITY[s.quality];
  const track = s.stream.getVideoTracks()[0];
  if (track) track.contentHint = q.hint;
  const sender = pc.getSenders().find((x) => x.track && x.track.kind === 'video');
  if (!sender) return;
  try {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    const w = (track && track.getSettings().width) || s.source.width;
    p.encodings[0].maxBitrate = q.maxBitrate;
    p.encodings[0].maxFramerate = q.fps;
    p.encodings[0].scaleResolutionDownBy = q.maxWidth && w > q.maxWidth ? w / q.maxWidth : 1;
    p.degradationPreference = s.quality === 'smooth' ? 'maintain-framerate' : 'balanced';
    await sender.setParameters(p);
  } catch (e) {
    console.warn('设置画质失败', e);
  }
}

// 剪贴板同步：被控端剪贴板变化时发给开启了同步的控制端
function syncClipTimer() {
  const need = host.sessions().some((s) => s.clip);
  if (need && !clipTimer) {
    api.clipboard.read().then((t) => (lastClip = t));
    clipTimer = setInterval(async () => {
      const t = await api.clipboard.read();
      if (t && t !== lastClip) {
        lastClip = t;
        for (const s of host.sessions()) if (s.clip) reply(s, { t: 'clip', text: t });
      }
    }, 1000);
  }
  if (!need && clipTimer) {
    clearInterval(clipTimer);
    clipTimer = null;
  }
}

function end(s) {
  if (!sessions.has(s.id)) return;
  sessions.delete(s.id);
  const wasAuthed = s.authed;
  s.authed = false;
  if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
  try {
    if (s.call) s.call.close();
  } catch {}
  if (s.files) for (const id of s.files.keys()) api.file.end({ id: s.id + ':' + id, ok: false });
  if (s.aux) return;
  // 主会话结束时，同一控制端的文件通道一起关闭
  for (const x of [...sessions.values()]) if (x.aux && x.conn.peer === s.conn.peer) close(x);
  api.releaseInput();
  syncClipTimer();
  if (wasAuthed) {
    publish();
    host.notify({ type: 'disconnected', name: s.name });
  }
}

export function disconnectSession(id) {
  const s = sessions.get(id);
  if (s) disconnect(s, '被控端断开了连接');
}

function publish() {
  api.host.sessionsChanged(host.sessions().map((s) => ({ id: s.id, name: s.name, from: s.from, via: s.via, since: s.since })));
  emit();
}

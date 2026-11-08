// ClearDesk 晴窗远程：主进程。
// 主窗口同时承担“被控端”（注册识别码、接受连接、采集屏幕），每个“远程控制”会话开一个独立的查看窗口。
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, Tray, Menu, nativeTheme, clipboard, shell, powerSaveBlocker, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const settings = require('./settings');
const input = require('./input');
const lan = require('./lan-server');
const updater = require('./update-service');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const ICON = path.join(ROOT, 'build', 'icon.png');
const startHidden = process.argv.includes('--hidden');

// 测试/多开：--profile=<目录> 使用独立的数据目录（独立识别码）
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) app.setPath('userData', path.resolve(profileArg.slice(10)));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
}

// 后台标签页也要保持实时（被控端在主窗口隐藏到托盘时也在推流）
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// 局域网直连需要真实的本机 IP 候选，关闭 Chromium 的 mDNS 隐藏
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let mainWin = null;
let bannerWin = null;
let tray = null;
let quitting = false;
let sessions = []; // 被控会话：{ id, peer, name, mode }
let blocker = -1;
const viewers = new Map(); // webContents.id → { win, opts }

const isDark = () => nativeTheme.shouldUseDarkColors;
const overlay = (dark) => ({ color: dark ? '#000000' : '#f5f5f7', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 40 });

function send(channel, ...args) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, ...args);
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 940,
    height: 640,
    minWidth: 760,
    minHeight: 540,
    show: false,
    title: 'ClearDesk 晴窗远程',
    icon: ICON,
    backgroundColor: isDark() ? '#000000' : '#f5f5f7',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(isDark()),
    webPreferences: { preload: PRELOAD, backgroundThrottling: false, contextIsolation: true, sandbox: false },
  });
  mainWin.loadFile(path.join(RENDERER, 'index.html'));
  mainWin.once('ready-to-show', () => {
    if (!startHidden) mainWin.show();
  });
  mainWin.on('close', (e) => {
    if (quitting) return;
    if (settings.get().closeToTray) {
      e.preventDefault();
      mainWin.hide();
    } else if (sessions.length) {
      e.preventDefault();
      mainWin.webContents.send('app:confirm-quit');
    } else {
      quitting = true;
    }
  });
  mainWin.on('closed', () => {
    mainWin = null;
    if (!quitting) return;
    app.quit();
  });
  devShortcuts(mainWin);
}

function devShortcuts(win) {
  win.webContents.on('before-input-event', (e, inp) => {
    if (inp.type === 'keyDown' && inp.key === 'F12' && inp.control && inp.shift) win.webContents.toggleDevTools();
  });
}

function showMain() {
  if (!mainWin) return createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function quitApp() {
  quitting = true;
  for (const { win } of viewers.values()) if (!win.isDestroyed()) win.destroy();
  app.quit();
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'build', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }) : img);
  tray.on('click', showMain);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const s = settings.get();
  const id = s.deviceId.replace(/(\d{3})(?=\d)/g, '$1 ');
  tray.setToolTip(`ClearDesk 晴窗远程\n识别码 ${id}${sessions.length ? `\n${sessions.length} 个连接正在控制本机` : ''}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `识别码 ${id}`, enabled: false },
      { type: 'separator' },
      { label: '显示主窗口', click: showMain },
      { label: '断开所有被控连接', enabled: sessions.length > 0, click: () => send('host:disconnect', null) },
      { type: 'separator' },
      { label: '退出', click: quitApp },
    ]),
  );
}

// —— 被控提示条：屏幕顶部居中的小卡片，显示谁在控制本机，可一键断开 ——
function syncBanner() {
  if (!sessions.length) {
    if (bannerWin && !bannerWin.isDestroyed()) bannerWin.destroy();
    bannerWin = null;
    return;
  }
  if (!bannerWin || bannerWin.isDestroyed()) {
    const wa = screen.getPrimaryDisplay().workArea;
    const w = 420;
    bannerWin = new BrowserWindow({
      width: w,
      height: 52,
      x: Math.round(wa.x + (wa.width - w) / 2),
      y: wa.y + 8,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
    });
    bannerWin.setAlwaysOnTop(true, 'screen-saver');
    bannerWin.loadFile(path.join(RENDERER, 'banner.html'));
    bannerWin.once('ready-to-show', () => bannerWin && bannerWin.showInactive());
    bannerWin.webContents.on('did-finish-load', () => bannerWin && bannerWin.webContents.send('banner:sessions', sessions));
    return;
  }
  bannerWin.webContents.send('banner:sessions', sessions);
}

// —— 远程控制窗口 ——
function openViewer(opts) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 420,
    title: `正在连接 ${opts.title || opts.target}`,
    icon: ICON,
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1c1c1e', symbolColor: '#f5f5f7', height: 40 },
    webPreferences: { preload: PRELOAD, backgroundThrottling: false, contextIsolation: true, sandbox: false },
  });
  const id = win.webContents.id;
  viewers.set(id, { win, opts, allowClose: false });
  win.loadFile(path.join(RENDERER, 'viewer.html'));
  devShortcuts(win);
  win.on('close', (e) => {
    const v = viewers.get(id);
    if (v && !v.allowClose && !quitting) {
      e.preventDefault();
      win.webContents.send('viewer:close-request');
    }
  });
  win.on('enter-full-screen', () => win.webContents.send('viewer:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('viewer:fullscreen', false));
  win.on('closed', () => {
    viewers.delete(id);
    syncBlocker();
  });
  syncBlocker();
}

// 有会话时阻止息屏
function syncBlocker() {
  const need = sessions.length > 0 || viewers.size > 0;
  if (need && blocker < 0) blocker = powerSaveBlocker.start('prevent-display-sleep');
  if (!need && blocker >= 0) {
    powerSaveBlocker.stop(blocker);
    blocker = -1;
  }
}

function serverConfig() {
  const s = settings.get();
  const iceServers = [
    { urls: ['stun:stun.miwifi.com:3478', 'stun:stun.chat.bilibili.com:3478'] },
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
  ];
  if (s.turn.urls) {
    iceServers.push({ urls: s.turn.urls.split(/[\s,]+/).filter(Boolean), username: s.turn.username, credential: s.turn.credential });
  } else {
    // PeerJS 公共中继，点对点打洞失败时兜底
    iceServers.push({ urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' });
  }
  const cloud =
    s.serverMode === 'custom' && s.server.host
      ? { host: s.server.host, port: Number(s.server.port) || (s.server.secure ? 443 : 80), path: s.server.path || '/', secure: !!s.server.secure, key: s.server.key || 'peerjs' }
      : { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' };
  return { cloud, lanPort: s.lanPort, iceServers };
}

function applyAutoStart() {
  if (!app.isPackaged) return;
  const s = settings.get();
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: !!s.autoStart, path: exe, args: ['--hidden'] });
}

async function restartLan() {
  const s = settings.get();
  if (!s.lanEnabled) {
    lan.stop();
  } else {
    await lan.start(Number(s.lanPort) || 21118);
  }
  const st = lan.status();
  send('lan:status', st);
  return st;
}

// —— 接收文件（被控端） ——
const incoming = new Map();
function receiveDir() {
  const dir = path.join(app.getPath('downloads'), 'ClearDesk 接收');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function uniquePath(dir, name) {
  const safe = path.basename(String(name || '文件')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || '文件';
  let p = path.join(dir, safe);
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings.publicSettings());
  ipcMain.handle('settings:update', (_e, patch) => {
    const out = settings.update(patch);
    if ('theme' in patch) nativeTheme.themeSource = out.theme;
    if ('autoStart' in patch) applyAutoStart();
    if ('lanEnabled' in patch || 'lanPort' in patch) restartLan();
    updateTray();
    return out;
  });
  ipcMain.handle('settings:setPassword', (_e, pwd) => settings.setPassword(pwd));
  ipcMain.handle('settings:refreshCode', () => settings.refreshCode());
  ipcMain.handle('settings:verify', (_e, pwd) => settings.verifyPassword(pwd));
  ipcMain.handle('recent:add', (_e, r) => {
    settings.addRecent(r);
    send('settings:changed');
  });
  ipcMain.handle('recent:remove', (_e, key) => settings.removeRecent(key));
  ipcMain.handle('recent:password', (_e, key) => settings.recentPassword(key));
  ipcMain.handle('server:config', () => serverConfig());

  ipcMain.handle('screen:sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    return sources.map((s, i) => {
      const d = displays.find((x) => String(x.id) === String(s.display_id)) || displays[i] || primary;
      const r = process.platform === 'win32' ? screen.dipToScreenRect(null, d.bounds) : d.bounds;
      return { id: s.id, name: `显示器 ${i + 1}`, displayId: String(d.id), width: r.width, height: r.height, primary: d.id === primary.id };
    });
  });

  ipcMain.on('input', (_e, msg) => input.handle(msg));
  ipcMain.on('input:release', () => input.releaseAll());

  ipcMain.handle('lan:status', () => lan.status());
  ipcMain.handle('lan:restart', () => restartLan());

  ipcMain.handle('viewer:open', (_e, opts) => openViewer(opts));
  ipcMain.handle('viewer:init', (e) => {
    const v = viewers.get(e.sender.id);
    return v ? { ...v.opts, server: serverConfig(), deviceId: settings.get().deviceId, deviceName: settings.get().deviceName, quality: settings.get().defaultQuality } : null;
  });
  ipcMain.handle('viewer:close', (e) => {
    const v = viewers.get(e.sender.id);
    if (v) {
      v.allowClose = true;
      v.win.close();
    }
  });
  ipcMain.handle('viewer:fullscreen', (e, on) => {
    const v = viewers.get(e.sender.id);
    if (v) v.win.setFullScreen(on == null ? !v.win.isFullScreen() : !!on);
  });
  ipcMain.handle('viewer:title', (e, title) => {
    const v = viewers.get(e.sender.id);
    if (v) v.win.setTitle(title);
  });
  ipcMain.handle('viewer:resize', (e, { width, height }) => {
    // 按远程画面比例调整窗口（不超过工作区）
    const v = viewers.get(e.sender.id);
    if (!v || v.win.isFullScreen() || v.win.isMaximized()) return;
    const wa = screen.getDisplayMatching(v.win.getBounds()).workArea;
    const maxW = wa.width * 0.92;
    const maxH = wa.height * 0.92 - 40;
    const k = Math.min(1, maxW / width, maxH / height);
    v.win.setContentSize(Math.round(width * k), Math.round(height * k + 40));
    v.win.center();
  });

  ipcMain.handle('session:changed', (_e, list) => {
    sessions = list;
    syncBanner();
    syncBlocker();
    updateTray();
    if (!list.length) input.releaseAll();
  });
  ipcMain.handle('banner:disconnect', (_e, id) => send('host:disconnect', id || null));
  ipcMain.handle('banner:showMain', () => showMain());

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text || '')));

  ipcMain.handle('file:begin', (_e, { id, name }) => {
    const p = uniquePath(receiveDir(), name);
    incoming.set(id, { path: p, fd: fs.openSync(p, 'w') });
    return p;
  });
  ipcMain.handle('file:chunk', (_e, { id, data }) => {
    const f = incoming.get(id);
    if (f) fs.writeSync(f.fd, Buffer.from(data));
  });
  ipcMain.handle('file:end', (_e, { id, ok }) => {
    const f = incoming.get(id);
    if (!f) return null;
    fs.closeSync(f.fd);
    incoming.delete(id);
    if (!ok) {
      try {
        fs.unlinkSync(f.path);
      } catch {}
      return null;
    }
    return f.path;
  });
  ipcMain.handle('file:show', (_e, p) => (p ? shell.showItemInFolder(p) : shell.openPath(receiveDir())));

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), hostname: os.hostname(), user: os.userInfo().username, packaged: app.isPackaged, platform: process.platform }));
  ipcMain.handle('app:openExternal', (_e, url) => /^https?:\/\//.test(url) && shell.openExternal(url));
  ipcMain.handle('app:showMain', () => showMain());
  ipcMain.handle('app:quit', () => quitApp());
  ipcMain.handle('app:dark', () => isDark());

  updater.register(ipcMain);
}

nativeTheme.on('updated', () => {
  const dark = isDark();
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.setTitleBarOverlay(overlay(dark));
    mainWin.setBackgroundColor(dark ? '#000000' : '#f5f5f7');
  }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('theme:dark', dark);
});

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('io.github.liyucheng1997.cleardesk');
  settings.load();
  nativeTheme.themeSource = settings.get().theme;
  registerIpc();
  createMain();
  createTray();
  applyAutoStart();
  restartLan();
  updater.init({
    send,
    beforeInstall: () => {
      quitting = true;
    },
  });
});

app.on('before-quit', () => {
  quitting = true;
  input.releaseAll();
});
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});

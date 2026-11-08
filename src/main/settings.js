// 设置与本机身份：识别码（首次生成后固定）、验证码（每次启动刷新）、安全密码（加盐哈希）、最近连接。
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

const DEFAULTS = {
  deviceId: '',
  deviceName: '',
  passwordHash: '', // 安全密码：salt:sha256
  requireConfirm: false, // 被控时需要我确认
  allowControl: true, // 允许被远程控制
  lanEnabled: true,
  lanPort: 21118,
  serverMode: 'cloud', // cloud | custom
  server: { host: '', port: 9000, path: '/', secure: false, key: 'cleardesk' },
  turn: { urls: '', username: '', credential: '' },
  autoStart: false,
  closeToTray: true,
  theme: 'system', // system | light | dark
  autoUpdate: true,
  defaultQuality: 'balanced', // smooth | balanced | hd
  recent: [], // { key, mode, target, name, time, pwd(加密) }
};

let data = null;
let tempCode = '';
const file = () => path.join(app.getPath('userData'), 'settings.json');

function randomDeviceId() {
  return String(crypto.randomInt(1, 10)) + String(crypto.randomInt(0, 1e8)).padStart(8, '0');
}

function randomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)];
  return s;
}

function load() {
  if (data) return data;
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {}
  data = { ...DEFAULTS, ...saved, server: { ...DEFAULTS.server, ...(saved.server || {}) }, turn: { ...DEFAULTS.turn, ...(saved.turn || {}) } };
  if (!/^\d{9}$/.test(data.deviceId)) data.deviceId = randomDeviceId();
  if (!data.deviceName) data.deviceName = require('os').hostname();
  tempCode = randomCode();
  save();
  return data;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('保存设置失败', e);
  }
}

function hash(pwd, salt = crypto.randomBytes(8).toString('hex')) {
  return salt + ':' + crypto.createHash('sha256').update(salt + pwd).digest('hex');
}

function verifyPassword(pwd) {
  pwd = String(pwd || '').trim();
  if (!pwd) return false;
  const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (eq(pwd.toLowerCase(), tempCode)) return true;
  if (data.passwordHash) {
    const [salt] = data.passwordHash.split(':');
    if (eq(hash(pwd, salt), data.passwordHash)) return true;
  }
  return false;
}

// 给渲染进程看的设置（不含哈希和加密的密码）
function publicSettings() {
  const { passwordHash, recent, ...rest } = data;
  return {
    ...rest,
    hasPassword: !!passwordHash,
    tempCode,
    recent: recent.map(({ pwd, ...r }) => ({ ...r, hasPwd: !!pwd })),
  };
}

const ALLOWED = ['deviceName', 'requireConfirm', 'allowControl', 'lanEnabled', 'lanPort', 'serverMode', 'server', 'turn', 'autoStart', 'closeToTray', 'theme', 'autoUpdate', 'defaultQuality'];

function update(patch) {
  for (const k of Object.keys(patch || {})) {
    if (ALLOWED.includes(k)) data[k] = patch[k];
  }
  save();
  return publicSettings();
}

function setPassword(pwd) {
  pwd = String(pwd || '').trim();
  data.passwordHash = pwd ? hash(pwd) : '';
  save();
}

function refreshCode() {
  tempCode = randomCode();
  return tempCode;
}

function enc(s) {
  if (!s) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) return 'e:' + safeStorage.encryptString(s).toString('base64');
  } catch {}
  return '';
}
function dec(s) {
  if (!s || !s.startsWith('e:')) return '';
  try {
    return safeStorage.decryptString(Buffer.from(s.slice(2), 'base64'));
  } catch {
    return '';
  }
}

function addRecent({ mode, target, name, password, remember }) {
  const key = mode + ':' + target;
  const old = data.recent.find((r) => r.key === key);
  const item = { key, mode, target, name: name || (old && old.name) || '', time: Date.now(), pwd: remember ? enc(password) : '' };
  data.recent = [item, ...data.recent.filter((r) => r.key !== key)].slice(0, 30);
  save();
}

function removeRecent(key) {
  data.recent = data.recent.filter((r) => r.key !== key);
  save();
}

function recentPassword(key) {
  const r = data.recent.find((x) => x.key === key);
  return r ? dec(r.pwd) : '';
}

module.exports = { load, get: () => data, publicSettings, update, setPassword, verifyPassword, refreshCode, addRecent, removeRecent, recentPassword };

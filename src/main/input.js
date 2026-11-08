// 在被控端注入鼠标、键盘事件（Win32 SendInput，经 koffi 调用，无需编译原生模块）。
// 坐标由控制端发来 0..1 的归一化值，这里换算成被采集显示器的物理像素。
const { screen } = require('electron');

let api = null;
function lib() {
  if (api) return api;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const MOUSEINPUT = koffi.struct('MOUSEINPUT', { dx: 'long', dy: 'long', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
  const KEYBDINPUT = koffi.struct('KEYBDINPUT', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
  const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
  const INPUT_U = koffi.union('INPUT_U', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT });
  const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_U });
  api = {
    INPUT,
    size: koffi.sizeof(INPUT),
    SendInput: user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)'),
    SetCursorPos: user32.func('bool __stdcall SetCursorPos(int X, int Y)'),
    MapVirtualKeyW: user32.func('uint32 __stdcall MapVirtualKeyW(uint32 uCode, uint32 uMapType)'),
    LockWorkStation: user32.func('bool __stdcall LockWorkStation()'),
  };
  return api;
}

const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const MOUSE = { LEFTDOWN: 0x2, LEFTUP: 0x4, RIGHTDOWN: 0x8, RIGHTUP: 0x10, MIDDLEDOWN: 0x20, MIDDLEUP: 0x40, XDOWN: 0x80, XUP: 0x100, WHEEL: 0x800, HWHEEL: 0x1000 };
const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const KEYEVENTF_UNICODE = 0x4;

function sendMouse(flags, data = 0) {
  const a = lib();
  a.SendInput(1, { type: INPUT_MOUSE, u: { mi: { dx: 0, dy: 0, mouseData: data >>> 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }, a.size);
}
function sendKey(vk, up, extended) {
  const a = lib();
  const scan = a.MapVirtualKeyW(vk, 0) & 0xff;
  const flags = (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0);
  a.SendInput(1, { type: INPUT_KEYBOARD, u: { ki: { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }, a.size);
}
function sendUnicode(ch) {
  const a = lib();
  const code = ch.charCodeAt(0);
  for (const up of [false, true]) {
    a.SendInput(1, { type: INPUT_KEYBOARD, u: { ki: { wVk: 0, wScan: code, dwFlags: KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0), time: 0, dwExtraInfo: 0 } } }, a.size);
  }
}

// KeyboardEvent.code → Windows 虚拟键码
const VK = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0d, ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3, AltLeft: 0xa4, AltRight: 0xa5,
  Pause: 0x13, CapsLock: 0x14, Escape: 0x1b, Space: 0x20, PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24,
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28, PrintScreen: 0x2c, Insert: 0x2d, Delete: 0x2e,
  MetaLeft: 0x5b, MetaRight: 0x5c, ContextMenu: 0x5d,
  Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63, Numpad4: 0x64, Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67, Numpad8: 0x68, Numpad9: 0x69,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadDecimal: 0x6e, NumpadDivide: 0x6f, NumpadEnter: 0x0d, NumLock: 0x90, ScrollLock: 0x91,
  Semicolon: 0xba, Equal: 0xbb, Comma: 0xbc, Minus: 0xbd, Period: 0xbe, Slash: 0xbf, Backquote: 0xc0, BracketLeft: 0xdb, Backslash: 0xdc, BracketRight: 0xdd, Quote: 0xde, IntlBackslash: 0xe2,
  AudioVolumeMute: 0xad, AudioVolumeDown: 0xae, AudioVolumeUp: 0xaf, MediaTrackNext: 0xb0, MediaTrackPrevious: 0xb1, MediaStop: 0xb2, MediaPlayPause: 0xb3,
};
for (let i = 0; i < 26; i++) VK['Key' + String.fromCharCode(65 + i)] = 0x41 + i;
for (let i = 0; i < 10; i++) VK['Digit' + i] = 0x30 + i;
for (let i = 1; i <= 24; i++) VK['F' + i] = 0x6f + i;
const EXTENDED = new Set(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'NumpadEnter', 'NumpadDivide', 'ControlRight', 'AltRight', 'MetaLeft', 'MetaRight', 'ContextMenu', 'PrintScreen', 'NumLock']);

// 被采集显示器的物理像素区域
function displayRect(displayId) {
  const displays = screen.getAllDisplays();
  const d = displays.find((x) => String(x.id) === String(displayId)) || screen.getPrimaryDisplay();
  return process.platform === 'win32' ? screen.dipToScreenRect(null, d.bounds) : d.bounds;
}

const pressedKeys = new Set();
const pressedButtons = new Set();
const BTN = [
  [MOUSE.LEFTDOWN, MOUSE.LEFTUP, 0],
  [MOUSE.MIDDLEDOWN, MOUSE.MIDDLEUP, 0],
  [MOUSE.RIGHTDOWN, MOUSE.RIGHTUP, 0],
  [MOUSE.XDOWN, MOUSE.XUP, 1],
  [MOUSE.XDOWN, MOUSE.XUP, 2],
];

function move(displayId, x, y) {
  const r = displayRect(displayId);
  const px = Math.round(r.x + Math.min(Math.max(x, 0), 1) * (r.width - 1));
  const py = Math.round(r.y + Math.min(Math.max(y, 0), 1) * (r.height - 1));
  lib().SetCursorPos(px, py);
}

function handle(msg) {
  if (process.platform !== 'win32') return;
  try {
    switch (msg.t) {
      case 'mm':
        move(msg.d, msg.x, msg.y);
        break;
      case 'md':
      case 'mu': {
        if (msg.x != null) move(msg.d, msg.x, msg.y);
        const b = BTN[msg.b];
        if (!b) break;
        sendMouse(msg.t === 'md' ? b[0] : b[1], b[2]);
        if (msg.t === 'md') pressedButtons.add(msg.b);
        else pressedButtons.delete(msg.b);
        break;
      }
      case 'wh':
        if (msg.dy) sendMouse(MOUSE.WHEEL, Math.round(-msg.dy));
        if (msg.dx) sendMouse(MOUSE.HWHEEL, Math.round(msg.dx));
        break;
      case 'kd':
      case 'ku': {
        const vk = VK[msg.code];
        if (vk) {
          sendKey(vk, msg.t === 'ku', EXTENDED.has(msg.code));
          if (msg.t === 'kd') pressedKeys.add(msg.code);
          else pressedKeys.delete(msg.code);
        } else if (msg.t === 'kd' && msg.key && msg.key.length === 1) {
          sendUnicode(msg.key);
        }
        break;
      }
      case 'combo': // 组合键，例如 ['ControlLeft','ShiftLeft','Escape']
        for (const c of msg.keys) if (VK[c]) sendKey(VK[c], false, EXTENDED.has(c));
        for (const c of [...msg.keys].reverse()) if (VK[c]) sendKey(VK[c], true, EXTENDED.has(c));
        break;
      case 'text':
        // 逐个 UTF-16 码元发送，代理对（如 emoji）也能正确合成
        for (const unit of String(msg.text || '').slice(0, 5000)) for (let i = 0; i < unit.length; i++) sendUnicode(unit[i]);
        break;
      case 'lock':
        lib().LockWorkStation();
        break;
      case 'release':
        releaseAll();
        break;
    }
  } catch (e) {
    console.error('输入注入失败', e);
  }
}

// 控制端失焦或断开时，松开所有还按着的键，避免对方电脑“卡键”
function releaseAll() {
  try {
    for (const code of pressedKeys) sendKey(VK[code], true, EXTENDED.has(code));
    for (const b of pressedButtons) if (BTN[b]) sendMouse(BTN[b][1], BTN[b][2]);
  } catch {}
  pressedKeys.clear();
  pressedButtons.clear();
}

module.exports = { handle, releaseAll };

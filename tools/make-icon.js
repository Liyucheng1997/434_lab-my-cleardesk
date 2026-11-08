// 生成应用图标：蓝色圆角方块 + 白色显示器 + 箭头光标。输出 build/icon.png（512）和 build/icon.ico（16~256）。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 有符号距离：圆角矩形
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
function inTri(px, py, a, b, c) {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s([px, py], a, b), d2 = s([px, py], b, c), d3 = s([px, py], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// 单位坐标 0..1 下的形状，返回 [r,g,b,a]
function shade(x, y) {
  const bg = sdRoundRect(x, y, 0.5, 0.5, 0.46, 0.46, 0.2);
  if (bg > 0) return null;
  const blue = [0, 113, 227];
  const white = [255, 255, 255];
  // 光标（白色箭头，带蓝色描边感）
  const tip = [0.56, 0.5];
  const arrow = [tip, [0.56, 0.86], [0.66, 0.77]];
  const arrow2 = [tip, [0.66, 0.77], [0.8, 0.76]];
  const tail = sdRoundRect(x, y, 0.69, 0.82, 0.025, 0.07, 0.02);
  const isArrow = inTri(x, y, ...arrow) || inTri(x, y, ...arrow2);
  const rot = (() => { // 尾巴：旋转 -35°
    const a = -0.6, cx = 0.69, cy = 0.8, dx = x - cx, dy = y - cy;
    return sdRoundRect(cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a), cx, cy, 0.028, 0.075, 0.02);
  })();
  void tail;
  if (isArrow || rot < 0) return white;
  // 光标外围留一圈蓝色间隙
  const near = (() => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const ox = x + Math.cos(a) * 0.035, oy = y + Math.sin(a) * 0.035;
      if (inTri(ox, oy, ...arrow) || inTri(ox, oy, ...arrow2)) return true;
    }
    return false;
  })();
  if (near) return blue;
  // 显示器外框
  const screenOuter = sdRoundRect(x, y, 0.5, 0.42, 0.28, 0.2, 0.05);
  const screenInner = sdRoundRect(x, y, 0.5, 0.42, 0.22, 0.14, 0.02);
  if (screenOuter < 0 && screenInner > 0) return white;
  // 底座
  if (sdRoundRect(x, y, 0.5, 0.67, 0.035, 0.05, 0.005) < 0) return white;
  if (sdRoundRect(x, y, 0.5, 0.72, 0.13, 0.025, 0.025) < 0) return white;
  return blue;
}

function render(size) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
      }
      const i = (py * size + px) * 4;
      if (a) { buf[i] = r / a; buf[i + 1] = g / a; buf[i + 2] = b / a; }
      buf[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, buf);
}

const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), render(512));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(render);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header[e] = s >= 256 ? 0 : s; header[e + 1] = s >= 256 ? 0 : s;
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...pngs]));
fs.writeFileSync(path.join(out, 'tray.png'), render(32));
console.log('icons written');

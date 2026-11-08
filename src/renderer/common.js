// 各页面共用：主题、提示、对话框、图标、格式化。
export const PREFIX = 'cleardesk-';
export const LAN_HOST_ID = 'cleardesk-lan-host';

export const QUALITY = {
  smooth: { label: '流畅', maxBitrate: 1_500_000, maxWidth: 1280, fps: 30, hint: 'motion' },
  balanced: { label: '均衡', maxBitrate: 5_000_000, maxWidth: 1920, fps: 30, hint: 'detail' },
  hd: { label: '高清', maxBitrate: 12_000_000, maxWidth: 0, fps: 60, hint: 'detail' },
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function formatId(id) {
  return String(id || '').replace(/\D/g, '').replace(/(\d{3})(?=\d)/g, '$1 ');
}

export function timeAgo(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return new Date(t).toLocaleDateString();
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' MB';
  return (n / 1024 ** 3).toFixed(2) + ' GB';
}

export async function initTheme(force) {
  const apply = (dark) => (document.documentElement.dataset.theme = force || (dark ? 'dark' : 'light'));
  apply(await window.api.app.dark());
  window.api.app.onDark(apply);
}

let toastHost = null;
export function toast(msg, type = '', ms = 2600) {
  if (!toastHost) {
    toastHost = h('<div class="toast-host"></div>');
    document.body.appendChild(toastHost);
  }
  const el = h(`<div class="toast ${type ? 'toast-' + type : ''}">${esc(msg)}</div>`);
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// 通用对话框：返回点击的按钮 value（关闭为 null）
export function modal({ title, body, buttons = [{ label: '确定', value: true, primary: true }], width = 400, onMount, dismissable = true, enterKey = true }) {
  return new Promise((resolve) => {
    const ov = h(`<div class="modal-overlay"><div class="modal" style="width:${width}px">
      <div class="modal-header"><span>${esc(title)}</span>${dismissable ? '<button class="modal-x" data-x>' + ICONS.x + '</button>' : ''}</div>
      <div class="modal-body"></div>
      <div class="modal-footer"></div></div></div>`);
    const bodyEl = $('.modal-body', ov);
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    const foot = $('.modal-footer', ov);
    const close = (v) => {
      ov.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    for (const b of buttons) {
      const btn = h(`<button class="btn ${b.primary ? 'btn-primary' : ''} ${b.danger ? 'btn-danger' : ''}">${esc(b.label)}</button>`);
      btn.onclick = () => close(b.value);
      foot.appendChild(btn);
    }
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) close(null);
      if (e.key === 'Enter' && !e.isComposing && enterKey) {
        const p = buttons.find((b) => b.primary);
        if (p) {
          e.preventDefault();
          close(p.value);
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const x = $('[data-x]', ov);
    if (x) x.onclick = () => close(null);
    document.body.appendChild(ov);
    if (onMount) onMount(ov, close);
  });
}

export const ICONS = {
  x: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  copy: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 3.2A1.7 1.7 0 0 0 9 2.5H4.2a1.7 1.7 0 0 0-1.7 1.7V9a1.7 1.7 0 0 0 .7 1.4"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3"/><path d="M13.3 2.6v3.2h-3.2"/></svg>',
  eye: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  eyeOff: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2l12 12"/><path d="M6.6 4a6.6 6.6 0 0 1 1.4-.5c4 0 6.5 4.5 6.5 4.5a11.8 11.8 0 0 1-1.9 2.4M4.2 4.9A11.3 11.3 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.7-.6"/></svg>',
  remote: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="3" width="14" height="9.5" rx="2"/><path d="M6.5 15.5h5M9 12.5v3"/></svg>',
  clock: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="9" cy="9" r="6.8"/><path d="M9 5.3V9l2.4 1.6"/></svg>',
  gear: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="9" r="2.4"/><path d="M9 1.8v2M9 14.2v2M16.2 9h-2M3.8 9h-2M14.1 3.9l-1.4 1.4M5.3 12.7l-1.4 1.4M14.1 14.1l-1.4-1.4M5.3 5.3L3.9 3.9" stroke-linecap="round"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="9" cy="9" r="6.8"/><path d="M9 8.2v4.3M9 5.6v.1"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.8 4.3h10.4M6.3 4.3V2.8h3.4v1.5M4.2 4.3l.6 8.6a1.2 1.2 0 0 0 1.2 1.1h4a1.2 1.2 0 0 0 1.2-1.1l.6-8.6"/></svg>',
  lan: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="1.8" width="5" height="3.8" rx="1"/><rect x="1.5" y="10.4" width="5" height="3.8" rx="1"/><rect x="9.5" y="10.4" width="5" height="3.8" rx="1"/><path d="M8 5.6V8M4 10.4V8h8v2.4"/></svg>',
  // 查看窗口工具栏
  fullscreen: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>',
  monitor: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1.6"/><path d="M5.5 13.8h5M8 11v2.8"/></svg>',
  keyboard: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="1.5" y="3.8" width="13" height="8.4" rx="1.8"/><path d="M4.3 6.6h.1M6.8 6.6h.1M9.2 6.6h.1M11.7 6.6h.1M4.3 9.4h.1M11.7 9.4h.1M6.5 9.4h3"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M9.2 1.8H4.3a1.3 1.3 0 0 0-1.3 1.3v9.8a1.3 1.3 0 0 0 1.3 1.3h7.4a1.3 1.3 0 0 0 1.3-1.3V5.6z"/><path d="M9.2 1.8v3.8H13M8 12V8.2M6.3 9.8L8 8.1l1.7 1.7" stroke-linecap="round"/></svg>',
  clip: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="3" y="2.8" width="10" height="11.5" rx="1.6"/><path d="M6 2.8V2a.6.6 0 0 1 .6-.6h2.8A.6.6 0 0 1 10 2v.8a.6.6 0 0 1-.6.6H6.6A.6.6 0 0 1 6 2.8zM5.8 7h4.4M5.8 9.8h3"/></svg>',
  quality: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 13V9.5M6.2 13V6.5M9.8 13V4.5M13.5 13V2.5"/></svg>',
  mouse: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="1.8" width="8" height="12.4" rx="4"/><path d="M8 4.2v2.4" stroke-linecap="round"/></svg>',
  power: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1.8v5.4"/><path d="M4.4 4.1a5.6 5.6 0 1 0 7.2 0"/></svg>',
  fit: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M5 6.5V5h1.5M11 9.5V11H9.5M9.5 5H11v1.5M6.5 11H5V9.5" stroke-linecap="round"/></svg>',
  chevron: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 3.8L5 6.3l2.5-2.5"/></svg>',
};

// 下拉菜单：items = [{ label, value, checked, disabled, sep, hint }]
export function popupMenu(anchor, items, onPick) {
  document.querySelectorAll('.popover[data-menu]').forEach((m) => m.remove());
  const m = h('<div class="popover menu" data-menu></div>');
  for (const it of items) {
    if (it.sep) {
      m.appendChild(h('<div class="menu-sep"></div>'));
      continue;
    }
    if (it.header) {
      m.appendChild(h(`<div class="menu-header">${esc(it.header)}</div>`));
      continue;
    }
    const el = h(`<div class="menu-item ${it.disabled ? 'disabled' : ''}"><span class="menu-icon">${it.checked ? '✓' : ''}</span><span class="menu-label">${esc(it.label)}</span>${it.hint ? `<span class="menu-shortcut">${esc(it.hint)}</span>` : ''}</div>`);
    if (!it.disabled)
      el.onclick = () => {
        m.remove();
        onPick(it.value);
      };
    m.appendChild(el);
  }
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
  m.style.top = r.bottom + 6 + 'px';
  const off = (e) => {
    if (!m.contains(e.target)) {
      m.remove();
      document.removeEventListener('mousedown', off, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off, true));
  return m;
}

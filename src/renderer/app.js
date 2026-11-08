// 主窗口界面：本机识别码/验证码、发起远程控制、最近连接、设置、关于、更新提示。
import { $, $$, h, esc, ICONS, formatId, timeAgo, toast, modal, initTheme, QUALITY } from './common.js';
import { host, startHost, reloadHost, refreshSettings, disconnectSession } from './host.js';

const api = window.api;
let S = null; // 公开设置
let info = null;
let page = 'home';
let showCode = true;
let mode = 'id'; // id | lan
const form = { id: '', ip: '', pwd: '', remember: false };

for (const el of $$('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon];

async function init() {
  await initTheme();
  [S, info] = await Promise.all([api.settings.get(), api.app.info()]);
  for (const b of $$('.nav-item')) b.onclick = () => go(b.dataset.page);
  host.onChange(() => {
    renderSide();
    if (page === 'home') renderHostCard();
  });
  host.askAccept = askAccept;
  host.notify = onHostEvent;
  api.settings.onChanged(async () => {
    S = await api.settings.get();
    if (page === 'home') renderRecentStrip();
    if (page === 'recent') render();
  });
  api.app.onConfirmQuit(async () => {
    const ok = await modal({ title: '退出晴窗远程？', body: '<div class="modal-msg">有设备正在控制本机，退出后连接会断开。</div>', buttons: [{ label: '取消', value: false }, { label: '退出', value: true, primary: true }] });
    if (ok) api.app.quit();
  });
  initUpdate();
  render();
  await startHost();
}

function go(p) {
  page = p;
  for (const b of $$('.nav-item')) b.classList.toggle('active', b.dataset.page === p);
  render();
}

function render() {
  const c = $('#content');
  c.innerHTML = '';
  const fn = { home: renderHome, recent: renderRecent, settings: renderSettings, about: renderAbout }[page];
  c.appendChild(fn());
  if (page === 'home') {
    renderHostCard();
    renderRecentStrip();
  }
}

// —— 侧栏状态 ——
function cloudStatus() {
  const c = host.cloud;
  if (!S.allowControl) return { cls: 'warn', text: '已关闭“允许远程控制本机”' };
  if (c.state === 'online') return { cls: 'ok', text: '已就绪，可以被远程控制' };
  if (c.state === 'connecting') return { cls: 'busy', text: '正在连接服务器…' };
  return { cls: c.state === 'error' ? 'err' : 'warn', text: c.error || '无法连接服务器' };
}

function renderSide() {
  const st = cloudStatus();
  const n = host.sessions().length;
  $('#sideStatus').innerHTML = n ? `<i class="dot busy"></i><span>${n} 个设备正在控制本机</span>` : `<i class="dot ${st.cls}"></i><span>${esc(st.text)}</span>`;
}

// —— 首页 ——
function renderHome() {
  const el = h(`<div class="page">
    <h1 class="page-title">远程控制</h1>
    <p class="page-sub">把识别码和验证码告诉对方，对方就能远程控制这台电脑；输入对方的识别码即可控制对方。</p>
    <div class="grid2">
      <section class="card" id="hostCard"></section>
      <section class="card">
        <h2 class="card-title">远程控制其他设备</h2>
        <div class="seg" id="modeSeg"><button data-m="id">识别码连接</button><button data-m="lan">局域网 IP 直连</button></div>
        <div class="connect-form">
          <input class="input id-input" id="target" autocomplete="off" spellcheck="false" />
          <input class="input" id="pwd" type="password" placeholder="验证码或安全密码" autocomplete="off" />
          <div class="row-between">
            <label class="check"><input type="checkbox" id="remember" />记住密码</label>
            <span class="hint" id="modeHint"></span>
          </div>
          <button class="btn btn-primary" id="connectBtn">远程控制</button>
        </div>
      </section>
    </div>
    <div class="section-head"><h3>最近连接</h3><button class="link-btn" id="allRecent">全部</button></div>
    <div id="recentStrip"></div>
  </div>`);
  const target = $('#target', el);
  const pwd = $('#pwd', el);
  const remember = $('#remember', el);
  const setMode = (m) => {
    mode = m;
    for (const b of $$('#modeSeg button', el)) b.classList.toggle('on', b.dataset.m === m);
    target.value = m === 'id' ? formatId(form.id) : form.ip;
    target.placeholder = m === 'id' ? '伙伴识别码' : '对方的局域网 IP，例如 192.168.1.20';
    target.classList.toggle('id-input', m === 'id');
    $('#modeHint', el).textContent = m === 'id' ? '支持跨网络连接' : '同一局域网，不经过公网';
  };
  for (const b of $$('#modeSeg button', el)) b.onclick = () => setMode(b.dataset.m);
  target.oninput = () => {
    if (mode === 'id') {
      const digits = target.value.replace(/\D/g, '').slice(0, 9);
      form.id = digits;
      const pos = target.selectionStart;
      const before = target.value.length;
      target.value = formatId(digits);
      const d = target.value.length - before;
      target.setSelectionRange(pos + d, pos + d);
    } else form.ip = target.value.trim();
  };
  pwd.value = form.pwd;
  pwd.oninput = () => (form.pwd = pwd.value);
  remember.checked = form.remember;
  remember.onchange = () => (form.remember = remember.checked);
  const submit = () => connect({ mode, target: mode === 'id' ? form.id : form.ip, password: form.pwd, remember: form.remember });
  $('#connectBtn', el).onclick = submit;
  for (const i of [target, pwd]) i.onkeydown = (e) => e.key === 'Enter' && !e.isComposing && submit();
  $('#allRecent', el).onclick = () => go('recent');
  setMode(mode);
  return el;
}

function renderHostCard() {
  const card = $('#hostCard');
  if (!card) return;
  const st = cloudStatus();
  const lanIps = host.lan.state === 'online' ? host.lan.addresses.slice(0, 2).map((a) => a.address) : [];
  const lanLine = S.lanEnabled ? (host.lan.state === 'online' ? `局域网 IP：${lanIps.join('、') || '无'}` : host.lan.error ? `局域网直连不可用：${host.lan.error}` : '') : '';
  card.innerHTML = `
    <h2 class="card-title">允许控制本机</h2>
    <div class="field"><div class="label">本机识别码</div>
      <div class="big-id"><span>${formatId(S.deviceId)}</span><button class="icon-btn" id="copyId" title="复制识别码和验证码">${ICONS.copy}</button></div></div>
    <div class="field"><div class="label">验证码</div>
      <div class="big-code"><span>${showCode ? esc(S.tempCode) : '••••••'}</span>
      <button class="icon-btn" id="toggleCode" title="${showCode ? '隐藏' : '显示'}">${showCode ? ICONS.eyeOff : ICONS.eye}</button>
      <button class="icon-btn" id="refreshCode" title="更换验证码">${ICONS.refresh}</button></div>
      ${S.hasPassword ? '<div class="hint">也可以使用你设置的安全密码连接</div>' : ''}</div>
    <div class="host-status"><i class="dot ${st.cls}"></i><div>${esc(st.text)}${lanLine ? `<div class="lan-ip">${esc(lanLine)}</div>` : ''}</div></div>
    <div class="session-list">${host
      .sessions()
      .map(
        (s) => `<div class="session-item"><i class="dot busy"></i><div class="grow"><b>${esc(s.name)}</b>${s.from ? `（${formatId(s.from)}）` : ''} 正在控制本机</div><button class="btn btn-sm" data-dis="${esc(s.id)}">断开</button></div>`,
      )
      .join('')}</div>`;
  $('#copyId', card).onclick = () => {
    navigator.clipboard.writeText(`晴窗远程 识别码：${formatId(S.deviceId)}  验证码：${S.tempCode}`);
    toast('已复制识别码和验证码', 'success');
  };
  $('#toggleCode', card).onclick = () => {
    showCode = !showCode;
    renderHostCard();
  };
  $('#refreshCode', card).onclick = async () => {
    S.tempCode = await api.settings.refreshCode();
    showCode = true;
    renderHostCard();
    toast('验证码已更换');
  };
  for (const b of $$('[data-dis]', card)) b.onclick = () => disconnectSession(b.dataset.dis);
}

function recentCard(r, compact) {
  const el = h(`<div class="recent-card" role="button" tabindex="0">
    <div class="rc-name">${esc(r.name || (r.mode === 'lan' ? r.target : '远程设备'))}</div>
    <div class="rc-id">${r.mode === 'lan' ? ICONS.lan + esc(r.target) : formatId(r.target)}</div>
    <div class="rc-time">${timeAgo(r.time)}${r.hasPwd ? ' · 已记住密码' : ''}</div>
    ${compact ? '' : ''}<button class="icon-btn rc-del" title="删除">${ICONS.trash}</button></div>`);
  el.onclick = (e) => {
    if (e.target.closest('.rc-del')) return;
    connectRecent(r);
  };
  $('.rc-del', el).onclick = async () => {
    await api.recent.remove(r.key);
    S = await api.settings.get();
    render();
  };
  return el;
}

function renderRecentStrip() {
  const box = $('#recentStrip');
  if (!box) return;
  box.innerHTML = '';
  if (!S.recent.length) {
    box.appendChild(h('<div class="card empty">连接过的设备会出现在这里</div>'));
    return;
  }
  const grid = h('<div class="recent-grid"></div>');
  for (const r of S.recent.slice(0, 4)) grid.appendChild(recentCard(r, true));
  box.appendChild(grid);
}

async function connectRecent(r) {
  const saved = r.hasPwd ? await api.recent.password(r.key) : '';
  if (saved) return connect({ mode: r.mode, target: r.target, password: saved, remember: true, title: r.name });
  // 没记住密码：回到首页填好识别码，聚焦密码框
  mode = r.mode;
  if (r.mode === 'id') form.id = r.target;
  else form.ip = r.target;
  form.pwd = '';
  go('home');
  $('#pwd').focus();
}

async function connect({ mode: m, target, password, remember, title }) {
  target = String(target || '').trim();
  if (m === 'id') {
    if (!/^\d{9}$/.test(target)) return toast('请输入 9 位伙伴识别码', 'error');
    if (target === S.deviceId) return toast('不能连接本机自己', 'error');
  } else if (!/^[\w.:-]+$/.test(target)) return toast('请输入正确的 IP 地址', 'error');
  if (!password) return toast('请输入验证码', 'error');
  await api.viewer.open({ mode: m, target, password, remember, title: title || (m === 'id' ? formatId(target) : target) });
}

// —— 最近连接 ——
function renderRecent() {
  const el = h(`<div class="page"><h1 class="page-title">最近连接</h1><p class="page-sub">点击设备直接连接；记住了密码的设备无需再次输入。</p><div id="recentAll"></div></div>`);
  const box = $('#recentAll', el);
  if (!S.recent.length) box.appendChild(h('<div class="card empty">还没有连接过其他设备</div>'));
  else {
    const grid = h('<div class="recent-grid"></div>');
    for (const r of S.recent) grid.appendChild(recentCard(r));
    box.appendChild(grid);
  }
  return el;
}

// —— 设置 ——
function sw(key, checked) {
  return `<label class="switch"><input type="checkbox" data-sw="${key}" ${checked ? 'checked' : ''} /><i></i></label>`;
}
function seg(key, value, opts) {
  return `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function renderSettings() {
  const el = h(`<div class="page">
    <h1 class="page-title">设置</h1><p class="page-sub">修改会立即生效。</p>
    <div class="set-group-title">安全</div>
    <div class="card set-group">
      <div class="set-row"><div class="set-text"><div class="set-label">允许远程控制本机</div><div class="set-desc">关闭后，任何人都无法连接这台电脑。</div></div>${sw('allowControl', S.allowControl)}</div>
      <div class="set-row"><div class="set-text"><div class="set-label">安全密码</div><div class="set-desc">${S.hasPassword ? '已设置。对方可以用安全密码代替验证码连接，适合无人值守。' : '未设置。设置后可以用固定密码连接，验证码每次启动都会变。'}</div></div>
        <button class="btn btn-sm" id="setPwd">${S.hasPassword ? '修改' : '设置'}</button>${S.hasPassword ? '<button class="btn btn-sm btn-danger" id="clearPwd">清除</button>' : ''}</div>
      <div class="set-row"><div class="set-text"><div class="set-label">连接时需要我确认</div><div class="set-desc">对方输入正确的验证码后，还要你在本机点“接受”。</div></div>${sw('requireConfirm', S.requireConfirm)}</div>
    </div>
    <div class="set-group-title">本机</div>
    <div class="card set-group">
      <div class="set-row"><div class="set-text"><div class="set-label">设备名称</div><div class="set-desc">对方连接时看到的名字。</div></div><input class="input" id="deviceName" maxlength="40" /></div>
      <div class="set-row"><div class="set-text"><div class="set-label">开机自动启动</div><div class="set-desc">开机后在托盘后台运行，随时可被连接。${info.packaged ? '' : '（从源码运行时不生效）'}</div></div>${sw('autoStart', S.autoStart)}</div>
      <div class="set-row"><div class="set-text"><div class="set-label">关闭窗口时最小化到托盘</div><div class="set-desc">关闭后仍可被远程控制；从托盘菜单退出。</div></div>${sw('closeToTray', S.closeToTray)}</div>
    </div>
    <div class="set-group-title">网络</div>
    <div class="card set-group">
      <div class="set-row"><div class="set-text"><div class="set-label">局域网直连</div><div class="set-desc" id="lanDesc"></div></div>
        <input class="input" id="lanPort" style="width:90px" title="端口" />${sw('lanEnabled', S.lanEnabled)}</div>
      <div class="set-row"><div class="set-text"><div class="set-label">信令服务器</div><div class="set-desc">用于识别码寻址。公共服务器开箱即用；也可以用 <code>npm run server</code> 自建。</div></div>
        ${seg('serverMode', S.serverMode, [['cloud', '公共服务器'], ['custom', '自建服务器']])}</div>
      <div class="set-sub" id="customServer" ${S.serverMode === 'custom' ? '' : 'hidden'}>
        <span class="form-label">地址</span><input class="input" id="srvHost" placeholder="例如 remote.example.com" />
        <span class="form-label">端口</span><input class="input" id="srvPort" placeholder="9000" />
        <span class="form-label">路径</span><input class="input" id="srvPath" placeholder="/" />
        <span class="form-label">Key</span><input class="input" id="srvKey" placeholder="cleardesk" />
        <span class="form-label">HTTPS</span><label class="check"><input type="checkbox" id="srvSecure" />使用 wss/https</label>
      </div>
      <div class="set-row"><div class="set-text"><div class="set-label">TURN 中继服务器</div><div class="set-desc">双方都在严格 NAT 后无法直连时，画面经中继转发。留空使用 PeerJS 公共中继。</div></div></div>
      <div class="set-sub">
        <span class="form-label">地址</span><input class="input" id="turnUrls" placeholder="turn:turn.example.com:3478" />
        <span class="form-label">用户名</span><input class="input" id="turnUser" />
        <span class="form-label">密码</span><input class="input" id="turnPwd" type="password" />
        <span></span><div><button class="btn btn-sm btn-primary" id="applyNet">应用网络设置</button></div>
      </div>
    </div>
    <div class="set-group-title">显示</div>
    <div class="card set-group">
      <div class="set-row"><div class="set-text"><div class="set-label">外观</div></div>${seg('theme', S.theme, [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']])}</div>
      <div class="set-row"><div class="set-text"><div class="set-label">默认画质</div><div class="set-desc">远程控制时可以随时在工具栏切换。</div></div>${seg('defaultQuality', S.defaultQuality, Object.entries(QUALITY).map(([k, v]) => [k, v.label]))}</div>
    </div>
    <div class="set-group-title">更新</div>
    <div class="card set-group">
      <div class="set-row"><div class="set-text"><div class="set-label">自动更新</div><div class="set-desc">安装版在后台下载新版本，重启即可完成更新；便携版只提示。</div></div>${sw('autoUpdate', S.autoUpdate)}</div>
      <div class="set-row"><div class="set-text"><div class="set-label">当前版本 ${esc(info.version)}</div><div class="set-desc" id="updDesc">${esc(updateText())}</div></div><button class="btn btn-sm" id="checkUpd">检查更新</button></div>
    </div>
  </div>`);
  const save = async (patch) => {
    S = await api.settings.update(patch);
    refreshSettings(S);
    renderSide();
  };
  for (const i of $$('[data-sw]', el)) i.onchange = () => save({ [i.dataset.sw]: i.checked });
  for (const g of $$('[data-seg]', el))
    for (const b of $$('button', g))
      b.onclick = () => {
        for (const x of $$('button', g)) x.classList.toggle('on', x === b);
        if (g.dataset.seg === 'serverMode') $('#customServer', el).hidden = b.dataset.v !== 'custom';
        else save({ [g.dataset.seg]: b.dataset.v });
      };
  const name = $('#deviceName', el);
  name.value = S.deviceName;
  name.onchange = () => name.value.trim() && save({ deviceName: name.value.trim() });
  const port = $('#lanPort', el);
  port.value = S.lanPort;
  port.onchange = () => {
    const p = parseInt(port.value, 10);
    if (p > 1023 && p < 65536) save({ lanPort: p });
    else port.value = S.lanPort;
  };
  const lanDesc = () => {
    const d = $('#lanDesc', el);
    if (!d) return;
    const l = host.lan;
    d.textContent = !S.lanEnabled ? '已关闭。' : l.state === 'online' ? `已开启，对方输入 ${l.addresses.map((a) => a.address).slice(0, 2).join(' 或 ') || '本机 IP'} 即可直连。` : l.error ? `不可用：${l.error}` : '正在启动…';
  };
  lanDesc();
  const off = host.onChange(lanDesc);
  new MutationObserver((_, o) => !el.isConnected && (off(), o.disconnect())).observe($('#content'), { childList: true });

  $('#srvHost', el).value = S.server.host;
  $('#srvPort', el).value = S.server.port;
  $('#srvPath', el).value = S.server.path;
  $('#srvKey', el).value = S.server.key;
  $('#srvSecure', el).checked = S.server.secure;
  $('#turnUrls', el).value = S.turn.urls;
  $('#turnUser', el).value = S.turn.username;
  $('#turnPwd', el).value = S.turn.credential;
  $('#applyNet', el).onclick = async () => {
    const serverMode = $('[data-seg=serverMode] .on', el).dataset.v;
    const server = { host: $('#srvHost', el).value.trim(), port: parseInt($('#srvPort', el).value, 10) || 9000, path: $('#srvPath', el).value.trim() || '/', key: $('#srvKey', el).value.trim() || 'cleardesk', secure: $('#srvSecure', el).checked };
    if (serverMode === 'custom' && !server.host) return toast('请填写自建服务器地址', 'error');
    await save({ serverMode, server, turn: { urls: $('#turnUrls', el).value.trim(), username: $('#turnUser', el).value.trim(), credential: $('#turnPwd', el).value } });
    await reloadHost();
    toast('网络设置已应用', 'success');
  };
  $('#setPwd', el).onclick = setPassword;
  const clr = $('#clearPwd', el);
  if (clr)
    clr.onclick = async () => {
      await api.settings.setPassword('');
      S = await api.settings.get();
      render();
      toast('已清除安全密码');
    };
  $('#checkUpd', el).onclick = () => api.update.check();
  return el;
}

async function setPassword() {
  const body = h(`<div class="form">
    <div class="form-row"><span class="form-label">新密码</span><input class="input" type="password" id="p1" maxlength="64" /></div>
    <div class="form-row"><span class="form-label">再次输入</span><input class="input" type="password" id="p2" maxlength="64" /></div>
    <div class="hint">至少 8 位，建议字母、数字混合。对方用它可以随时连接本机，请妥善保管。</div></div>`);
  const ok = await modal({ title: '设置安全密码', body, buttons: [{ label: '取消', value: false }, { label: '保存', value: true, primary: true }], onMount: () => $('#p1', body).focus() });
  if (!ok) return;
  const p1 = $('#p1', body).value;
  if (p1.length < 8) return toast('安全密码至少 8 位', 'error');
  if (p1 !== $('#p2', body).value) return toast('两次输入的密码不一致', 'error');
  await api.settings.setPassword(p1);
  S = await api.settings.get();
  render();
  toast('安全密码已保存', 'success');
}

// —— 关于 ——
function renderAbout() {
  const el = h(`<div class="page">
    <div class="card about">
      <img src="../../build/icon.png" alt="" />
      <h2>晴窗远程 ClearDesk</h2>
      <p class="muted">版本 ${esc(info.version)}</p>
      <p>输入识别码和验证码，就能跨网络远程控制另一台电脑。画面和操作点对点加密传输（WebRTC DTLS-SRTP）。</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:16px">
        <button class="btn" id="gh">GitHub 主页</button><button class="btn btn-primary" id="upd">检查更新</button></div>
    </div>
    <div class="feature-list">
      <div class="feature"><b>识别码连接</b><span>9 位识别码 + 验证码，不用配置路由器和端口。</span></div>
      <div class="feature"><b>局域网直连</b><span>同一网络下输入 IP 直连，不经过任何外部服务器。</span></div>
      <div class="feature"><b>键鼠控制</b><span>鼠标、滚轮、键盘、组合键全部映射，失焦时自动松开按键。</span></div>
      <div class="feature"><b>多显示器</b><span>远程切换对方的任意一块屏幕，画质随时调。</span></div>
      <div class="feature"><b>剪贴板 & 文件</b><span>双向同步剪贴板文字，拖拽文件即可发送到对方电脑。</span></div>
      <div class="feature"><b>安全</b><span>验证码每次启动更换，错误 5 次锁定 1 分钟，可要求本机确认。</span></div>
    </div></div>`);
  $('#gh', el).onclick = () => api.app.openExternal('https://github.com/Liyucheng1997/cleardesk');
  $('#upd', el).onclick = () => api.update.check();
  return el;
}

// —— 被控事件 ——
async function askAccept(s) {
  await api.app.showMain();
  const body = h(`<div class="accept-body"><b>${esc(s.name)}</b>${s.from ? `（识别码 ${formatId(s.from)}）` : ''} 请求远程控制这台电脑。<div class="countdown">30 秒后自动拒绝</div></div>`);
  let left = 30;
  let timer;
  return modal({
    title: '远程控制请求',
    body,
    dismissable: false,
    enterKey: false, // 窗口会被拉到前台，防止误按回车就放行
    buttons: [
      { label: '拒绝', value: false },
      { label: '接受', value: true, primary: true },
    ],
    onMount: (_ov, close) => {
      timer = setInterval(() => {
        left--;
        $('.countdown', body).textContent = `${left} 秒后自动拒绝`;
        if (left <= 0 || !s.conn.open) close(false);
      }, 1000);
    },
  }).finally(() => clearInterval(timer));
}

function onHostEvent(ev) {
  if (ev.type === 'connected') toast(`${ev.name} 已连接，正在控制本机`);
  if (ev.type === 'disconnected') toast(`${ev.name} 已断开`);
  if (ev.type === 'file') {
    toast(`收到文件：${ev.name}`, 'success', 4000);
    new Notification('收到文件', { body: `${ev.from} 发来 ${ev.name}，已保存到“下载/ClearDesk 接收”` }).onclick = () => api.file.show(ev.path);
  }
}

// —— 更新 ——
let upd = { state: 'idle' };
let prompted = null;
function updateText() {
  const s = upd;
  return (
    {
      checking: '正在检查更新…',
      none: '已是最新版本',
      downloading: `正在下载 ${s.version || ''}（${s.percent || 0}%）`,
      downloaded: `${s.version} 已下载，重启即可完成更新`,
      available: `发现新版本 ${s.version}`,
      error: s.message ? `检查失败：${s.message}` : '',
    }[s.state] || (info && !info.packaged ? '从源码运行时不检查更新' : '')
  );
}

function updateNotice({ title, message, notes, okText, onOk }) {
  $$('.update-notice').forEach((n) => n.remove());
  const el = h(`<div class="update-notice"><div class="update-notice-title">${esc(title)}</div><div class="update-notice-msg">${esc(message)}</div>
    ${notes ? `<details><summary>更新内容</summary><div class="update-notice-notes">${esc(notes)}</div></details>` : ''}
    <div class="update-notice-actions"><button class="btn btn-sm" data-a="later">稍后</button><button class="btn btn-sm btn-primary" data-a="ok">${esc(okText)}</button></div></div>`);
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  };
  $('[data-a=later]', el).onclick = close;
  $('[data-a=ok]', el).onclick = () => {
    close();
    onOk();
  };
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
}

function onUpdate(s) {
  const prev = upd;
  upd = s;
  const pill = $('#updatePill');
  pill.hidden = !['downloading', 'downloaded', 'available'].includes(s.state);
  pill.className = 'update-pill' + (s.state === 'downloading' ? '' : ' ready');
  pill.textContent = s.state === 'downloading' ? `↓ 正在下载更新 ${s.percent || 0}%` : s.state === 'downloaded' ? '↻ 重启以更新' : `新版本 ${s.version}`;
  pill.onclick = s.state === 'downloaded' ? () => api.update.install() : s.state === 'available' ? () => api.app.openExternal(s.url) : null;
  const d = $('#updDesc');
  if (d) d.textContent = updateText();
  if (s.state === 'downloaded' && (s.manual || prompted !== s.version)) {
    prompted = s.version;
    return updateNotice({ title: `晴窗远程 ${s.version} 已下载`, message: '重启即可完成更新。选择“稍后”也没关系，下次退出时会自动安装。', notes: s.notes, okText: '立即重启', onOk: () => api.update.install() });
  }
  if (s.state === 'available' && (s.manual || prompted !== s.version)) {
    prompted = s.version;
    return updateNotice({ title: `发现新版本 ${s.version}`, message: `当前版本 ${s.current}。便携版无法自动替换自身，请下载新版本，或改用会自动更新的安装版。`, notes: s.notes, okText: '前往下载', onOk: () => api.app.openExternal(s.url) });
  }
  if (!s.manual) return;
  if (s.state === 'checking') toast('正在检查更新…');
  else if (s.state === 'none') toast(`已是最新版本（${s.current}）`, 'success');
  else if (s.state === 'error') toast(`检查更新失败：${s.message}`, 'error', 4000);
  else if (s.state === 'downloading' && prev.state !== 'downloading') toast(`发现新版本 ${s.version}，正在后台下载`);
}

async function initUpdate() {
  api.update.onStatus(onUpdate);
  onUpdate(await api.update.status());
}

init();

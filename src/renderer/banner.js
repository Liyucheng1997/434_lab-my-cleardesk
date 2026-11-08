// 被控提示条：告诉本机用户“谁正在控制这台电脑”，并可一键断开。
import { esc, formatId } from './common.js';

const txt = document.getElementById('txt');
window.api.banner.onSessions((list) => {
  if (list.length === 1) {
    const s = list[0];
    txt.innerHTML = `<b>${esc(s.name)}</b>${s.from ? ` (${formatId(s.from)})` : ''} 正在远程控制本机`;
  } else {
    txt.innerHTML = `<b>${list.length} 个设备</b>正在远程控制本机`;
  }
});
document.getElementById('dis').onclick = () => window.api.banner.disconnect(null);
document.getElementById('show').onclick = () => window.api.banner.showMain();

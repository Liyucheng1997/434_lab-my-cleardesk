# 晴窗远程 ClearDesk

一个类似向日葵的 Windows 远程控制软件：告诉对方**识别码 + 验证码**，就能跨网络远程控制另一台电脑；同一局域网内也可以输入 IP 直连。

画面和操作通过 WebRTC 点对点传输（DTLS-SRTP 加密），服务器只负责“牵线”（信令），不经手画面数据。

## 功能

- **识别码连接**：每台电脑一个固定的 9 位识别码，验证码每次启动更换；也可以设置固定的“安全密码”用于无人值守
- **局域网直连**：内置信令服务（默认端口 21118），同网段输入对方 IP 即可连接，不依赖外网
- **远程控制**：鼠标移动/点击/右键/中键/侧键/滚轮，键盘按键与组合键；窗口失焦时自动松开所有按键，避免对方“卡键”
- **快捷键菜单**：任务管理器、开始菜单、显示桌面、Alt+Tab、Alt+F4、截图、锁定对方电脑、直接输入一段文字（支持中文）
- **多显示器**：远程切换对方任意一块屏幕；画质三档（流畅 / 均衡 / 高清 60 帧）随时切换
- **剪贴板同步**：双方复制的文字自动同步
- **发文件**：拖进远程窗口或点“发文件”，保存到对方的“下载/ClearDesk 接收”；文件走独立通道，不影响操作流畅度
- **安全**：错误验证码 5 次锁定 1 分钟；可开启“连接时需要我确认”；被控时屏幕顶部有提示条，可一键断开
- **状态信息**：直连/中继、延迟、分辨率、帧率、码率实时显示
- **托盘常驻、开机自启、深色模式、自动更新**

## 下载

到 [Releases](https://github.com/Liyucheng1997/434_lab-my-cleardesk/releases) 下载：

- `ClearDesk-Setup-x.y.z.exe`：安装版，**会自动更新**（后台下载，点“立即重启”即完成）
- `ClearDesk-x.y.z-portable.exe`：便携版，免安装；有新版本时只提示，需手动下载

安装包没有代码签名，Windows SmartScreen 可能拦截：点“更多信息 → 仍要运行”。首次启动时 Windows 防火墙会询问是否允许网络访问，请允许（局域网直连需要）。

## 使用

1. 两台电脑都安装并打开晴窗远程。
2. 被控电脑把首页的**本机识别码**和**验证码**告诉对方。
3. 控制方在“远程控制其他设备”里填入识别码和验证码，点“远程控制”。

同一局域网：切到“局域网 IP 直连”，输入对方首页显示的局域网 IP 即可。

## 网络说明

- 默认使用 PeerJS 的公共信令服务器（`0.peerjs.com`）做识别码寻址，开箱即用。
- 双方无法打洞直连时（例如都在严格的对称型 NAT 后），画面会走 TURN 中继。默认用 PeerJS 公共中继，速度不保证；建议自建 [coturn](https://github.com/coturn/coturn) 后在“设置 → 网络 → TURN 中继服务器”中填写。
- 自建信令服务器（推荐长期使用）：在有公网 IP 的服务器上

  ```bash
  git clone https://github.com/Liyucheng1997/434_lab-my-cleardesk && cd 434_lab-my-cleardesk && npm i --omit=dev
  PORT=9000 npm run server
  ```

  然后在两端的“设置 → 网络 → 信令服务器”选“自建服务器”，填写地址和端口（Key 默认 `cleardesk`）。需要 wss 时设置 `SSL_KEY`、`SSL_CERT` 环境变量。

## 已知限制

- 对方电脑处于锁屏界面、UAC 提权弹窗（安全桌面）时无法采集/操作，这是 Windows 的安全限制；可以用“锁定对方电脑”，但不能远程解锁。
- 对方以管理员身份运行的窗口，需要晴窗远程也以管理员身份运行才能操作（Windows UIPI 限制）。
- Ctrl+Alt+Del 无法由普通程序模拟，请用快捷键菜单里的“任务管理器”。
- 暂不传输声音。

## 开发

```bash
npm install
npm start                 # 运行
npm start -- --profile=./tmp/b   # 用独立数据目录再开一个实例（独立识别码），方便本机自测
npm run dist              # 打包安装版 + 便携版到 dist/
```

结构：

- `src/main/` 主进程：窗口与托盘、设置、输入注入（`input.js`，koffi 调用 Win32 SendInput）、局域网信令服务（`lan-server.js`）、自动更新
- `src/renderer/host.js` 被控端：注册识别码、验证、屏幕采集推流、转发输入
- `src/renderer/viewer.js` 控制端：连接、显示画面、采集鼠标键盘、剪贴板与文件
- `server/server.js` 自建信令服务器

### 发布新版本

1. 改 `package.json` 的 `version`
2. `npm run dist`
3. 提交、推送后上传四个文件（`latest.yml` 和 `.blockmap` 是自动更新用的）：

```bash
gh release create v1.0.1 dist/ClearDesk-Setup-1.0.1.exe dist/ClearDesk-Setup-1.0.1.exe.blockmap dist/ClearDesk-1.0.1-portable.exe dist/latest.yml --title "晴窗远程 1.0.1" --notes-file notes.md
```

## 许可

MIT

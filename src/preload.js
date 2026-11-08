// 所有窗口共用的预加载脚本：把主进程能力以 window.api 暴露给页面。
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const on = (ch) => (fn) => {
  const h = (_e, ...args) => fn(...args);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: invoke('settings:get'),
    update: invoke('settings:update'),
    setPassword: invoke('settings:setPassword'),
    refreshCode: invoke('settings:refreshCode'),
    verify: invoke('settings:verify'),
    onChanged: on('settings:changed'),
  },
  recent: { add: invoke('recent:add'), remove: invoke('recent:remove'), password: invoke('recent:password') },
  server: { config: invoke('server:config') },
  screen: { sources: invoke('screen:sources') },
  input: (msg) => ipcRenderer.send('input', msg),
  releaseInput: () => ipcRenderer.send('input:release'),
  lan: { status: invoke('lan:status'), restart: invoke('lan:restart'), onStatus: on('lan:status') },
  viewer: {
    open: invoke('viewer:open'),
    init: invoke('viewer:init'),
    close: invoke('viewer:close'),
    fullscreen: invoke('viewer:fullscreen'),
    title: invoke('viewer:title'),
    resize: invoke('viewer:resize'),
    onCloseRequest: on('viewer:close-request'),
    onFullscreen: on('viewer:fullscreen'),
  },
  host: { sessionsChanged: invoke('session:changed'), onDisconnect: on('host:disconnect') },
  banner: { disconnect: invoke('banner:disconnect'), showMain: invoke('banner:showMain'), onSessions: on('banner:sessions') },
  clipboard: { read: invoke('clipboard:read'), write: invoke('clipboard:write') },
  file: { begin: invoke('file:begin'), chunk: invoke('file:chunk'), end: invoke('file:end'), show: invoke('file:show') },
  app: {
    info: invoke('app:info'),
    openExternal: invoke('app:openExternal'),
    showMain: invoke('app:showMain'),
    quit: invoke('app:quit'),
    dark: invoke('app:dark'),
    onDark: on('theme:dark'),
    onConfirmQuit: on('app:confirm-quit'),
  },
  update: { status: invoke('update:status'), check: invoke('update:check'), install: invoke('update:install'), onStatus: on('update:status') },
});

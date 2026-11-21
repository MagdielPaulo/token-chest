'use strict';
// Token Pirata Overlay: janela separada, sempre por cima, que mostra o contador do squad.
// Não lê nem altera o jogo: só mostra a página /overlay do seu site e registra atalhos de teclado do Windows.
const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, nativeImage, screen, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const PADRAO = {
  site: '',
  opacidade: 0.78,
  tamanho: 'medio',
  atalhos: { bau: 'F7', desfazer: 'F8', fim: 'F9', mostrar: 'F10', mover: 'Ctrl+F10' },
  bounds: null,
};
const ARQ = () => path.join(app.getPath('userData'), 'config.json');
function lerCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(ARQ(), 'utf8'));
    return Object.assign({}, PADRAO, c, { atalhos: Object.assign({}, PADRAO.atalhos, c.atalhos || {}) });
  } catch {
    return JSON.parse(JSON.stringify(PADRAO));
  }
}
function salvarCfg() {
  fs.mkdirSync(path.dirname(ARQ()), { recursive: true });
  fs.writeFileSync(ARQ(), JSON.stringify(cfg, null, 2));
}
const normalizarSite = (s) => {
  let t = String(s || '').trim();
  if (!t) return '';
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  try { const u = new URL(t); return u.origin; } catch { return ''; }
};

// janelas transparentes não podem ser redimensionadas no Windows: o tamanho vem destes presets
const TAMANHOS = { pequeno: { w: 250, h: 290, zoom: 0.85 }, medio: { w: 300, h: 345, zoom: 1 }, grande: { w: 370, h: 425, zoom: 1.25 } };
const tam = () => TAMANHOS[cfg.tamanho] || TAMANHOS.medio;

let cfg;
let win = null;
let setupWin = null;
let tray = null;
let movendo = false;
let falhasAtalhos = [];
let salvarBoundsTimer = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); } else abrirSetup(); });

function avisar(titulo, corpo) {
  if (Notification.isSupported()) new Notification({ title: titulo, body: corpo, silent: true }).show();
}

function criarOverlay() {
  if (win && !win.isDestroyed()) win.destroy();
  const area = screen.getPrimaryDisplay().workArea;
  const t = tam();
  const pos = cfg.bounds || { x: area.x + 16, y: area.y + Math.round(area.height * 0.25) };
  win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: t.w,
    height: t.h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    title: 'Token Pirata Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  const url = `${cfg.site}/overlay?opac=${cfg.opacidade}`;
  win.loadURL(url);
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(tam().zoom));
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.on('did-fail-load', () => avisar('Overlay', 'Não consegui abrir ' + cfg.site + '/overlay. Confira o endereço do site em Configurar.'));
  // só deixa navegar dentro do seu site
  win.webContents.on('will-navigate', (e, destino) => { if (new URL(destino).origin !== cfg.site) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:\/\//.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  const guardar = () => {
    clearTimeout(salvarBoundsTimer);
    salvarBoundsTimer = setTimeout(() => { if (win && !win.isDestroyed()) { const b = win.getBounds(); cfg.bounds = { x: b.x, y: b.y }; salvarCfg(); } }, 400);
  };
  win.on('moved', guardar);
  movendo = false;
}

function setMover(on) {
  if (!win || win.isDestroyed()) return;
  movendo = on;
  win.setIgnoreMouseEvents(!on);
  win.setFocusable(on);
  if (on) { win.showInactive(); win.focus(); } else win.blur();
  win.webContents.send('tp-mover', on);
  atualizarMenu();
}

function alternarMostrar() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) { if (movendo) setMover(false); win.hide(); } else win.showInactive();
  atualizarMenu();
}

function enviar(acao) {
  if (win && !win.isDestroyed()) win.webContents.send('tp-atalho', acao);
}

function registrarAtalhos() {
  globalShortcut.unregisterAll();
  falhasAtalhos = [];
  const reg = (acc, fn) => {
    if (!acc) return;
    try { if (!globalShortcut.register(acc, fn)) falhasAtalhos.push(acc); } catch { falhasAtalhos.push(acc); }
  };
  reg(cfg.atalhos.bau, () => enviar('bau'));
  reg(cfg.atalhos.desfazer, () => enviar('desfazer'));
  reg(cfg.atalhos.fim, () => enviar('fim'));
  reg(cfg.atalhos.mostrar, alternarMostrar);
  reg(cfg.atalhos.mover, () => setMover(!movendo));
  if (falhasAtalhos.length) avisar('Atalhos', 'Não consegui usar: ' + falhasAtalhos.join(', ') + '. Outro programa já usa essa tecla. Troque em Configurar.');
}

function atualizarMenu() {
  if (!tray) return;
  const a = cfg.atalhos;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Mostrar / ocultar overlay (${a.mostrar})`, click: alternarMostrar, enabled: !!win },
    { label: movendo ? `Terminar de mover (${a.mover})` : `Mover a janela (${a.mover})`, click: () => setMover(!movendo), enabled: !!win },
    { label: 'Tamanho', submenu: Object.keys(TAMANHOS).map((k) => ({ label: { pequeno: 'Pequeno', medio: 'Médio', grande: 'Grande' }[k], type: 'radio', checked: (cfg.tamanho || 'medio') === k, click: () => { cfg.tamanho = k; salvarCfg(); if (win && !win.isDestroyed()) { const t = tam(); win.setResizable(true); win.setSize(t.w, t.h); win.setResizable(false); win.webContents.setZoomFactor(t.zoom); } } })) },
    { type: 'separator' },
    { label: 'Configurar…', click: abrirSetup },
    { label: 'Abrir o contador no navegador', click: () => cfg.site && shell.openExternal(cfg.site + '/contador'), enabled: !!cfg.site },
    { label: 'Voltar a janela para a posição inicial', click: () => { cfg.bounds = null; salvarCfg(); if (cfg.site) criarOverlay(); } },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]));
}

function abrirSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 460,
    height: 640,
    resizable: false,
    title: 'Token Pirata Overlay · Configurar',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-setup.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  setupWin.loadFile(path.join(__dirname, 'setup.html'));
  setupWin.on('closed', () => { setupWin = null; if (!cfg.site) app.quit(); });
}

ipcMain.handle('tp-cfg-ler', () => ({ ...cfg, falhas: falhasAtalhos }));
ipcMain.handle('tp-cfg-salvar', (_e, novo) => {
  const site = normalizarSite(novo.site);
  if (!site) return { ok: false, erro: 'Endereço do site inválido.' };
  cfg.site = site;
  const op = Number(novo.opacidade);
  cfg.opacidade = op >= 0.3 && op <= 1 ? op : PADRAO.opacidade;
  cfg.atalhos = Object.assign({}, PADRAO.atalhos, novo.atalhos || {});
  salvarCfg();
  registrarAtalhos();
  criarOverlay();
  atualizarMenu();
  return { ok: true, falhas: falhasAtalhos };
});
ipcMain.handle('tp-atalhos', () => cfg.atalhos);

if (process.platform === 'win32') app.setAppUserModelId('app.tokenpirata.overlay');

app.whenReady().then(() => {
  cfg = lerCfg();
  const icone = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icone);
  tray.setToolTip('Token Pirata Overlay');
  tray.on('click', alternarMostrar);
  atualizarMenu();
  if (cfg.site) {
    registrarAtalhos();
    criarOverlay();
    atualizarMenu();
  } else {
    abrirSetup();
  }
});

app.on('window-all-closed', (e) => { /* fica rodando na bandeja */ });
app.on('will-quit', () => globalShortcut.unregisterAll());

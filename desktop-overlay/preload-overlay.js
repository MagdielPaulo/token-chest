'use strict';
// Liga os atalhos do app à página /overlay do site. Não dá acesso a nada do computador.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tpDesktop', {
  onAtalho: (fn) => ipcRenderer.on('tp-atalho', (_e, acao) => fn(acao)),
  onMover: (fn) => ipcRenderer.on('tp-mover', (_e, on) => fn(on)),
  atalhos: () => ipcRenderer.invoke('tp-atalhos'),
});

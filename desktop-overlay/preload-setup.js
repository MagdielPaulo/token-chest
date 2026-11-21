'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tpSetup', {
  ler: () => ipcRenderer.invoke('tp-cfg-ler'),
  salvar: (c) => ipcRenderer.invoke('tp-cfg-salvar', c),
});

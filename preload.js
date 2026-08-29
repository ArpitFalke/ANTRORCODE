/* ANTROR Code — preload: the only bridge between the app and this computer. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('antrorAPI', {
  isDesktop: true,
  /* run a real command — the main process shows the permission dialog */
  runCommand: (cmd) => ipcRenderer.invoke('antror:runCommand', cmd),
  /* save a project's files to the workspace folder */
  writeProject: (name, files) => ipcRenderer.invoke('antror:writeProject', name, files),
  getWorkspace: () => ipcRenderer.invoke('antror:getWorkspace'),
  chooseWorkspace: () => ipcRenderer.invoke('antror:chooseWorkspace'),
});

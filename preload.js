const { ipcRenderer } = require('electron');

// При contextIsolation: false используем прямое присваивание
window.electronAPI = {
  openFileDialog: () => ipcRenderer.send('open-file-dialog'),
  onOpenFile: (callback) => ipcRenderer.on('open-file', (event, filePath) => callback(filePath)),
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
  loadSettings: () => ipcRenderer.send('load-settings'),
  onSettingsLoaded: (callback) => ipcRenderer.on('settings-loaded', (event, settings) => callback(settings)),
  showContextMenu: (position) => ipcRenderer.send('show-context-menu', position),
  onShowSettings: (callback) => ipcRenderer.on('show-settings', callback),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  getFolderStlFiles: (filePath) => ipcRenderer.invoke('get-folder-stl-files', filePath),
  selectSlicerDialog: () => ipcRenderer.invoke('select-slicer-dialog'),
  launchSlicer: (payload) => ipcRenderer.invoke('launch-slicer', payload),
  trashFile: (filePath) => ipcRenderer.invoke('trash-file', filePath),
  exitApp: () => ipcRenderer.send('exit-app'),
};

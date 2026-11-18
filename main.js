const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    title: 'ViverSTL',
    icon: path.join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
    },
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hidden',
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('second-instance', (event, argv, cwd) => {
    const stlFile = findStlFileInArgs(argv);
    if (stlFile && mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.webContents.send('open-file', stlFile);
      mainWindow.focus();
    }
  });
}

function findStlFileInArgs(argv) {
  for (const arg of argv) {
    if (arg.toLowerCase().endsWith('.stl')) {
      return arg;
    }
  }
  return null;
}

app.whenReady().then(() => {
  createWindow();

  const stlFile = findStlFileInArgs(process.argv);
  if (stlFile && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('open-file', stlFile);
    });
  }


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  createContextMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('open-file-dialog', (event) => {
  dialog
    .showOpenDialog(mainWindow, {
      title: 'Выберите STL файл',
      filters: [{ name: 'STL files', extensions: ['stl'] }],
      properties: ['openFile'],
    })
    .then((result) => {
      if (!result.canceled && result.filePaths.length > 0) {
        event.reply('open-file', result.filePaths[0]);
      }
    })
    .catch((err) => console.error(err));
});

ipcMain.on('save-settings', (event, settings) => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  fs.writeFile(settingsPath, JSON.stringify(settings), (err) => {
    if (err) console.error('Failed to save settings:', err);
  });
});

ipcMain.on('load-settings', (event) => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  fs.readFile(settingsPath, 'utf8', (err, data) => {
    if (!err) {
      try {
        event.reply('settings-loaded', JSON.parse(data));
      } catch (e) {
        console.error('Failed to parse settings:', e);
      }
    }
  });
});

ipcMain.on('show-context-menu', (event, position) => {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Открыть STL файл',
      click: () => {
        mainWindow.webContents.send('open-file-dialog');
      },
    },
    {
      label: 'Настройки',
      click: () => {
        mainWindow.webContents.send('show-settings');
      },
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        app.quit();
      },
    },
  ]);
  menu.popup(mainWindow, position);
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

// Получение списка STL файлов в папке текущего файла
ipcMain.handle('get-folder-stl-files', async (event, currentFilePath) => {
  try {
    const dir = path.dirname(currentFilePath);
    const entries = await fs.promises.readdir(dir);
    return entries
      .filter((name) => name.toLowerCase().endsWith('.stl'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .map((name) => path.join(dir, name));
  } catch (err) {
    console.error('Ошибка чтения папки:', err);
    return [];
  }
});

// Диалог выбора исполняемого файла или ярлыка слайсера
ipcMain.handle('select-slicer-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Укажите путь к слайсеру (.exe или ярлык .lnk)',
    filters: [
      { name: 'Программы и ярлыки', extensions: ['exe', 'lnk'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Отправка STL-файла в корзину Windows
ipcMain.handle('trash-file', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return { status: 'not-found' };
  }
  try {
    await shell.trashItem(filePath);
    return { status: 'ok' };
  } catch (err) {
    console.error('Ошибка удаления в корзину:', err);
    return { status: 'error', message: err.message };
  }
});

// Запуск выбранного слайсера с передачей пути к STL-файлу
ipcMain.handle('launch-slicer', async (event, { slicerPath, stlPath }) => {
  if (!stlPath || !fs.existsSync(stlPath)) {
    return { status: 'no-stl' };
  }

  // Проверяем, существует ли слайсер по сохранённому пути
  if (!slicerPath || !fs.existsSync(slicerPath)) {
    return { status: 'missing-slicer' };
  }

  try {
    let targetExe = slicerPath;

    // Если пользователь указал ярлык (.lnk), извлекаем из него реальный путь к .exe
    if (slicerPath.toLowerCase().endsWith('.lnk')) {
      const shortcutInfo = shell.readShortcutLink(slicerPath);
      if (shortcutInfo && shortcutInfo.target && fs.existsSync(shortcutInfo.target)) {
        targetExe = shortcutInfo.target;
      } else {
        return { status: 'missing-slicer' };
      }
    }

    const child = spawn(targetExe, [stlPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return { status: 'ok' };
  } catch (err) {
    console.error('Ошибка запуска слайсера:', err);
    return { status: 'error', message: err.message };
  }
});


ipcMain.on('exit-app', () => {
  app.quit();
});


function createContextMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'ViverSTL',
      submenu: [
        {
          label: 'Открыть STL...',
          accelerator: 'Ctrl+O',
          click: () => {
            mainWindow.webContents.send('open-file-dialog');
          },
        },
        { type: 'separator' },
        {
          label: 'Настройки',
          click: () => {
            mainWindow.webContents.send('show-settings');
          },
        },
        { type: 'separator' },
        {
          label: 'Выйти',
          accelerator: 'Ctrl+Q',
          click: () => app.quit(),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}
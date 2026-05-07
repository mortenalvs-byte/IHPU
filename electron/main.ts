import { app, BrowserWindow } from 'electron';
import * as path from 'path';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
// IHPU_FORCE_PROD=1 forces file:// load of dist/index.html even when not packaged.
// Used by tests/smoke/electron.spec.ts so Playwright can verify the production bundle
// without first having to start a Vite dev server.
const FORCE_PROD = process.env.IHPU_FORCE_PROD === '1';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'IHPU TrykkAnalyse',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  const useDev = !app.isPackaged && !FORCE_PROD;
  if (useDev) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

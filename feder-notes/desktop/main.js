// Feder Notes – Windows-App (Electron)
'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB = path.resolve(__dirname, '..');
// Nur diese Dateien/Ordner der App werden ausgeliefert
const ALLOWED = /^\/(index\.html|manifest\.webmanifest|(css|js|vendor|icons)\/[\w.\-/]+)$/;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Nur eine Instanz (zweiter Start holt das vorhandene Fenster nach vorn)
if (!app.requestSingleInstanceLock()) app.quit();

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1300, height: 880, minWidth: 420, minHeight: 500,
    title: 'Feder Notes',
    icon: path.join(WEB, 'icons', 'icon-512.png'),
    backgroundColor: '#f6f5f2',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  win.webContents.session.setSpellCheckerLanguages(['de-DE', 'en-US']);
  win.loadURL('app://feder/index.html');
  // Links im Standardbrowser öffnen, nie im App-Fenster navigieren
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://feder/')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const p = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    if (!ALLOWED.test(p) || p.includes('..')) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(WEB, p)).toString());
  });

  // HTTP für den Nextcloud-Sync – läuft im Hauptprozess, daher keine Browser-CORS-Sperre
  ipcMain.handle('http', async (_e, { method, url, headers, body }) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Ungültige Adresse');
    const res = await fetch(url, { method, headers, body: body == null ? undefined : body, redirect: 'follow' });
    const h = {};
    res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
    return { status: res.status, headers: h, text: await res.text() };
  });

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

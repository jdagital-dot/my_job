const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const isDev = !app.isPackaged

  const win = new BrowserWindow({
    width: 360,
    height: 560,
    alwaysOnTop: false,
    titleBarStyle: 'hiddenInset',
    resizable: true,
    minWidth: 280,
    minHeight: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  // Google OAuth をブロックされないよう User-Agent から "Electron" を除去
  const ua = win.webContents.getUserAgent().replace(/ Electron\/[\d.]+/, '')
  win.webContents.setUserAgent(ua)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

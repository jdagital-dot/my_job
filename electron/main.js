const { app, BrowserWindow, dialog } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')

const PROD_PORT = 4173

function startLocalServer(distDir) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // パストラバーサル対策: URLを正規化してdistDir外へのアクセスを禁止
      const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0]
      const safePath = path.resolve(distDir, '.' + urlPath)
      if (!safePath.startsWith(distDir + path.sep) && safePath !== distDir) {
        res.writeHead(403); res.end('Forbidden'); return
      }
      let filePath = fs.existsSync(safePath) ? safePath : path.join(distDir, 'index.html')
      const ext = path.extname(filePath)
      const contentType = mimeTypes[ext] || 'application/octet-stream'
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return }
        res.writeHead(200, { 'Content-Type': contentType })
        res.end(data)
      })
    })
    server.on('error', (err) => reject(err))
    server.listen(PROD_PORT, '127.0.0.1', () => resolve(server))
  })
}

async function createWindow() {
  const isDev = !app.isPackaged

  let port = PROD_PORT
  if (!isDev) {
    const distDir = path.join(__dirname, '../dist')
    try {
      await startLocalServer(distDir)
    } catch (err) {
      dialog.showErrorBox(
        'QuickMemo 起動エラー',
        `ポート ${PROD_PORT} が使用中のため起動できませんでした。\n他のアプリを終了してから再起動してください。\n\n詳細: ${err.message}`
      )
      app.quit()
      return
    }
  }

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
      nodeIntegration: false,
    },
  })

  // Google OAuth をブロックされないよう User-Agent から "Electron" を除去
  const ua = win.webContents.getUserAgent().replace(/ Electron\/[\d.]+/, '')
  win.webContents.setUserAgent(ua)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadURL(`http://localhost:${port}`)
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

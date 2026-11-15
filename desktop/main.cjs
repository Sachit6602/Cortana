/**
 * Cortana overlay shell.
 *
 * A transparent, frameless, always-on-top bar summoned by a global chord. It
 * renders the same Vite bundle the browser does (with ?overlay), so chat,
 * voice, and screen capture live in one place; this process owns only window
 * behaviour, the chord, the tray, and screen capture.
 */
const {
  app, BrowserWindow, globalShortcut, screen, ipcMain, desktopCapturer,
  Tray, Menu, nativeImage, shell, session,
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { startServer } = require('./server.cjs')
const http = require('node:http')

const TOGGLE_CHORD = process.env.CORTANA_CHORD || 'CommandOrControl+Shift+Space'
const FULL_CHORD = process.env.CORTANA_FULL_CHORD || 'CommandOrControl+Shift+G'

// Dev: point at the Vite server and manage nothing. Standalone: serve the
// built bundle and own the tunnel, so the app works from a cold boot.
const DEV_URL = process.env.CORTANA_DEV_URL
const ROOT = path.join(__dirname, '..')

/** Reuse the same .env.local the dev server reads — one source of truth. */
function readEnvLocal() {
  const out = {}
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].trim()
    }
  } catch { /* fall back to defaults below */ }
  return out
}

const ENV = readEnvLocal()
const API = new URL(ENV.HERMES_API || 'http://127.0.0.1:9500')
const TOKEN = ENV.HERMES_TOKEN || ''
const SSH_HOST = ENV.CORTANA_SSH_HOST || 'cortana'


/** Wait (briefly) for the forwarded API to answer, so the first load isn't a
 *  race against ssh finishing its handshake. The renderer retries anyway;
 *  this just avoids a "failed" flash on every cold start. */
function waitForApi(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.request(
        { host: API.hostname, port: Number(API.port), path: '/api/health', method: 'GET', timeout: 2000 },
        (res) => { res.resume(); resolve(true) },
      )
      req.on('error', () => (Date.now() > deadline ? resolve(false) : setTimeout(tick, 600)))
      req.on('timeout', () => { req.destroy(); Date.now() > deadline ? resolve(false) : setTimeout(tick, 600) })
      req.end()
    }
    tick()
  })
}

let tunnel = null
let tunnelRetry = null

/**
 * Keep an SSH port-forward to the VPS alive. The forward terminates on the
 * VPS's own loopback, so its firewall stays closed to the world.
 */
function startTunnel() {
  if (DEV_URL) return
  const args = ['-N', '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30',
                '-o', 'ExitOnForwardFailure=yes',
                '-L', `${API.port}:127.0.0.1:${API.port}`, SSH_HOST]
  tunnel = spawn('ssh', args, { stdio: 'ignore', windowsHide: true })

  tunnel.on('exit', () => {
    tunnel = null
    if (app.isQuitting) return
    // Laptop sleep and network changes kill this routinely; just come back.
    clearTimeout(tunnelRetry)
    tunnelRetry = setTimeout(startTunnel, 5000)
  })
  tunnel.on('error', () => { tunnel = null })
}

// The renderer drives the size: it starts as a small orb and grows into the
// bar + answers, so main just follows what the page measures.
const ORB_W = 240
const ORB_H = 210
const FULL_W = 760
const TOP_MARGIN = 0           // flush with the top edge of the screen

let win = null        // the summoned overlay bar
let full = null       // the full window (chat + status tabs)
let tray = null
let appUrl = null     // set once the server (or dev server) is known

// When pinned the overlay ignores blur, so it stays put while you work in
// another app. Lives in main because the blur handler is here.
let pinned = false

let recording = false   // mirrored from the renderer so the chord can act on it

// Once you drag the bar it stays where you put it — but only for this run.
// A fresh launch starts at the top again, which is the "default" people
// expect from a summoned bar.
let userMoved = false
let placing = false   // guards our own setBounds from looking like a drag

function createWindow() {
  win = new BrowserWindow({
    width: ORB_W,
    height: ORB_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Hide instead of close: the WebSocket session and conversation survive
  // between summons. Reconnecting each time would lose the thread.
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  // Distinguish a real drag from our own repositioning.
  win.on('moved', () => { if (!placing) userMoved = true })

  win.on('blur', () => {
    if (pinned) return
    if (!win.webContents.isDevToolsOpened()) win.hide()
  })

  win.webContents.setWindowOpenHandler(openLink)
}

// Links open in the real browser, never inside the app — and only web links:
// openExternal will launch any registered protocol handler it's handed.
function openLink({ url }) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  return { action: 'deny' }
}

/**
 * Size to what the renderer measured. Keeps a dragged position; otherwise
 * centres horizontally at the very top of the active display. Growing keeps
 * the top edge fixed so answers expand downward rather than shoving the bar
 * up the screen.
 */
function position(width, height) {
  const cur = win.getBounds()
  const anchor = userMoved ? { x: cur.x, y: cur.y } : screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(anchor)

  const w = Math.round(width || cur.width)
  let x
  let y

  if (userMoved) {
    // Grow around the window's own centre so it doesn't crawl sideways.
    x = Math.round(cur.x + (cur.width - w) / 2)
    y = cur.y
  } else {
    x = Math.round(workArea.x + (workArea.width - w) / 2)
    y = workArea.y + TOP_MARGIN
  }

  const maxH = workArea.y + workArea.height - y - 12
  const h = Math.max(80, Math.min(Math.round(height), Math.max(80, maxH)))

  x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - w)
  y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - h)

  placing = true
  win.setBounds({ x, y, width: w, height: h })
  placing = false
}


/** The full window: normal chrome, taskbar entry, tabs. Same bundle, no
 *  ?overlay flag, so it renders <App/> instead of the bar. */
function openFull() {
  if (full && !full.isDestroyed()) {
    if (full.isMinimized()) full.restore()
    full.show()
    full.focus()
    return
  }

  full = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 620,
    minHeight: 480,
    show: false,
    title: 'Cortana',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  full.removeMenu()
  full.loadURL(appUrl)
  full.once('ready-to-show', () => full.show())
  full.on('closed', () => { full = null })
  full.webContents.setWindowOpenHandler(openLink)
}

/**
 * The chord is the push-to-talk button:
 *   hidden           -> show and start listening immediately
 *   visible, live    -> stop, transcribe, send (window stays up for the answer)
 *   visible, idle    -> dismiss
 */
function toggle() {
  if (!win) return

  if (!win.isVisible()) {
    const b = win.getBounds()
    position(b.width || ORB_W, b.height || ORB_H)
    win.show()
    win.focus()
    win.webContents.send('cortana:summon')
    return
  }

  if (recording) {
    win.webContents.send('cortana:stop-send')
    return
  }

  win.hide()
}

// A second launch (login item + manual start) would fight over the global
// chord and the tunnel port. Hand the summon to the running instance instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => toggle())
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'audioCapture')
  })

  createWindow()

  if (DEV_URL) {
    appUrl = DEV_URL
    win.loadURL(`${appUrl}?overlay`)
  } else {
    startTunnel()
    await waitForApi()
    const srv = await startServer({
      distDir: path.join(ROOT, 'dist'),
      apiHost: API.hostname,
      apiPort: Number(API.port),
      token: TOKEN,
    })
    appUrl = `http://127.0.0.1:${srv.port}/`
    win.loadURL(`${appUrl}?overlay`)
  }

  if (!globalShortcut.register(TOGGLE_CHORD, toggle)) {
    // Never fail silently — a dead chord looks identical to a broken app.
    console.error(`[cortana] could not register ${TOGGLE_CHORD} — another app owns it`)
  }
  if (!globalShortcut.register(FULL_CHORD, openFull)) {
    console.error(`[cortana] could not register ${FULL_CHORD} — another app owns it`)
  }

  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'))
  tray = new Tray(icon)
  tray.setToolTip(`Cortana — ${TOGGLE_CHORD}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Show / hide bar  (${TOGGLE_CHORD})`, click: toggle },
      { label: `Open full window  (${FULL_CHORD})`, click: openFull },
      { type: 'separator' },
      {
        label: 'Keep bar on screen',
        type: 'checkbox',
        checked: pinned,
        click: (item) => setPinned(item.checked),
      },
      {
        label: 'Reset bar position',
        click: () => {
          userMoved = false
          if (win?.isVisible()) {
            const b = win.getBounds()
            position(b.width, b.height)
          }
        },
      },
      { type: 'separator' },
      { label: 'Quit Cortana', click: () => { app.isQuitting = true; app.quit() } },
    ]),
  )
  tray.on('click', toggle)
})

// Renderer measured its content; grow/shrink the OS window to match.
ipcMain.on('cortana:resize', (_e, size) => {
  if (!win || !win.isVisible()) return
  const wide = Boolean(size?.wide)
  const w = wide ? FULL_W : ORB_W
  const h = Math.round(Number(size?.height) || ORB_H)
  const b = win.getBounds()
  if (Math.abs(b.height - h) > 2 || b.width !== w) position(w, h)
})

ipcMain.on('cortana:hide', () => { if (!pinned) win?.hide() })

function setPinned(v) {
  pinned = Boolean(v)
  // Tell the bar so its pin button matches the tray checkbox.
  win?.webContents.send('cortana:pinned', pinned)
}
ipcMain.on('cortana:pin', (_e, v) => setPinned(v))
ipcMain.on('cortana:open-full', () => openFull())
ipcMain.on('cortana:recording', (_e, v) => { recording = Boolean(v) })

ipcMain.handle('cortana:capture-screen', async () => {
  // Hide first, or the overlay appears in its own screenshot.
  const wasVisible = win?.isVisible()
  if (wasVisible) win.hide()
  await new Promise((r) => setTimeout(r, 180))

  try {
    // The screen you're on (where you clicked), not whichever comes first.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { size, scaleFactor } = display
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(size.width * scaleFactor),
        height: Math.round(size.height * scaleFactor),
      },
    })
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!src) throw new Error('no screen sources available')
    return src.thumbnail.toDataURL()
  } finally {
    if (wasVisible) { win.show(); win.focus() }
  }
})

app.on('window-all-closed', (e) => e.preventDefault())
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  clearTimeout(tunnelRetry)
  tunnel?.kill()
})

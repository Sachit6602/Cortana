/**
 * Standalone host for the built UI.
 *
 * Replaces the Vite dev server when the app runs on its own: serves ../dist
 * and proxies /api to Hermes, adding the session token. Doing it here rather
 * than in the renderer keeps the token out of page JS and means src/ can keep
 * using relative URLs — the React code is identical under dev and production.
 */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { URL } = require('node:url')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

function serveStatic(distDir, req, res) {
  const urlPath = new URL(req.url, 'http://localhost').pathname
  // Unknown paths fall back to index.html (SPA), but never escape distDir.
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  let file = path.resolve(distDir, rel)
  if (!file.startsWith(path.resolve(distDir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(distDir, 'index.html')
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

/** @returns {Promise<{port:number, close:()=>void}>} */
function startServer({ distDir, apiHost, apiPort, token }) {
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith('/api')) return serveStatic(distDir, req, res)

    const upstream = http.request(
      {
        host: apiHost,
        port: apiPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `${apiHost}:${apiPort}`, 'x-hermes-session-token': token },
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `upstream: ${e.message}` }))
    })
    req.pipe(upstream)
  })

  // WebSocket upgrade: /api/ws takes auth as a query param, not a header.
  server.on('upgrade', (req, socket, head) => {
    const sep = req.url.includes('?') ? '&' : '?'
    const upstream = http.request({
      host: apiHost,
      port: apiPort,
      path: `${req.url}${sep}token=${encodeURIComponent(token)}`,
      headers: { ...req.headers, host: `${apiHost}:${apiPort}` },
      method: 'GET',
    })
    upstream.end()

    upstream.on('upgrade', (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 101 ${upRes.statusMessage || 'Switching Protocols'}`]
      for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
        lines.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`)
      }
      socket.write(lines.join('\r\n') + '\r\n\r\n')
      if (upHead?.length) socket.unshift(upHead)
      upSocket.pipe(socket).pipe(upSocket)
      upSocket.on('error', () => socket.destroy())
      socket.on('error', () => upSocket.destroy())
    })
    upstream.on('response', () => socket.destroy())   // upstream refused the upgrade
    upstream.on('error', () => socket.destroy())
    if (head?.length) upstream.write(head)
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() })
    })
  })
}

module.exports = { startServer }

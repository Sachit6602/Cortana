/**
 * Launch Electron with a clean environment.
 *
 * VS Code's integrated terminal exports ELECTRON_RUN_AS_NODE=1, which any
 * child Electron inherits — it then boots as plain Node, `require('electron')`
 * yields a path string instead of the API, and you get
 * "Cannot read properties of undefined (reading 'whenReady')".
 * Stripping it here means `npm start` works from any shell.
 */
const { spawn } = require('node:child_process')
const electron = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, [__dirname, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
})

child.on('close', (code) => process.exit(code ?? 0))

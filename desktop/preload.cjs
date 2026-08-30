const { contextBridge, ipcRenderer } = require('electron')

const on = (channel, fn) => {
  const h = (_e, v) => fn(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

// The only surface the page gets. No node, no raw ipcRenderer.
contextBridge.exposeInMainWorld('cortana', {
  isDesktop: true,
  captureScreen: () => ipcRenderer.invoke('cortana:capture-screen'),
  resize: (size) => ipcRenderer.send('cortana:resize', size),
  hide: () => ipcRenderer.send('cortana:hide'),
  setPinned: (v) => ipcRenderer.send('cortana:pin', Boolean(v)),
  openFull: () => ipcRenderer.send('cortana:open-full'),
  // Let main act on mic state from the global chord.
  setRecording: (v) => ipcRenderer.send('cortana:recording', Boolean(v)),
  onPinned: (fn) => on('cortana:pinned', fn),
  onSummon: (fn) => on('cortana:summon', fn),
  onStopSend: (fn) => on('cortana:stop-send', fn),
})

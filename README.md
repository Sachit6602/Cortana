# Cortana UI

Personal chat + push-to-talk voice front-end for Hermes, talking to the agent
running on the VPS. Lives outside the Hermes install, so `hermes update` can
never stash or overwrite it.

## Run — three things, in order

**1. Backend on the VPS** (already running as a detached process; only needed
after a reboot):

```bash
ssh cortana
cd ~/.hermes/hermes-agent
HERMES_DASHBOARD_SESSION_TOKEN=<your-token> \
  setsid nohup ./venv/bin/hermes serve --port 9500 </dev/null >/tmp/serve.log 2>&1 &
```

**2. SSH tunnel** — the VPS firewall allows only SSH, so the API is reached
through a forward rather than an open port. Leave this running:

```bash
ssh -N -L 9500:127.0.0.1:9500 cortana
```

**3. This app:**

```bash
npm run dev
```

Open http://127.0.0.1:5180

## How auth works

`vite.config.ts` proxies to the tunnel and supplies the token two different
ways, because Hermes wants it differently per transport:

- **HTTP** — `X-Hermes-Session-Token` header, stamped in `proxyReq`
- **WebSocket** — `?token=` query param, added by `rewrite` (the `/api/ws`
  endpoint accepts no header auth)

Either way the token stays on the Vite dev server and never reaches the
browser. It lives in `.env.local` (gitignored) and must match the
`HERMES_DASHBOARD_SESSION_TOKEN` the backend was started with.

## Protocol

Newline-delimited JSON-RPC over `/api/ws` (`src/gateway.ts`, ~140 lines, no
dependency on Hermes's workspace packages):

```
request   { id, method, params }
response  { id, result } | { id, error }
event     { method: "event", params: { type, payload, session_id, seq } }
```

Used: `session.create`, `prompt.submit {session_id, text}`; events
`message.delta`, `message.complete`, `error`.

Voice (`src/voice.ts`) is plain REST:
- `POST /api/audio/transcribe {data_url, mime_type}` → `{transcript}`
- `POST /api/audio/speak {text}` → `{data_url}` (mp3, playable directly)

## Checks

Two scripts that fail loudly if the hard paths break:

```bash
node wstest.mjs      # WS upgrade + auth + session + streaming reply
node audiotest.mjs   # TTS -> STT round trip
```

Both need the dev server up. `audiotest.mjs` is a genuine round trip: it
synthesises speech, feeds that audio back to Whisper, and prints what came
back.

## Known rough edges

- **Transcription takes ~7s** on the 2-vCPU VPS (local Whisper). Fine for a
  sentence, sluggish for conversation. A cloud STT provider in `hermes tools`
  would cut it if it annoys you.
- **The tunnel is the weak link.** If chat says "connecting" forever, the
  tunnel died — restart step 2.
- No wake word by design; the mic only opens while you hold/toggle the button.

## Desktop overlay (`desktop/`)

A Siri-style summoned bar. Standalone: it serves the built UI itself and
manages its own SSH tunnel, so it works from a cold boot with nothing else
running.

```bash
cd desktop
npm install     # first time
npm start
```

### Two windows, two chords

| Chord | |
|---|---|
| **`Ctrl+Shift+Space`** | the overlay bar — summoned near the top of the active screen |
| **`Ctrl+Shift+G`** | the full window — tabbed chat + status, normal chrome, taskbar entry |

Both talk to the same agent. The full window is the same bundle loaded without
`?overlay`, so it renders `<App/>` (tabs) instead of the bar. Override with
`CORTANA_CHORD` and `CORTANA_FULL_CHORD`.

### Bar controls

📍/📌 pin · 🎤 push-to-talk · 👁 ask about my screen · 🔊 speak replies ·
⤢ open full window · ✕ clear

**Pinning.** By default the bar hides when you click away or switch apps.
Press 📍 (or the tray's *Keep bar on screen*) and it stays put while you work
elsewhere — `Escape` won't dismiss it either. The tray checkbox and the bar
button stay in sync; main process owns the state.

Pin state resets to unpinned when the app restarts.

### It starts with Windows

`Cortana.vbs` in the Startup folder launches it hidden at login:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Cortana.vbs
```

Delete that file to disable autostart. A single-instance lock means a second
launch just summons the running one instead of fighting over the chord.

### Architecture

```
Electron main ── spawns ──> ssh -N -L 9500:127.0.0.1:9500 cortana
              ── serves ──> ../dist  +  /api proxy (adds the token)
              ── loads  ──> http://127.0.0.1:<random>/?overlay
```

`server.cjs` replaces what the Vite proxy did in dev: static files plus an
authenticated `/api` proxy, including the WebSocket upgrade (which takes its
token as a query param, not a header). The token stays in the main process and
never reaches page JS, and `src/` keeps using relative URLs — identical code
under dev and production.

**After changing anything in `src/`, run `npm run build` in the project root.**
The overlay serves `dist/`, not your working tree. For live reload instead,
run the Vite server and start the app with `CORTANA_DEV_URL=http://127.0.0.1:5180`.

### Shared conversation engine

`src/useCortana.ts` holds the socket, session, streaming, push-to-talk, and
screen capture. Both the overlay bar (`Bar.tsx`) and the full window
(`Chat.tsx`) use it, so the streaming logic exists once.

### `npm start` runs `node start.cjs`, not `electron .`

Deliberate. VS Code's terminal exports `ELECTRON_RUN_AS_NODE=1`; Electron
inherits it, boots as plain Node, and dies with
`Cannot read properties of undefined (reading 'whenReady')`. `start.cjs`
strips it so the app launches from any shell.

### Icon

`icon.png` / `tray.png` are generated, not vendored — an original ring mark,
not Microsoft's Cortana asset, which is their trademark. Regenerate by
re-running the block in git history or editing the gradient constants.

### Not done yet

- Not packaged. `electron-builder` would produce a real installable `.exe`;
  today autostart depends on this folder and Node staying where they are.
- No reconnect UI: if the tunnel is down at launch, chat shows `failed` and
  you restart the app. The tunnel itself does auto-retry every 5s.
- Chord is an env var, not a settings screen.

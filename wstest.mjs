// Drives the same path the browser will: WS through the Vite proxy (which
// injects the token), session.create, prompt.submit, collect stream events.
import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:5180/api/ws");
let id = 0, sessionId = null, reply = "", sawDelta = false;
const done = (msg, code) => { console.log(msg); try { ws.close(); } catch {} process.exit(code); };
const timer = setTimeout(() => done("TIMEOUT — no completion within 90s", 1), 90000);

ws.on("open", () => {
  console.log("WS OPEN (proxy accepted upgrade + token)");
  ws.send(JSON.stringify({ id: `t${++id}`, method: "session.create", params: {} }));
});
ws.on("error", (e) => done("WS ERROR: " + e.message, 1));
ws.on("close", (c) => { if (!sessionId) done("WS CLOSED before session, code " + c, 1); });

ws.on("message", (buf) => {
  for (const line of String(buf).split("\n")) {
    if (!line.trim()) continue;
    let f; try { f = JSON.parse(line); } catch { continue; }

    if (f.id && f.result && !sessionId) {
      sessionId = f.result.session_id;
      console.log("session.create OK ->", sessionId);
      ws.send(JSON.stringify({ id: `t${++id}`, method: "prompt.submit",
        params: { session_id: sessionId, text: "Reply with exactly: CHAT OK" } }));
      continue;
    }
    if (f.id && f.error) done("RPC ERROR: " + JSON.stringify(f.error), 1);

    if (f.method === "event" && f.params?.type) {
      const t = f.params.type;
      if (t === "message.delta") { sawDelta = true; reply += f.params.payload?.text ?? ""; }
      if (t === "error") done("EVENT error: " + JSON.stringify(f.params.payload), 1);
      if (t === "message.complete") {
        clearTimeout(timer);
        const full = f.params.payload?.text ?? reply;
        console.log("streamed deltas:", sawDelta);
        console.log("REPLY:", JSON.stringify(String(full).slice(0, 120)));
        done("CHAT PATH WORKS", 0);
      }
    }
  }
});

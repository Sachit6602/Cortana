import WebSocket from "ws";
const PORT = process.argv[2];
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);
const t = setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 20000);
ws.on("open", () => {
  console.log("WS OPEN through app server");
  ws.send(JSON.stringify({ id: "t1", method: "session.create", params: {} }));
});
ws.on("message", (b) => {
  console.log("MSG:", String(b).slice(0, 160));
  clearTimeout(t); ws.close(); process.exit(0);
});
ws.on("error", (e) => { console.log("WS ERROR:", e.message); clearTimeout(t); process.exit(1); });
ws.on("unexpected-response", (_q, res) => {
  console.log("UNEXPECTED HTTP:", res.statusCode, res.statusMessage);
  clearTimeout(t); process.exit(1);
});
ws.on("close", (c, r) => console.log("CLOSED", c, String(r)));

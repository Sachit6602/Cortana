// Round-trip: speak() produces an mp3 data_url; feed that straight into
// transcribe() and see whether Whisper reads back the same words.
const B = "http://127.0.0.1:5180";
const PHRASE = "testing one two three";

const t0 = Date.now();
const sp = await fetch(`${B}/api/audio/speak`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: PHRASE }),
});
console.log("speak:", sp.status, `${Date.now() - t0}ms`);
if (!sp.ok) { console.log(await sp.text()); process.exit(1); }
const { data_url } = await sp.json();
console.log("audio bytes(b64):", data_url.length);

const t1 = Date.now();
const tr = await fetch(`${B}/api/audio/transcribe`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data_url, mime_type: "audio/mpeg" }),
});
console.log("transcribe:", tr.status, `${Date.now() - t1}ms`);
const body = await tr.text();
console.log("result:", body.slice(0, 300));

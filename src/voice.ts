// Push-to-talk voice. No wake word: recording starts and stops on an explicit
// user gesture, so the mic is never open when you didn't ask for it.

import { attachElement, attachStream, detach } from "./audioLevel";

export type Recorder = { stop: () => Promise<Blob> };

/** Start capturing mic audio. Resolves once the stream is actually live. */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Let the browser pick a container it can actually produce; Chrome and
  // Firefox disagree, and an unsupported mimeType throws at construction.
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );

  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  attachStream(stream);
  const chunks: BlobPart[] = [];
  rec.addEventListener("dataavailable", (e) => e.data.size && chunks.push(e.data));
  rec.start();

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.addEventListener(
          "stop",
          () => {
            detach();
            // Release the mic — the browser indicator stays on otherwise.
            stream.getTracks().forEach((t) => t.stop());
            resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
          },
          { once: true },
        );
        rec.stop();
      }),
  };
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("could not read recording"));
    fr.readAsDataURL(blob);
  });
}

/** Speech to text via Hermes's local Whisper. */
export async function transcribe(blob: Blob): Promise<string> {
  const data_url = await toDataUrl(blob);
  const res = await fetch("/api/audio/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url, mime_type: blob.type }),
  });
  if (!res.ok) throw new Error(`transcribe failed: HTTP ${res.status}`);

  const j = (await res.json()) as { text?: string; transcript?: string };
  return (j.text ?? j.transcript ?? "").trim();
}

let current: HTMLAudioElement | null = null;

/** Text to speech. Returns once playback finishes (or fails). */
export async function speak(text: string): Promise<void> {
  const res = await fetch("/api/audio/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`speak failed: HTTP ${res.status}`);

  const j = (await res.json()) as { data_url?: string };
  if (!j.data_url) return;

  stopSpeaking();
  const audio = new Audio(j.data_url);
  current = audio;
  try {
    attachElement(audio);
  } catch {
    // A given element can only be tapped once; playback still works.
  }
  await audio.play().catch(() => undefined);
  await new Promise<void>((resolve) => {
    audio.addEventListener("ended", () => resolve(), { once: true });
    audio.addEventListener("error", () => resolve(), { once: true });
  });
  detach();
  if (current === audio) current = null;
}

export function stopSpeaking(): void {
  if (!current) return;
  current.pause();
  current = null;
  detach();
}

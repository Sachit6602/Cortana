import { useCallback, useEffect, useRef, useState } from "react";
import { Gateway } from "./gateway";
import { speak, startRecording, stopSpeaking, transcribe } from "./voice";
import type { Recorder } from "./voice";
import { captureScreen, uploadImage } from "./screen";

export type Msg = { role: "you" | "cortana"; text: string; streaming?: boolean };
export type Conn = "connecting" | "ready" | "failed";

/**
 * One live Cortana conversation: gateway socket, session, streaming replies,
 * push-to-talk, and screen capture. Shared by the overlay bar and the full
 * window so the streaming logic exists once.
 */
export function useCortana(opts: { speakReplies?: boolean } = {}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conn, setConn] = useState<Conn>("connecting");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const gw = useRef<Gateway | null>(null);
  const sessionId = useRef<string | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const streamed = useRef("");
  // Read at fire time so toggling the setting never re-subscribes handlers
  // (which would drop an in-flight stream).
  const speakRef = useRef(Boolean(opts.speakReplies));
  speakRef.current = Boolean(opts.speakReplies);

  useEffect(() => {
    const g = new Gateway();
    gw.current = g;
    let dead = false;

    g.on("message.delta", (e) => {
      const t = (e.payload?.text ?? e.payload?.delta) as string | undefined;
      if (!t) return;
      streamed.current += t;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "cortana" && last.streaming) {
          next[next.length - 1] = { ...last, text: last.text + t };
        } else {
          next.push({ role: "cortana", text: t, streaming: true });
        }
        return next;
      });
    });

    g.on("message.complete", (e) => {
      const full = (e.payload?.text as string | undefined) ?? streamed.current;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "cortana" && last.streaming) {
          next[next.length - 1] = { role: "cortana", text: full || last.text };
        } else if (full) {
          next.push({ role: "cortana", text: full });
        }
        return next;
      });
      setBusy(false);
      if (speakRef.current && full) void speak(full).catch(() => undefined);
      streamed.current = "";
    });

    g.on("error", (e) => {
      setNotice(String(e.payload?.message ?? "gateway error"));
      setBusy(false);
    });

    // The tunnel may still be coming up when the window loads (Electron
    // spawns ssh and loads the page in the same breath), and it drops on
    // laptop sleep. Either way: keep trying rather than dying on attempt one.
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const open = async () => {
      if (dead) return;
      try {
        await g.connect();
        const r = await g.request<{ session_id: string }>("session.create");
        if (dead) return;
        sessionId.current = r.session_id;
        attempt = 0;
        setConn("ready");
        setNotice(null);
      } catch (err) {
        if (dead) return;
        attempt += 1;
        // Back off to 10s so a long outage doesn't hammer the socket.
        const wait = Math.min(1000 * 2 ** Math.min(attempt, 4), 10000);
        setConn(attempt > 2 ? "failed" : "connecting");
        setNotice(
          attempt > 2
            ? `${err instanceof Error ? err.message : String(err)} — retrying…`
            : null,
        );
        retry = setTimeout(open, wait);
      }
    };

    // An established socket that drops should re-establish, not sit dead.
    g.setOnClose(() => {
      if (dead) return;
      sessionId.current = null;
      setConn("connecting");
      retry = setTimeout(open, 1000);
    });

    void open();

    return () => {
      dead = true;
      clearTimeout(retry);
      g.setOnClose(null);
      g.close();
    };
  }, []);

  const send = useCallback(async (text: string) => {
    const body = text.trim();
    if (!body || !gw.current || !sessionId.current) return;

    setMessages((p) => [...p, { role: "you", text: body }]);
    setBusy(true);
    setNotice(null);
    streamed.current = "";

    try {
      await gw.current.request("prompt.submit", {
        session_id: sessionId.current,
        text: body,
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, []);

  const toggleMic = useCallback(async () => {
    if (recording) {
      setRecording(false);
      const rec = recorder.current;
      recorder.current = null;
      if (!rec) return;
      try {
        const blob = await rec.stop();
        setNotice("transcribing…");
        const text = await transcribe(blob);
        setNotice(null);
        if (text) await send(text);
        else setNotice("nothing heard");
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    try {
      stopSpeaking();
      recorder.current = await startRecording();
      setRecording(true);
      setNotice(null);
    } catch {
      setNotice("microphone blocked — allow mic access");
    }
  }, [recording, send]);

  const askAboutScreen = useCallback(async () => {
    setNotice("capturing screen…");
    try {
      const path = await uploadImage(await captureScreen());
      setNotice(null);
      await send(`Look at this screenshot of my screen and tell me what you see: ${path}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }, [send]);

  const clear = useCallback(() => {
    setMessages([]);
    setNotice(null);
  }, []);

  return { messages, conn, busy, recording, notice, send, toggleMic, askAboutScreen, clear };
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCortana } from "./useCortana";
import { subscribe } from "./audioLevel";

/**
 * The summoned overlay.
 *
 * Starts as an orb — just the aura and a mic — and only becomes a text bar
 * when you ask for one (⌨) or when there's something to show. Answers grow
 * downward from a fixed top edge.
 */
export default function Bar() {
  const [draft, setDraft] = useState("");
  const [speakReplies, setSpeakReplies] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [typing, setTyping] = useState(false);
  const c = useCortana({ speakReplies });

  const input = useRef<HTMLInputElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // Any content forces the wide layout — an answer can't render in the orb.
  const wide = typing || c.messages.length > 0 || c.busy || Boolean(c.notice);

  useEffect(() => window.cortana?.onPinned?.(setPinned), []);

  // Main needs to know whether the mic is live so the global chord can stop
  // it, not just re-summon.
  useEffect(() => {
    window.cortana?.setRecording?.(c.recording);
  }, [c.recording]);

  // The chord IS push-to-talk: summoning starts listening straight away, and
  // pressing it again stops and sends. Refs so the subscriptions below never
  // re-bind and lose an in-flight recording.
  const micRef = useRef(c.toggleMic);
  micRef.current = c.toggleMic;
  const recRef = useRef(c.recording);
  recRef.current = c.recording;
  const readyRef = useRef(c.conn === "ready");
  readyRef.current = c.conn === "ready";

  useEffect(() => {
    const offSummon = window.cortana?.onSummon?.(() => {
      // Not connected yet: don't open the mic on a socket that can't deliver.
      if (readyRef.current && !recRef.current) void micRef.current();
    });
    const offStop = window.cortana?.onStopSend?.(() => {
      if (recRef.current) void micRef.current();
    });
    return () => {
      offSummon?.();
      offStop?.();
    };
  }, []);

  // Level goes onto a CSS variable, not React state: this updates every
  // animation frame and re-rendering that often would stutter.
  useEffect(
    () => subscribe((l) => shell.current?.style.setProperty("--level", l.toFixed(3))),
    [],
  );

  useEffect(() => {
    if (wide) input.current?.focus();
  }, [wide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Escape steps back to the orb before it dismisses the window.
        if (wide && c.messages.length === 0) setTyping(false);
        else window.cortana?.hide?.();
      }
      // Typing anywhere in orb mode opens the composer, like Spotlight.
      if (!wide && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setTyping(true);
        setDraft((d) => d + e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, c.messages.length]);

  // Report measured size so main can grow the window downward.
  useLayoutEffect(() => {
    const h = shell.current?.getBoundingClientRect().height ?? 0;
    window.cortana?.resize?.({ wide, height: Math.ceil(h) + 44 } as never);
  }, [wide, c.messages, c.notice, c.busy]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [c.messages]);

  const state = c.recording ? "listening" : c.busy ? "busy" : c.conn === "failed" ? "bad" : "";

  return (
    <div className={`ov-wrap ${state} ${wide ? "wide" : "orb"}`} ref={shell}>
      {/* Layered blobs, each drifting on its own cycle — a single rotating
          gradient reads mechanical; overlapping ones read organic. */}
      <div className="ov-aura" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
        <span className="blob b4" />
      </div>

      {!wide ? (
        <div className="ov-orb">
          <button
            className={`orb-mic ${c.recording ? "on" : ""}`}
            onClick={() => void c.toggleMic()}
            disabled={c.conn !== "ready"}
            title={c.recording ? "Stop and send" : "Talk to Cortana"}
          >
            {c.recording ? "◼" : "🎤"}
          </button>
          <button className="orb-type" onClick={() => setTyping(true)} title="Type instead">
            ⌨ type
          </button>
        </div>
      ) : (
        <div className="ov">
          <form
            className="ov-bar"
            onSubmit={(e) => {
              e.preventDefault();
              const t = draft;
              setDraft("");
              void c.send(t);
            }}
          >
            <span className={`ov-dot ${c.conn}`} title={c.conn} />
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={c.conn === "ready" ? "Ask Cortana…" : `${c.conn}…`}
              disabled={c.conn !== "ready"}
            />
            <button
              type="button"
              className={c.recording ? "on" : ""}
              onClick={() => void c.toggleMic()}
              disabled={c.conn !== "ready"}
              title="Push to talk"
            >
              {c.recording ? "◼" : "🎤"}
            </button>
            <button type="button" onClick={() => void c.askAboutScreen()} disabled={c.conn !== "ready"} title="Ask about my screen">
              👁
            </button>
            <button
              type="button"
              className={pinned ? "on" : ""}
              onClick={() => {
                const v = !pinned;
                setPinned(v);
                window.cortana?.setPinned?.(v);
              }}
              title={pinned ? "Unpin" : "Keep on screen"}
            >
              {pinned ? "📌" : "📍"}
            </button>
            <button type="button" onClick={() => window.cortana?.openFull?.()} title="Full window (Ctrl+Shift+G)">
              ⤢
            </button>
            <button
              type="button"
              className={speakReplies ? "on" : ""}
              onClick={() => setSpeakReplies((v) => !v)}
              title="Speak replies"
            >
              🔊
            </button>
            <button
              type="button"
              onClick={() => {
                c.clear();
                setTyping(false);
                setDraft("");
              }}
              title="Back to orb"
            >
              ✕
            </button>
          </form>

          {(c.messages.length > 0 || c.busy || c.notice) && (
            <div className="ov-body" ref={log}>
              {c.messages.map((m, i) => (
                <div key={i} className={`ov-msg ${m.role}`}>
                  {m.text || "…"}
                </div>
              ))}
              {c.busy && <div className="ov-thinking">thinking…</div>}
              {c.notice && <div className="ov-notice">{c.notice}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

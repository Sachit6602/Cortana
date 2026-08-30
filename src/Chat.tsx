import { useEffect, useRef, useState } from "react";
import { useCortana } from "./useCortana";

/** Full-window chat. Same conversation engine as the overlay bar. */
export default function Chat() {
  const [draft, setDraft] = useState("");
  const [speakReplies, setSpeakReplies] = useState(false);
  const c = useCortana({ speakReplies });
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [c.messages]);

  return (
    <div className="chat">
      <div className="chat-bar">
        <span className={`pill ${c.conn === "ready" ? "ok" : c.conn === "failed" ? "bad" : "warn"}`}>
          {c.conn}
        </span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={speakReplies}
            onChange={(e) => setSpeakReplies(e.target.checked)}
          />
          speak replies
        </label>
      </div>

      <div className="messages" ref={scroller}>
        {c.messages.length === 0 && (
          <p className="hint empty">Ask Cortana something, or press the mic to talk.</p>
        )}
        {c.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <span className="who">{m.role}</span>
            <div className="bubble">{m.text || "…"}</div>
          </div>
        ))}
        {c.busy && <p className="hint">thinking…</p>}
      </div>

      {c.notice && <p className="stale">{c.notice}</p>}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft;
          setDraft("");
          void c.send(t);
        }}
      >
        <button
          type="button"
          className={`mic ${c.recording ? "rec" : ""}`}
          onClick={() => void c.toggleMic()}
          disabled={c.conn !== "ready"}
        >
          {c.recording ? "◼ stop" : "🎤 talk"}
        </button>
        <button type="button" onClick={() => void c.askAboutScreen()} disabled={c.conn !== "ready"}>
          👁 screen
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={c.conn === "ready" ? "Message Cortana…" : "connecting…"}
          disabled={c.conn !== "ready"}
        />
        <button type="submit" disabled={c.conn !== "ready" || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

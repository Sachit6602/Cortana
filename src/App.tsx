import { useEffect, useState } from "react";
import Chat from "./Chat";
import Status from "./Status";
import { api } from "./api";

type Tab = "chat" | "status";

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [model, setModel] = useState<string>("");

  useEffect(() => {
    api
      .config()
      .then((c) => setModel(c.model))
      .catch(() => setModel(""));
  }, []);

  return (
    <div className="shell">
      <header className="head">
        <div>
          <h1>Cortana</h1>
          <p className="hint">{model || "connecting…"}</p>
        </div>
        <nav className="tabs">
          <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
            Chat
          </button>
          <button className={tab === "status" ? "on" : ""} onClick={() => setTab("status")}>
            Status
          </button>
        </nav>
      </header>

      {/* Chat holds a live WebSocket and streaming state — keep it mounted so
          switching to Status doesn't drop the session mid-reply. */}
      <div hidden={tab !== "chat"}>
        <Chat />
      </div>
      {tab === "status" && <Status />}
    </div>
  );
}
